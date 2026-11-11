/**
 * Pajé — motor de voz/vídeo.
 *
 * Camadas separadas:
 * - Presença (quem está online e em qual canal): Lovable Cloud realtime (presence + broadcast "move").
 * - Mídia (voz, câmera, tela): LiveKit (servidor SFU). Cada canal de voz = uma sala LiveKit.
 *   Cada pessoa envia 1 cópia do seu áudio/vídeo; o servidor distribui. Reconexão automática.
 * - Celular como webcam: sala LiveKit privada `cam-<peerId>`; o computador recebe e republica no canal.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  AudioPresets,
  ConnectionQuality,
  DisconnectReason,
  LocalAudioTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getState, setState, type ChannelId, type Member, type RemoteStreams, VOICE_CHANNELS, subscribeState } from "./store";
import { sfx } from "./sfx";
import { MEDIA_FEATURES, allowScreenAudio, shareProfileParams, safeScreenAudio, shouldPlayScreenAudio, shouldSubscribeMedia } from "./media-policy";
import { HelperAudioClient } from "./audio-helper";
import { normalizeCamFx, type CamFx } from "./camfx";
import { acquireCamera, cameraErrorMessage } from "./media";
import { getPhoneCamToken, getPhoneHostToken, getVoiceToken } from "./livekit.functions";

const PRESENCE_ROOM = "litevoice-room";
const MAX_RETRIES = 6;

export type Quality = "good" | "fair" | "poor";

interface PresenceEntry {
  peerId: string;
  nickname: string;
  avatar: string | null;
  channel: ChannelId | null;
  muted: boolean;
  deafened: boolean;
  micStream: string | null;
  camStream: string | null;
  screenStream: string | null;
  camFx?: CamFx | undefined;
  /** Momento da última atualização — descarta estados antigos fora de ordem. */
  at: number;
}

/** Faixas recebidas de cada amigo. */
interface RemoteMedia {
  mic?: RemoteTrack | undefined;
  micEl?: HTMLMediaElement | undefined;
  cam?: RemoteTrack | undefined;
  screen?: RemoteTrack | undefined;
  screenAudio?: RemoteTrack | undefined;
  screenEl?: HTMLMediaElement | undefined;
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export function micErrorMessage(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "O navegador bloqueou o microfone. Clique no cadeado da barra de endereço e permita o microfone.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "Microfone não encontrado. Ele pode ter sido desconectado — escolha outro nas configurações.";
  if (name === "NotReadableError" || name === "AbortError")
    return "O microfone está ocupado por outro programa ou falhou. Feche o outro programa ou escolha outro microfone.";
  return "Não foi possível abrir o microfone.";
}

function audioHost() {
  let el = document.getElementById("paje-audio");
  if (!el) {
    el = document.createElement("div");
    el.id = "paje-audio";
    el.style.display = "none";
    document.body.appendChild(el);
  }
  return el;
}

export class VoiceClient {
  me: string;
  private presence: RealtimeChannel | null = null;
  private presenceRetry: number | null = null;
  private presenceAttempt = 0;
  private lastSeen: Record<string, number> = {};

  private room: Room | null = null;
  private roomChannel: ChannelId | null = null;
  private retryTimer: number | null = null;
  private retries = 0;
  private remote = new Map<string, RemoteMedia>();
  private pubs: { mic?: LocalTrackPublication | undefined; cam?: LocalTrackPublication | undefined; screen?: LocalTrackPublication | undefined; screenAudio?: LocalTrackPublication | undefined } = {};

  private camRoom: Room | null = null;
  private camDialogOpen = false;
  private phoneOp: Promise<unknown> = Promise.resolve();
  private unsubscribeState: (() => void) | null = null;
  private presenceReady = false;

  // Microfone: bruto → ganho → (enviado, analisador local, monitor)
  private micStream: MediaStream | null = null;
  private rawMicStream: MediaStream | null = null;
  private micGainNode: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private micDest: MediaStreamAudioDestinationNode | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;
  private vadBuf = new Uint8Array(256);
  private remoteSpeaking = new Set<string>();

  private vadTimer: number | null = null;
  private statsTimer: number | null = null;
  private started = false;
  private op: Promise<void> = Promise.resolve();

  /** Componente auxiliar local de captura seletiva de áudio (Windows). */
  readonly helper = new HelperAudioClient();
  private shareAudioTrack: MediaStreamTrack | null = null;

  constructor(peerId: string) {
    this.me = peerId;
    this.helper.onChange = () =>
      setState({ helperStatus: this.helper.status, helperProcesses: this.helper.processes, helperPid: this.helper.selectedPid });
  }

  /** Operações de entrada/saída são serializadas: nunca correm em paralelo. */
  private queue(fn: () => Promise<void>) {
    this.op = this.op.then(fn).catch((e) => console.warn("[voice]", e));
    return this.op;
  }

  /* ---------------- ciclo de vida ---------------- */

  start() {
    return this.queue(() => this.doStart());
  }

  stop() {
    return this.queue(() => this.doStop());
  }

  private async doStart() {
    if (this.started) return;
    this.started = true;
    this.connectPresence();
    document.addEventListener("visibilitychange", this.onVisibility);
    navigator.mediaDevices?.addEventListener?.("devicechange", this.onDeviceChange);
    window.addEventListener("online", this.onOnline);
    if (MEDIA_FEATURES.voice) this.vadTimer = window.setInterval(() => this.runVad(), 100);
    let watching = getState().watching;
    let speaker = getState().devices.speaker;
    this.unsubscribeState = subscribeState(() => {
      const s = getState();
      if (watching !== s.watching || speaker !== s.devices.speaker) {
        watching = s.watching;
        speaker = s.devices.speaker;
        this.syncSubscriptions();
      }
    });
    this.statsTimer = window.setInterval(() => void this.collectStats(), 3000);
  }

  private async doStop() {
    if (!this.started) return;
    this.started = false;
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.presenceReady = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
    window.removeEventListener("online", this.onOnline);
    if (this.vadTimer) clearInterval(this.vadTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.presenceRetry) clearTimeout(this.presenceRetry);
    await this.doLeave();
    await this.closePhoneCam(true);
    this.releaseMic();
    if (this.presence) await supabase.removeChannel(this.presence);
    this.presence = null;
    setState({ connected: false, members: {} });
  }

  private onVisibility = () => {
    const hidden = document.visibilityState === "hidden";
    setState({ hidden });
    const s = getState();
    // Durante transmissão/chamada a câmera não é pausada no Alt+Tab (pausar derrubava a publicação).
    if (s.settings.powerSave && s.localCam && !s.phoneCamConnected && !s.myChannel) {
      // Com o PiP aberto a câmera continua ativa mesmo com a aba em segundo plano.
      s.localCam.getVideoTracks().forEach((t) => (t.enabled = !hidden || s.pipOpen));
    }
  };

  private onOnline = () => {
    // Rede voltou: reconecta presença e voz imediatamente, sem esperar o próximo intervalo.
    if (!getState().connected) this.connectPresence();
    if (getState().myChannel && getState().voiceStatus !== "connected") this.retryVoice();
  };

  private onDeviceChange = () => {
    const t = this.rawMicStream?.getAudioTracks()[0];
    if (t && t.readyState === "ended") void this.recoverMic();
  };

  /* ---------------- presença ---------------- */

  private connectPresence() {
    if (!this.started) return;
    this.presenceReady = false;
    if (this.presence) void supabase.removeChannel(this.presence);
    const ch = supabase.channel(PRESENCE_ROOM, {
      config: { presence: { key: this.me }, broadcast: { self: false, ack: false } },
    });
    this.presence = ch;
    ch.on("presence", { event: "sync" }, () => this.onSync())
      .on("broadcast", { event: "move" }, ({ payload }) => {
        const p = payload as { target: string; channel: ChannelId };
        if (p.target === this.me) void this.joinChannel(p.channel);
      })
      .subscribe(async (status) => {
        if (ch !== this.presence) return;
        if (status === "SUBSCRIBED") {
          this.presenceAttempt = 0;
          setState({ connected: true });
          await this.publishPresence();
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState({ connected: false });
          this.schedulePresenceRetry();
        }
      });
  }

  private schedulePresenceRetry() {
    if (!this.started || this.presenceRetry) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.presenceAttempt++);
    this.presenceRetry = window.setTimeout(() => {
      this.presenceRetry = null;
      this.connectPresence();
    }, delay);
  }

  private presencePayload(): PresenceEntry {
    const s = getState();
    return {
      peerId: this.me,
      nickname: s.profile?.nickname ?? "?",
      avatar: s.profile?.avatar ?? null,
      channel: s.myChannel,
      muted: s.muted || s.deafened || !this.micStream,
      deafened: s.deafened,
      micStream: this.pubs.mic ? "mic" : null,
      camStream: s.localCam ? "cam" : null,
      screenStream: s.localScreen ? "screen" : null,
      camFx: s.settings.camFx,
      at: Date.now(),
    };
  }

  async publishPresence() {
    if (!this.presence || !getState().connected) return;
    try {
      await this.presence.track(this.presencePayload());
    } catch (e) {
      console.warn("[voice] presence track failed", e);
    }
  }

  private onSync() {
    if (!this.presence) return;
    const raw = this.presence.presenceState<PresenceEntry & { role?: string }>();
    const members: Record<string, Member> = {};
    for (const key of Object.keys(raw)) {
      // Várias abas com o mesmo id: usa a atualização mais recente.
      const entries = (raw[key] ?? []).filter((e) => e.role !== "phonecam" && e.nickname);
      const entry = entries.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
      if (!entry) continue;
      this.lastSeen[key] = entry.at ?? 0;
      members[key] = {
        peerId: key,
        nickname: entry.nickname,
        avatar: entry.avatar,
        channel: entry.channel,
        muted: entry.muted,
        deafened: entry.deafened,
        micStream: entry.micStream,
        camStream: entry.camStream,
        screenStream: entry.screenStream,
        camFx: entry.camFx ? normalizeCamFx(entry.camFx) : undefined,
      };
    }
    const previous = getState().members;
    if (this.presenceReady && getState().myChannel) {
      const channel = getState().myChannel;
      for (const [id, member] of Object.entries(members)) {
        if (id === this.me) continue;
        const prev = previous[id];
        if (member.channel === channel && prev?.channel !== channel) sfx.join();
        if (prev?.channel === channel && member.channel !== channel) sfx.leave();
        if (member.channel === channel && prev?.channel === channel) {
          if (member.screenStream && !prev.screenStream) sfx.shareStart();
          if (!member.screenStream && prev.screenStream) sfx.shareStop();
          if (member.camStream && !prev.camStream) sfx.camStart();
          if (!member.camStream && prev.camStream) sfx.camStop();
        }
      }
      for (const [id, member] of Object.entries(previous)) {
        if (id !== this.me && member.channel === channel && !members[id]) sfx.leave();
      }
    }
    this.presenceReady = true;
    // Só atualiza a tela quando algo visível mudou (evita "tremor" periódico da interface).
    if (JSON.stringify(members) !== JSON.stringify(previous)) setState({ members });
    // Fechar a transmissão assistida fica a cargo do LiveKit (TrackUnpublished/desconexão);
    // oscilações de presença não devem mais derrubar a tela dos espectadores.
  }

  /* ---------------- canais de voz (LiveKit) ---------------- */

  joinChannel(ch: ChannelId) {
    return this.queue(() => this.doJoin(ch));
  }

  leaveChannel() {
    return this.queue(() => this.doLeave());
  }

  /** Tenta de novo depois de uma falha, sem recarregar a página. */
  retryVoice() {
    const ch = getState().myChannel;
    if (!ch) return;
    this.retries = 0;
    void this.queue(() => this.connectRoom(ch));
  }

  private async doJoin(ch: ChannelId) {
    const s = getState();
    if (s.myChannel === ch && this.room) {
      setState({ view: ch });
      return;
    }
    if (this.room) await this.disconnectRoom();
    setState({ muted: true, deafened: false });
    setState({ myChannel: ch, view: ch, watching: null });
    if (MEDIA_FEATURES.voice && !this.micStream && s.devices.mic !== "none") {
      try {
        await this.openMic(s.devices.mic);
      } catch (e) {
        console.warn("[voice] mic", e);
        toast.error(micErrorMessage(e));
      }
    }
    const def = VOICE_CHANNELS.find((c) => c.id === ch);
    if (def?.autoMute && !getState().muted) setState({ muted: true });
    this.retries = 0;
    await this.connectRoom(ch);
    sfx.join();
    await this.publishPresence();
  }

  private async doLeave() {
    const wasIn = !!getState().myChannel;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.stopShare(false);
    await this.stopCam(false);
    await this.disconnectRoom();
    setState({
      myChannel: null,
      view: "gameplay-1",
      watching: null,
      speaking: {},
      pings: {},
      quality: {},
      streams: {},
      voiceStatus: "idle",
      audioBlocked: false,
    });
    if (wasIn) sfx.leave();
    await this.publishPresence();
  }

  private async connectRoom(ch: ChannelId) {
    if (this.room) await this.disconnectRoom();
    const s = getState();
    if (!s.token || !s.profile) return;
    setState({ voiceStatus: this.retries > 0 ? "reconnecting" : "connecting" });

    const room = new Room({
      adaptiveStream: false,
      dynacast: true,
      webAudioMix: false, // voz remota em <audio>: o cancelador de eco do navegador atua
      disconnectOnPageLeave: true,
      stopLocalTrackOnUnpublish: false,
      audioOutput: { deviceId: s.devices.speaker === "none" || s.devices.speaker === "default" ? "default" : s.devices.speaker },
      reconnectPolicy: {
        nextRetryDelayInMs: (ctx) => (ctx.retryCount > 8 ? null : Math.min(8000, 300 * 2 ** ctx.retryCount)),
      },
    });
    this.room = room;
    this.roomChannel = ch;
    this.bindRoom(room);

    try {
      const { url, jwt } = await withTimeout(
        getVoiceToken({ data: { token: s.token, peerId: this.me, nickname: s.profile.nickname, channel: ch } }),
        10_000,
        "Tempo esgotado ao pedir acesso à sala de vídeo.",
      );
      if (this.room !== room) return;
      await withTimeout(room.connect(url, jwt, { autoSubscribe: false }), 30_000, "Tempo esgotado ao conectar à sala.");
      if (this.room !== room) return;
      this.retries = 0;
      setState({ voiceStatus: "connected", audioBlocked: !room.canPlaybackAudio });
      this.syncSubscriptions();
      await this.publishAll();
    } catch (e) {
      console.warn("[voice] connect failed", e);
      if (this.room !== room) return;
      const msg = e instanceof Error ? e.message : "";
      if (/Sessão inválida/.test(msg)) {
        toast.error(msg);
        setState({ voiceStatus: "failed" });
        return;
      }
      this.scheduleRoomRetry(ch);
    }
  }

  private scheduleRoomRetry(ch: ChannelId) {
    if (this.retryTimer || getState().myChannel !== ch) return;
    if (this.retries >= MAX_RETRIES) {
      setState({ voiceStatus: "failed" });
      toast.error("Não foi possível conectar à sala. Verifique sua internet e toque em “Tentar de novo”.");
      return;
    }
    setState({ voiceStatus: "reconnecting" });
    const delay = Math.min(15_000, 1000 * 2 ** this.retries++);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (getState().myChannel === ch) void this.queue(() => this.connectRoom(ch));
    }, delay);
  }

  private async disconnectRoom() {
    const room = this.room;
    this.room = null;
    this.roomChannel = null;
    this.pubs = {};
    for (const id of [...this.remote.keys()]) this.dropRemote(id);
    this.remoteSpeaking.clear();
    if (room) {
      room.removeAllListeners();
      await room.disconnect(true).catch(() => {});
    }
  }

  private bindRoom(room: Room) {
    room
      .on(RoomEvent.TrackSubscribed, (track, pub, p) => this.onTrack(track, pub, p))
      .on(RoomEvent.TrackPublished, () => this.syncSubscriptions())
      .on(RoomEvent.ParticipantConnected, () => this.syncSubscriptions())
      .on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (pub.source === Track.Source.ScreenShare && getState().watching === p.identity) setState({ watching: null });
      })
      .on(RoomEvent.TrackUnsubscribed, (track, pub, p) => this.offTrack(track, pub, p))
      .on(RoomEvent.TrackMuted, () => {})
      .on(RoomEvent.ParticipantDisconnected, (p) => this.dropRemote(p.identity))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.remoteSpeaking = new Set(speakers.filter((x) => x.identity !== this.me).map((x) => x.identity));
      })
      .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
        const quality: Quality =
          q === ConnectionQuality.Excellent || q === ConnectionQuality.Good ? "good" : q === ConnectionQuality.Poor ? "fair" : "poor";
        if (getState().quality[p.identity] !== quality) setState((s) => ({ quality: { ...s.quality, [p.identity]: quality } }));
      })
      .on(RoomEvent.Reconnecting, () => {
        if (this.room === room) setState({ voiceStatus: "reconnecting" });
      })
      .on(RoomEvent.Reconnected, () => {
        if (this.room !== room) return;
        setState({ voiceStatus: "connected" });
        this.syncSubscriptions();
        sfx.reconnect();
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setState({ audioBlocked: !room.canPlaybackAudio }))
      .on(RoomEvent.Disconnected, (reason) => {
        if (this.room !== room) return;
        const ch = this.roomChannel;
        this.room = null;
        this.pubs = {};
        for (const id of [...this.remote.keys()]) this.dropRemote(id);
        if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
          setState({ voiceStatus: "failed" });
          toast.error("Você entrou na sala por outra aba ou aparelho. Esta aba saiu da chamada.");
          return;
        }
        if (reason === DisconnectReason.CLIENT_INITIATED || !ch) return;
        this.scheduleRoomRetry(ch);
      });
  }

  /* ---------------- faixas remotas ---------------- */

  private syncSubscriptions() {
    const s = getState();
    this.room?.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => {
      const wanted = shouldSubscribeMedia(pub.source, p.identity, s.watching);
      pub.setSubscribed(wanted);
    }));
    this.remote.forEach((r, id) => {
      if (r.micEl) r.micEl.muted = true;
      if (r.screenEl) r.screenEl.muted = !shouldPlayScreenAudio(id, s.watching, s.devices.speaker);
    });
  }

  private onTrack(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
    const id = p.identity;
    if (!shouldSubscribeMedia(pub.source, id, getState().watching)) {
      pub.setSubscribed(false);
      return;
    }
    const r = this.remote.get(id) ?? {};
    const s = getState();
    switch (pub.source) {
      case Track.Source.Microphone: {
        if (r.mic === track) return;
        if (r.micEl) r.mic?.detach(r.micEl).remove();
        r.mic = track;
        r.micEl = track.attach();
        r.micEl.muted = s.deafened;
        audioHost().appendChild(r.micEl);
        p.setVolume(Math.min(1, s.volumes[id] ?? 1), Track.Source.Microphone);
        break;
      }
      case Track.Source.ScreenShareAudio: {
        if (r.screenAudio === track) return;
        if (r.screenEl) r.screenAudio?.detach(r.screenEl).remove();
        r.screenAudio = track;
        r.screenEl = track.attach();
        r.screenEl.muted = !shouldPlayScreenAudio(id, s.watching, s.devices.speaker);
        audioHost().appendChild(r.screenEl);
        p.setVolume(Math.min(1, s.screenVolume), Track.Source.ScreenShareAudio);
        break;
      }
      case Track.Source.Camera:
        r.cam = track;
        break;
      case Track.Source.ScreenShare:
        r.screen = track;
        break;
      default:
        return;
    }
    this.remote.set(id, r);
    this.publishStreams(id);
  }

  private offTrack(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
    const r = this.remote.get(p.identity);
    if (!r) return;
    track.detach().forEach((el) => el.remove());
    if (pub.source === Track.Source.Microphone && r.mic === track) r.mic = r.micEl = undefined;
    if (pub.source === Track.Source.ScreenShareAudio && r.screenAudio === track) r.screenAudio = r.screenEl = undefined;
    if (pub.source === Track.Source.Camera && r.cam === track) r.cam = undefined;
    if (pub.source === Track.Source.ScreenShare && r.screen === track) r.screen = undefined;
    this.publishStreams(p.identity);
  }

  private dropRemote(id: string) {
    const r = this.remote.get(id);
    if (r) {
      [r.mic, r.screenAudio].forEach((t) => t?.detach().forEach((el) => el.remove()));
    }
    this.remote.delete(id);
    setState((s) => {
      const streams = { ...s.streams };
      delete streams[id];
      return { streams, watching: s.watching === id ? null : s.watching };
    });
  }

  private publishStreams(id: string) {
    const r = this.remote.get(id);
    const prev = getState().streams[id];
    const same = (ms: MediaStream | undefined, t: RemoteTrack | undefined) =>
      t ? ms?.getTracks()[0] === t.mediaStreamTrack : !ms;
    if (prev && same(prev.mic, r?.mic) && same(prev.cam, r?.cam) && same(prev.screen, r?.screen)) return;
    // Reaproveita o MediaStream que não mudou: recriar todos faz os vídeos piscarem.
    const keep = (ms: MediaStream | undefined, t: RemoteTrack | undefined) =>
      t ? (same(ms, t) ? ms : new MediaStream([t.mediaStreamTrack])) : undefined;
    const next: RemoteStreams = {
      mic: keep(prev?.mic, r?.mic),
      cam: keep(prev?.cam, r?.cam),
      screen: keep(prev?.screen, r?.screen),
    };
    setState((s) => ({
      streams: { ...s.streams, [id]: next },
    }));
  }

  /** O navegador bloqueou o som automático: liberar com um clique. */
  async unlockAudio() {
    await this.room?.startAudio().catch(() => {});
    void this.ctx?.resume();
    setState({ audioBlocked: !(this.room?.canPlaybackAudio ?? true) });
  }

  /* ---------------- volume e saída ---------------- */

  private ensureCtx() {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: "interactive" });
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  async applySink() {
    const speaker = getState().devices.speaker;
    const id = speaker === "default" || speaker === "none" ? "default" : speaker;
    try {
      await this.room?.switchActiveDevice("audiooutput", id);
      this.syncSubscriptions();
    } catch {
      toast.error("Não foi possível usar esse alto-falante.");
    }
  }

  setVolume(id: string, v: number) {
    setState((s) => ({ volumes: { ...s.volumes, [id]: v } }));
    this.room?.remoteParticipants.get(id)?.setVolume(Math.min(1, Math.max(0, v)), Track.Source.Microphone);
  }

  setScreenVolume(v: number) {
    setState({ screenVolume: v });
    const vol = Math.min(1, Math.max(0, v));
    this.remote.forEach((r) => { if (r.screenEl) r.screenEl.volume = vol; });
    this.room?.remoteParticipants.forEach((p) => p.setVolume(Math.min(1, Math.max(0, v)), Track.Source.ScreenShareAudio));
  }

  /* ---------------- indicador de fala ---------------- */

  private runVad() {
    const s = getState();
    if (!s.myChannel) return;
    let mine = false;
    if (this.micSending() && this.localAnalyser) {
      this.localAnalyser.getByteTimeDomainData(this.vadBuf);
      let sum = 0;
      for (let i = 0; i < this.vadBuf.length; i++) {
        const v = ((this.vadBuf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      mine = Math.sqrt(sum / this.vadBuf.length) > s.settings.vadThreshold;
    }
    const next: Record<string, boolean> = { [this.me]: mine };
    this.remoteSpeaking.forEach((id) => (next[id] = true));
    const prevKeys = Object.keys(s.speaking).filter((k) => s.speaking[k]);
    const nextKeys = Object.keys(next).filter((k) => next[k]);
    if (prevKeys.length !== nextKeys.length || nextKeys.some((k) => !s.speaking[k])) setState({ speaking: next });
  }

  /** Latência real até o servidor de voz (ida e volta). */
  private async collectStats() {
    const room = this.room;
    if (!room || getState().voiceStatus !== "connected") return;
    const track = this.pubs.mic?.track ?? this.pubs.cam?.track;
    let rtt: number | undefined;
    try {
      if (track instanceof LocalAudioTrack) rtt = (await track.getSenderStats())?.roundTripTime;
    } catch {
      /* sem estatística */
    }
    if (rtt == null) rtt = (room.engine as unknown as { client?: { rtt?: number } }).client?.rtt;
    if (rtt != null && rtt > 0) {
      const ms = Math.round(rtt > 5 ? rtt : rtt * 1000);
      if (getState().pings[this.me] !== ms) setState((s) => ({ pings: { ...s.pings, [this.me]: ms } }));
    }
  }

  /* ---------------- microfone ---------------- */

  private micSending() {
    const s = getState();
    if (!MEDIA_FEATURES.voice || !this.micStream) return false;
    if (s.muted || s.deafened) return false;
    if (s.settings.ptt && !s.pttHeld) return false;
    return true;
  }

  applyMicEnabled() {
    const on = this.micSending();
    const pub = this.pubs.mic;
    if (pub) void (on ? pub.unmute() : pub.mute()).catch(() => {});
    else this.micStream?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  applyMicTuning() {
    const s = getState().settings;
    if (this.micGainNode) this.micGainNode.gain.value = s.micGain;
    if (this.monitorGain) this.monitorGain.gain.value = s.micMonitor ? 1 : 0;
  }

  async reopenMic() {
    const d = getState().devices.mic;
    if (d === "none" || !this.rawMicStream) return;
    await this.setMic(d);
  }

  private async recoverMic() {
    toast.error("O microfone foi desconectado. Tentando o microfone padrão…");
    try {
      await this.setMic("default");
      toast.success("Microfone padrão conectado.");
    } catch (e) {
      toast.error(micErrorMessage(e));
      await this.setMic("none");
    }
  }

  private releaseMic() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    this.localSource?.disconnect();
    this.micGainNode?.disconnect();
    this.monitorGain?.disconnect();
    this.micStream = this.rawMicStream = null;
    this.localSource = this.localAnalyser = null;
    this.micGainNode = this.monitorGain = this.micDest = null;
  }

  /** Abre o microfone e só troca o antigo depois que o novo funcionou. */
  private async openMic(deviceId: string) {
    if (!MEDIA_FEATURES.voice) return;
    const st = getState().settings;
    const constraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: st.noiseSuppression,
      autoGainControl: st.noiseSuppression,
      channelCount: 1,
    };
    if (deviceId !== "default") constraints.deviceId = { exact: deviceId };
    const raw = await withTimeout(
      navigator.mediaDevices.getUserMedia({ audio: constraints }),
      15_000,
      "O microfone não respondeu.",
    );
    raw.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (this.rawMicStream === raw) void this.recoverMic();
    });

    const oldPubTrack = this.pubs.mic?.track;
    this.releaseMic();
    const ctx = this.ensureCtx();
    this.localSource = ctx.createMediaStreamSource(raw);
    this.micGainNode = ctx.createGain();
    this.localAnalyser = ctx.createAnalyser();
    this.localAnalyser.fftSize = 256;
    this.micDest = ctx.createMediaStreamDestination();
    this.monitorGain = ctx.createGain();
    this.localSource.connect(this.micGainNode);
    this.micGainNode.connect(this.localAnalyser);
    this.micGainNode.connect(this.micDest);
    this.micGainNode.connect(this.monitorGain).connect(ctx.destination);
    this.applyMicTuning();
    this.micStream = this.micDest.stream;
    this.rawMicStream = raw;

    // Já na chamada: troca a faixa enviada sem renegociar.
    const track = this.micStream.getAudioTracks()[0];
    if (!track) return;
    if (oldPubTrack && this.pubs.mic) {
      await oldPubTrack.replaceTrack(track, { userProvidedTrack: true });
    }
  }

  async setMic(deviceId: string) {
    if (!MEDIA_FEATURES.voice) { this.releaseMic(); return; }
    if (deviceId === "none") {
      if (this.pubs.mic?.track && this.room) await this.room.localParticipant.unpublishTrack(this.pubs.mic.track, false);
      this.pubs.mic = undefined;
      this.releaseMic();
      await this.publishPresence();
      return;
    }
    await this.openMic(deviceId);
    if (this.room && !this.pubs.mic) await this.publishMic();
    this.applyMicEnabled();
    await this.publishPresence();
  }

  private async publishMic() {
    const track = this.micStream?.getAudioTracks()[0];
    if (!MEDIA_FEATURES.voice || !this.room || !track || this.pubs.mic) return;
    this.pubs.mic = await this.room.localParticipant.publishTrack(track, {
      source: Track.Source.Microphone,
      name: "mic",
      dtx: true,
      red: true,
      audioPreset: AudioPresets.speech,
    });
    this.applyMicEnabled();
  }

  /** Publica tudo que já está ligado (após entrar ou reconectar). */
  private async publishAll() {
    const s = getState();
    try {
      await this.publishMic();
    } catch (e) {
      console.warn("[voice] publish mic", e);
    }
    if (s.localCam) await this.publishCam(s.localCam).catch((e) => console.warn("[voice] publish cam", e));
    if (s.localScreen) await this.publishScreen(s.localScreen).catch((e) => console.warn("[voice] publish screen", e));
  }

  async setMuted(v: boolean) {
    setState({ muted: v });
    this.applyMicEnabled();
    if (v) sfx.mute();
    else sfx.unmute();
    await this.publishPresence();
  }

  async setDeafened(v: boolean) {
    if (!MEDIA_FEATURES.voice) return;
    setState({ deafened: v });
    this.remote.forEach((r) => {
      if (r.micEl) r.micEl.muted = v;
      if (r.screenEl) r.screenEl.muted = v;
    });
    this.applyMicEnabled();
    if (v) sfx.deafen();
    else sfx.undeafen();
    await this.publishPresence();
  }

  setPttHeld(v: boolean) {
    if (getState().pttHeld === v) return;
    setState({ pttHeld: v });
    this.applyMicEnabled();
  }

  moveMember(target: string, channel: ChannelId) {
    if (target === this.me) return void this.joinChannel(channel);
    void this.presence?.send({ type: "broadcast", event: "move", payload: { target, channel } });
  }

  /* ---------------- câmera ---------------- */

  async startCam(deviceId: string) {
    if (deviceId === "none") return;
    if (!this.room || getState().voiceStatus !== "connected") throw new Error("Aguarde a conexão com a sala antes de ligar a câmera.");
    // Free the current hardware before reopening it (some drivers allow one capture only).
    await this.stopCam();
    await this.closePhoneCam(true);
    const { stream, usedDefault } = await acquireCamera(deviceId);
    if (usedDefault) setState((s) => ({ devices: { ...s.devices, cam: "default" } }));
    try {
      await this.setLocalCam(stream, false);
      sfx.camStart();
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      await this.stopCam();
      throw e;
    }
  }

  private async publishCam(stream: MediaStream) {
    const t = stream.getVideoTracks()[0];
    if (!this.room || !t || this.pubs.cam) return;
    this.pubs.cam = await this.room.localParticipant.publishTrack(t, {
      source: Track.Source.Camera,
      name: "cam",
      // Mesmo codec da transmissão (H.264): evita dois codificadores diferentes na GPU.
      videoCodec: "h264",
      simulcast: !getState().sharing,
      videoEncoding: { maxBitrate: 900_000, maxFramerate: 24 },
    });
  }

  private async unpublishCam() {
    const t = this.pubs.cam?.track;
    this.pubs.cam = undefined;
    if (t && this.room) await this.room.localParticipant.unpublishTrack(t, false).catch(() => {});
  }

  private async setLocalCam(stream: MediaStream | null, fromPhone: boolean) {
    const prev = getState().localCam;
    if (prev && prev !== stream) {
      await this.unpublishCam();
      if (!getState().phoneCamConnected) prev.getTracks().forEach((t) => t.stop());
    }
    setState({ localCam: stream, camOn: !!stream, phoneCamConnected: fromPhone && !!stream });
    if (stream) {
      stream.getVideoTracks().forEach((t) => (t.onended = () => {
        if (getState().localCam === stream) {
          void this.stopCam();
          toast.error("A câmera foi desconectada. Conecte novamente ou escolha outra nas configurações.");
        }
      }));
      try { await this.publishCam(stream); }
      catch (e) {
        setState({ localCam: null, camOn: false, phoneCamConnected: false });
        throw new Error("A câmera abriu, mas não foi possível enviá-la à sala. Tente novamente.");
      }
    }
    await this.publishPresence();
  }

  async stopCam(publish = true) {
    const s = getState();
    if (!s.localCam) return;
    await this.unpublishCam();
    if (!s.phoneCamConnected) s.localCam.getTracks().forEach((t) => t.stop());
    setState({ localCam: null, camOn: false, phoneCamConnected: false });
    if (publish) { sfx.camStop(); await this.publishPresence(); }
  }

  /* ---------------- celular como webcam ---------------- */

  /** Abre a sala privada da câmera do celular e devolve o link para o QR. */
  openPhoneCam(): Promise<string> {
    const op = this.phoneOp.then(() => this.doOpenPhoneCam());
    this.phoneOp = op.catch(() => {});
    return op;
  }

  private async doOpenPhoneCam(): Promise<string> {
    this.camDialogOpen = true;
    const s = getState();
    if (!s.token) throw new Error("Sessão inválida.");
    if (!this.room || s.voiceStatus !== "connected") throw new Error("Aguarde a conexão com a sala antes de conectar o celular.");
    const { url, jwt, phoneKey } = await getPhoneHostToken({ data: { token: s.token, peerId: this.me } });
    if (!this.camRoom) {
      const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
      room
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== Track.Kind.Video) return;
          // Faixa do celular embrulhada num fluxo local estável e republicada no canal de voz.
          void this.setLocalCam(new MediaStream([track.mediaStreamTrack]), true).then(() => sfx.camStart()).catch((e) => toast.error(cameraErrorMessage(e)));
        })
        .on(RoomEvent.TrackUnsubscribed, () => {
          if (getState().phoneCamConnected) void this.stopCam();
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          if (getState().phoneCamConnected) void this.stopCam();
          if (!this.camDialogOpen) void this.closePhoneCam();
        });
      this.camRoom = room;
      try { await room.connect(url, jwt, { autoSubscribe: true }); }
      catch (e) {
        this.camRoom = null;
        room.removeAllListeners();
        await room.disconnect(true).catch(() => {});
        throw new Error("Não foi possível conectar o celular. Tente abrir o QR novamente.");
      }
    }
    return `${window.location.origin}/cam/${this.me}?k=${encodeURIComponent(phoneKey)}`;
  }

  /** Fecha a sala do celular quando ninguém mais precisa dela (economiza conexão). */
  closePhoneCam(force = false): Promise<void> {
    const op = this.phoneOp.then(() => this.doClosePhoneCam(force));
    this.phoneOp = op.catch(() => {});
    return op;
  }

  private async doClosePhoneCam(force = false) {
    this.camDialogOpen = false;
    if (!this.camRoom) return;
    if (!force && getState().phoneCamConnected) return;
    const r = this.camRoom;
    this.camRoom = null;
    r.removeAllListeners();
    await r.disconnect(true).catch(() => {});
    if (getState().phoneCamConnected) await this.stopCam();
  }

  /* ---------------- transmissão de tela ---------------- */

  async startShare() {
    if (!this.room || getState().voiceStatus !== "connected") throw new Error("Aguarde a conexão com a sala antes de transmitir.");
    if (getState().sharing) return;
    const prof = shareProfileParams(getState().settings.shareProfile);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: prof.width }, height: { ideal: prof.height }, frameRate: { ideal: prof.fps, max: prof.fps } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: "exclude",
      windowAudio: "exclude",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions);
    // Picker hints may be ignored: enforce isolation on the actual returned surface.
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    // Captura seletiva: o componente auxiliar isola o processo escolhido e
    // nunca inclui o Discord — vale para qualquer superfície.
    if (this.helper.selectedPid != null && (this.helper.status === "ready" || this.helper.status === "capturing")) {
      this.shareAudioTrack = await this.helper.startCapture();
    }
    if (!allowScreenAudio(surface, this.shareAudioTrack != null)) {
      stream.getAudioTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
      toast("Tela/janela compartilhada sem áudio para não retransmitir as vozes do Discord.");
    } else if (this.shareAudioTrack) {
      // A faixa do helper substitui o áudio bruto do sistema.
      stream.getAudioTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
      toast("Transmitindo o áudio do programa selecionado, sem as vozes do Discord.");
    }
    const v = stream.getVideoTracks()[0];
    if (v) {
      v.contentHint = "motion";
      v.onended = () => {
        if (getState().localScreen !== stream) return;
        void this.stopShare();
        toast("A transmissão foi encerrada pelo Windows (janela fechada/minimizada ou troca de tela cheia). Prefira compartilhar a tela inteira em jogos.");
      };
    }
    setState({ localScreen: stream, sharing: true });
    try { await this.publishScreen(stream); }
    catch (e) {
      await this.stopShare(false);
      throw new Error("Não foi possível enviar a transmissão. Tente novamente.");
    }
    sfx.shareStart();
    await this.publishPresence();
  }

  private async publishScreen(stream: MediaStream) {
    if (!this.room) return;
    const v = stream.getVideoTracks()[0];
    const a = this.shareAudioTrack ?? (safeScreenAudio(v?.getSettings().displaySurface) ? stream.getAudioTracks()[0] : undefined);
    if (v && !this.pubs.screen) {
      this.pubs.screen = await this.room.localParticipant.publishTrack(v, {
        source: Track.Source.ScreenShare,
        name: "screen",
        simulcast: false,
        videoCodec: "h264", // codificação por hardware na maioria dos PCs
        degradationPreference: "maintain-framerate",
        screenShareEncoding: { maxBitrate: shareProfileParams(getState().settings.shareProfile).maxBitrate, maxFramerate: shareProfileParams(getState().settings.shareProfile).fps },
        videoEncoding: { maxBitrate: shareProfileParams(getState().settings.shareProfile).maxBitrate, maxFramerate: shareProfileParams(getState().settings.shareProfile).fps },
      });
    }
    if (a && !this.pubs.screenAudio) {
      this.pubs.screenAudio = await this.room.localParticipant.publishTrack(a, {
        source: Track.Source.ScreenShareAudio,
        name: "screen-audio",
        dtx: false,
        red: false,
        audioPreset: { maxBitrate: 96_000 },
      });
    }
  }

  /** Troca (ou remove) o programa cujo som vai na transmissão, sem reiniciar o vídeo. */
  async changeShareAudio(pid: number | null) {
    if (pid != null) this.helper.selectProcess(pid);
    const s = getState();
    if (!s.sharing || !s.localScreen || !this.room) return;
    const lp = this.room.localParticipant;
    const old = this.pubs.screenAudio?.track;
    this.pubs.screenAudio = undefined;
    if (old) await lp.unpublishTrack(old, false).catch(() => {});
    await this.helper.stopCapture();
    this.shareAudioTrack = null;
    if (pid == null || !(this.helper.status === "ready" || this.helper.status === "capturing")) return;
    try {
      this.shareAudioTrack = await this.helper.startCapture();
      if (this.shareAudioTrack) {
        await this.publishScreen(s.localScreen);
        toast("Áudio da transmissão trocado para o programa selecionado.");
      }
    } catch (e) {
      toast.error("Não foi possível capturar o áudio desse programa.");
      console.warn("[share-audio]", e);
    }
  }

  async stopShare(publish = true) {
    const s = getState();
    if (!s.localScreen) return;
    const lp = this.room?.localParticipant;
    for (const key of ["screen", "screenAudio"] as const) {
      const t = this.pubs[key]?.track;
      this.pubs[key] = undefined;
      if (t && lp) await lp.unpublishTrack(t, false).catch(() => {});
    }
    s.localScreen.getTracks().forEach((t) => t.stop());
    this.shareAudioTrack = null;
    await this.helper.stopCapture();
    setState({ localScreen: null, sharing: false });
    sfx.shareStop();
    if (publish) await this.publishPresence();
  }
}

/* ---------------- Celular (roda no smartphone) ---------------- */

export class PhoneCamClient {
  private host: string;
  private key: string;
  private room: Room | null = null;
  private stream: MediaStream | null = null;
  onState: (s: string) => void = () => {};

  constructor(host: string, key: string) {
    this.host = host;
    this.key = key;
  }

  async start(facing: "environment" | "user" = "environment") {
    await this.stop();
    try {
    // Sem resolução pedida o navegador entrega 640x480 recortado do sensor (parece zoom).
    // Pede o quadro nativo inteiro (resizeMode "none" = sem corte/escala) em alta resolução;
    // a orientação segue a do celular (retrato/paisagem).
    // Pede o quadro inteiro do sensor (4:3 nativo, sem recorte para 16:9 e sem escala).
    // Não forçamos 16:9: isso fazia o navegador cortar o sensor e parecia zoom.
    const native = { facingMode: { exact: facing }, width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 }, resizeMode: "none" } as MediaTrackConstraints;
    const gum = (v: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video: v, audio: false });
    this.stream = await gum(native)
      .catch(() => gum({ ...native, facingMode: facing }))
      .catch(() => gum({ facingMode: facing }));
    const vt = this.stream.getVideoTracks()[0];
    if (!vt) throw new Error("Câmera não encontrada.");
    // Campo de visão total: zoom óptico/digital no mínimo e sem efeitos do navegador.
    const caps = (vt.getCapabilities?.() ?? {}) as { zoom?: { min?: number }; resizeMode?: string[] };
    const adv: Record<string, unknown> = {};
    if (caps.zoom?.min != null) adv["zoom"] = caps.zoom.min;
    if (caps.resizeMode?.includes("none")) adv["resizeMode"] = "none";
    if (Object.keys(adv).length) await vt.applyConstraints({ advanced: [adv] } as unknown as MediaTrackConstraints).catch(() => {});
    vt.onended = () => { void this.stop(); this.onState("disconnected"); };
    this.onState("connecting");
    const { url, jwt } = await getPhoneCamToken({ data: { key: this.key, host: this.host } });
    const room = new Room({ adaptiveStream: false, dynacast: true, disconnectOnPageLeave: true, stopLocalTrackOnUnpublish: true });
    this.room = room;
    room
      .on(RoomEvent.ParticipantConnected, () => this.onState("connected"))
      .on(RoomEvent.ParticipantDisconnected, () => this.onState("waiting"))
      .on(RoomEvent.Reconnecting, () => this.onState("connecting"))
      .on(RoomEvent.Reconnected, () => this.onState(room.remoteParticipants.size ? "connected" : "waiting"))
      .on(RoomEvent.Disconnected, () => this.onState("disconnected"));
    await room.connect(url, jwt);
    await room.localParticipant.publishTrack(vt, {
      source: Track.Source.Camera,
      simulcast: false,
      videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
      degradationPreference: "maintain-resolution",
    });
    this.onState(room.remoteParticipants.size ? "connected" : "waiting");
    return this.stream;
    } catch (e) {
      await this.stop();
      throw e;
    }
  }

  async stop() {
    const r = this.room;
    this.room = null;
    r?.removeAllListeners();
    await r?.disconnect(true).catch(() => {});
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.stream = null;
  }
}

/* ---------------- singleton ---------------- */

let client: VoiceClient | null = null;
export function getClient(peerId: string) {
  if (!client || client.me !== peerId) client = new VoiceClient(peerId);
  if (import.meta.env.DEV) (window as unknown as { __voice?: VoiceClient }).__voice = client;
  return client;
}
export function currentClient() {
  return client;
}
