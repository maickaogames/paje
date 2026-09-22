/**
 * LiteVoice realtime client.
 * - Presence + broadcast (Lovable Cloud realtime) for signaling only.
 * - WebRTC mesh between members of the same voice channel (P2P media).
 * - Single AudioContext: per-peer gain (local volume), master gain (deafen), analysers (VAD).
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getState, setState, type ChannelId, type Member, type RemoteStreams, VOICE_CHANNELS } from "./store";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  // Retransmissão pública gratuita: salva conexões em redes restritivas (CGNAT, Wi-Fi corporativo).
  {
    urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443?transport=tcp"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];
const ROOM = "litevoice-room";

interface Signal {
  to: string;
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
}

interface PresenceEntry {
  role: "member" | "phonecam";
  host?: string;
  peerId: string;
  nickname: string;
  avatar: string | null;
  channel: ChannelId | null;
  muted: boolean;
  deafened: boolean;
  micStream: string | null;
  camStream: string | null;
  screenStream: string | null;
}

class Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer = false;
  ignoreOffer = false;
  streams = new Map<string, MediaStream>();
  senders = new Map<MediaStreamTrack, RTCRtpSender>();
  source: MediaStreamAudioSourceNode | undefined;
  gain: GainNode | undefined;
  analyser: AnalyserNode | undefined;
  screenSource: MediaStreamAudioSourceNode | undefined;
  screenGain: GainNode | undefined;
  keepAlive: HTMLAudioElement[] = [];
  micStreamId: string | null = null;
  screenStreamId: string | null = null;

  constructor(pc: RTCPeerConnection, polite: boolean) {
    this.pc = pc;
    this.polite = polite;
  }
}

export class VoiceClient {
  me: string;
  private channel: RealtimeChannel | null = null;
  private peers = new Map<string, Peer>();
  private phonePeer: Peer | null = null;
  private micStream: MediaStream | null = null;
  private rawMicStream: MediaStream | null = null;
  private micGainNode: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private micDest: MediaStreamAudioDestinationNode | null = null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private vadTimer: number | null = null;
  private statsTimer: number | null = null;
  private vadBuf = new Uint8Array(256);
  private started = false;
  private op: Promise<void> = Promise.resolve();

  constructor(peerId: string) {
    this.me = peerId;
  }

  /* ---------------- lifecycle ---------------- */

  /** start/stop are serialized: React remounts must never leave us half-connected. */
  start() {
    this.op = this.op.then(() => this.doStart()).catch((e) => console.warn("start failed", e));
    return this.op;
  }

  stop() {
    this.op = this.op.then(() => this.doStop()).catch((e) => console.warn("stop failed", e));
    return this.op;
  }

  private async doStart() {
    if (this.started) return;
    this.started = true;
    this.channel = supabase.channel(ROOM, {
      config: { presence: { key: this.me }, broadcast: { self: false, ack: false } },
    });
    this.channel
      .on("presence", { event: "sync" }, () => this.onSync())
      .on("broadcast", { event: "signal" }, ({ payload }) => this.onSignal(payload as Signal))
      .on("broadcast", { event: "move" }, ({ payload }) => {
        const p = payload as { target: string; channel: ChannelId };
        if (p.target === this.me) void this.joinChannel(p.channel);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setState({ connected: true });
          await this.publishPresence();
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          setState({ connected: false });
        }
      });

    document.addEventListener("visibilitychange", this.onVisibility);
    this.vadTimer = window.setInterval(() => this.runVad(), 100);
    this.statsTimer = window.setInterval(() => void this.collectStats(), 3000);
  }

  private async doStop() {
    if (!this.started) return;
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.vadTimer) clearInterval(this.vadTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    await this.leaveChannel();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.rawMicStream = null;
    if (this.channel) await supabase.removeChannel(this.channel);
    this.channel = null;
    this.started = false;
    setState({ connected: false, members: {} });
  }

  private onVisibility = () => {
    const hidden = document.visibilityState === "hidden";
    setState({ hidden });
    const s = getState();
    if (s.settings.powerSave && s.localCam && !s.phoneCamConnected) {
      s.localCam.getVideoTracks().forEach((t) => (t.enabled = !hidden));
    }
  };

  /* ---------------- presence ---------------- */

  private presencePayload(): PresenceEntry {
    const s = getState();
    return {
      role: "member",
      peerId: this.me,
      nickname: s.profile?.nickname ?? "?",
      avatar: s.profile?.avatar ?? null,
      channel: s.myChannel,
      muted: s.muted || s.deafened,
      deafened: s.deafened,
      micStream: this.micStream?.id ?? null,
      camStream: s.localCam?.id ?? null,
      screenStream: s.localScreen?.id ?? null,
    };
  }

  async publishPresence() {
    if (!this.channel) return;
    await this.channel.track(this.presencePayload());
  }

  private onSync() {
    if (!this.channel) return;
    const raw = this.channel.presenceState<PresenceEntry>();
    const members: Record<string, Member> = {};
    let phoneOnline = false;
    for (const key of Object.keys(raw)) {
      const entry = raw[key]?.[0];
      if (!entry) continue;
      if (entry.role === "phonecam") {
        if (entry.host === this.me) phoneOnline = true;
        continue;
      }
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
      };
    }
    setState({ members });
    this.reconcilePeers(members);
    if (!phoneOnline && this.phonePeer) this.dropPhonePeer();
  }

  private reconcilePeers(members: Record<string, Member>) {
    const myChannel = getState().myChannel;
    const wanted = new Set<string>();
    if (myChannel) {
      for (const m of Object.values(members)) {
        if (m.peerId !== this.me && m.channel === myChannel) wanted.add(m.peerId);
      }
    }
    for (const id of [...this.peers.keys()]) {
      if (!wanted.has(id)) this.closePeer(id);
    }
    for (const id of wanted) {
      if (!this.peers.has(id)) this.createPeer(id);
      this.resolveStreams(id);
    }
    const s = getState();
    if (s.watching && !wanted.has(s.watching)) setState({ watching: null });
  }

  /* ---------------- peers ---------------- */

  private createPeer(id: string, opts: { phone?: boolean } = {}): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: "max-bundle" });
    // Deterministic politeness avoids glare (perfect negotiation).
    const polite = opts.phone ? true : this.me > id;
    const peer = new Peer(pc, polite);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ to: id, from: this.me, description: pc.localDescription! });
      } catch (e) {
        console.warn("negotiation failed", e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      this.send({ to: id, from: this.me, candidate: candidate ? candidate.toJSON() : null });
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") pc.restartIce();
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      peer.streams.set(stream.id, stream);
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) {
          peer.streams.delete(stream.id);
          if (opts.phone) this.onPhoneStream(null);
          else this.resolveStreams(id);
        }
      };
      if (opts.phone) this.onPhoneStream(stream);
      else this.resolveStreams(id);
    };

    if (!opts.phone) {
      this.peers.set(id, peer);
      // Attach whatever we're currently sending.
      const s = getState();
      const mic = this.micStream?.getAudioTracks()[0];
      if (mic && this.micStream) this.addTrackTo(peer, mic, this.micStream);
      if (s.localCam) s.localCam.getTracks().forEach((t) => this.addTrackTo(peer, t, s.localCam!));
      if (s.localScreen) s.localScreen.getTracks().forEach((t) => this.addTrackTo(peer, t, s.localScreen!));
    }
    return peer;
  }

  private addTrackTo(peer: Peer, track: MediaStreamTrack, stream: MediaStream) {
    if (peer.senders.has(track)) return;
    const sender = peer.pc.addTrack(track, stream);
    peer.senders.set(track, sender);
    if (track.kind === "video" && stream === getState().localScreen) {
      void this.tuneScreenSender(sender);
    }
  }

  private removeTrackFrom(peer: Peer, track: MediaStreamTrack) {
    const sender = peer.senders.get(track);
    if (!sender) return;
    try {
      peer.pc.removeTrack(sender);
    } catch {
      /* ignore */
    }
    peer.senders.delete(track);
  }

  private async tuneScreenSender(sender: RTCRtpSender) {
    try {
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      const enc = p.encodings[0]!;
      enc.maxBitrate = 8_000_000;
      enc.maxFramerate = 60;
      p.degradationPreference = "maintain-framerate";
      await sender.setParameters(p);
    } catch {
      /* not supported */
    }
  }

  private closePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    this.teardownAudio(peer);
    peer.pc.onnegotiationneeded = null;
    peer.pc.ontrack = null;
    peer.pc.close();
    setState((s) => {
      const streams = { ...s.streams };
      delete streams[id];
      const speaking = { ...s.speaking };
      delete speaking[id];
      const pings = { ...s.pings };
      delete pings[id];
      return { streams, speaking, pings };
    });
  }

  /* ---------------- signaling ---------------- */

  private send(msg: Signal) {
    void this.channel?.send({ type: "broadcast", event: "signal", payload: msg });
  }

  private async onSignal(msg: Signal) {
    if (msg.to !== this.me) return;
    let peer: Peer | undefined;
    if (msg.from === `${this.me}:cam`) {
      if (!this.phonePeer) this.phonePeer = this.createPeer(msg.from, { phone: true });
      peer = this.phonePeer;
    } else {
      peer = this.peers.get(msg.from);
      if (!peer) {
        const m = getState().members[msg.from];
        const myCh = getState().myChannel;
        if (!m || !myCh || m.channel !== myCh) return;
        peer = this.createPeer(msg.from);
      }
    }
    const { pc } = peer;
    try {
      if (msg.description) {
        const offerCollision =
          msg.description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(msg.description);
        if (msg.description.type === "offer") {
          await pc.setLocalDescription();
          this.send({ to: msg.from, from: this.me, description: pc.localDescription! });
        }
      } else if (msg.candidate !== undefined) {
        try {
          await pc.addIceCandidate(msg.candidate ?? undefined);
        } catch (e) {
          if (!peer.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn("signal error", e);
    }
  }

  /* ---------------- remote streams / audio graph ---------------- */

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.master.gain.value = getState().deafened ? 0 : 1;
      void this.applySink();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  async applySink() {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    const speaker = getState().devices.speaker;
    if (!ctx?.setSinkId) return;
    try {
      if (speaker === "none") await ctx.setSinkId("");
      else if (speaker !== "default") await ctx.setSinkId(speaker);
      else await ctx.setSinkId("");
    } catch {
      /* unsupported device */
    }
  }

  private resolveStreams(id: string) {
    const peer = this.peers.get(id);
    const m = getState().members[id];
    if (!peer || !m) return;
    const mic = m.micStream ? peer.streams.get(m.micStream) : undefined;
    const cam = m.camStream ? peer.streams.get(m.camStream) : undefined;
    const screen = m.screenStream ? peer.streams.get(m.screenStream) : undefined;

    // audio graph for mic
    if (mic && peer.micStreamId !== mic.id) {
      this.detachMicAudio(peer);
      const ctx = this.ensureCtx();
      peer.source = ctx.createMediaStreamSource(mic);
      peer.gain = ctx.createGain();
      peer.gain.gain.value = getState().volumes[id] ?? 1;
      peer.analyser = ctx.createAnalyser();
      peer.analyser.fftSize = 256;
      peer.source.connect(peer.gain).connect(this.master!);
      peer.source.connect(peer.analyser);
      peer.keepAlive.push(this.keepAliveEl(mic));
      peer.micStreamId = mic.id;
    } else if (!mic && peer.micStreamId) {
      this.detachMicAudio(peer);
    }

    // audio graph for screen share audio
    const screenAudio = screen?.getAudioTracks().length ? screen : undefined;
    if (screenAudio && peer.screenStreamId !== screenAudio.id) {
      this.detachScreenAudio(peer);
      const ctx = this.ensureCtx();
      peer.screenSource = ctx.createMediaStreamSource(screenAudio);
      peer.screenGain = ctx.createGain();
      peer.screenGain.gain.value = getState().screenVolume;
      peer.screenSource.connect(peer.screenGain).connect(this.master!);
      peer.keepAlive.push(this.keepAliveEl(screenAudio));
      peer.screenStreamId = screenAudio.id;
    } else if (!screenAudio && peer.screenStreamId) {
      this.detachScreenAudio(peer);
    }

    const prev = getState().streams[id];
    if (prev?.mic !== mic || prev?.cam !== cam || prev?.screen !== screen) {
      const next: RemoteStreams = { mic, cam, screen };
      setState((s) => ({ streams: { ...s.streams, [id]: next } }));
      if (!screen && getState().watching === id) setState({ watching: null });
    }
  }

  /** Chrome only pulls remote audio into WebAudio if an <audio> element consumes it. */
  private keepAliveEl(stream: MediaStream) {
    const el = document.createElement("audio");
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    void el.play().catch(() => {});
    return el;
  }

  private detachMicAudio(peer: Peer) {
    peer.source?.disconnect();
    peer.gain?.disconnect();
    peer.analyser?.disconnect();
    peer.source = peer.gain = peer.analyser = undefined;
    peer.micStreamId = null;
  }

  private detachScreenAudio(peer: Peer) {
    peer.screenSource?.disconnect();
    peer.screenGain?.disconnect();
    peer.screenSource = peer.screenGain = undefined;
    peer.screenStreamId = null;
  }

  private teardownAudio(peer: Peer) {
    this.detachMicAudio(peer);
    this.detachScreenAudio(peer);
    peer.keepAlive.forEach((el) => {
      el.srcObject = null;
    });
    peer.keepAlive = [];
  }

  setVolume(id: string, v: number) {
    setState((s) => ({ volumes: { ...s.volumes, [id]: v } }));
    const p = this.peers.get(id);
    if (p?.gain) p.gain.gain.value = v;
  }

  setScreenVolume(v: number) {
    setState({ screenVolume: v });
    this.peers.forEach((p) => {
      if (p.screenGain) p.screenGain.gain.value = v;
    });
  }

  /* ---------------- VAD ---------------- */

  private rms(an: AnalyserNode) {
    an.getByteTimeDomainData(this.vadBuf);
    let sum = 0;
    for (let i = 0; i < this.vadBuf.length; i++) {
      const v = ((this.vadBuf[i] ?? 128) - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.vadBuf.length);
  }

  private runVad() {
    const s = getState();
    if (!s.myChannel) return;
    const th = s.settings.vadThreshold;
    const next: Record<string, boolean> = {};
    let changed = false;
    const micOn = this.micSending();
    const mine = micOn && this.localAnalyser ? this.rms(this.localAnalyser) > th : false;
    next[this.me] = mine;
    if (!!s.speaking[this.me] !== mine) changed = true;
    this.peers.forEach((p, id) => {
      const v = p.analyser ? this.rms(p.analyser) > th : false;
      next[id] = v;
      if (!!s.speaking[id] !== v) changed = true;
    });
    if (changed || Object.keys(s.speaking).length !== Object.keys(next).length) setState({ speaking: next });
  }

  /* ---------------- stats / ping ---------------- */

  private async collectStats() {
    if (this.peers.size === 0) return;
    const pings: Record<string, number> = {};
    await Promise.all(
      [...this.peers.entries()].map(async ([id, p]) => {
        try {
          const report = await p.pc.getStats();
          report.forEach((r) => {
            if (r.type === "candidate-pair" && (r.nominated || r.selected) && r.currentRoundTripTime != null) {
              pings[id] = Math.round(r.currentRoundTripTime * 1000);
            }
          });
        } catch {
          /* ignore */
        }
      }),
    );
    setState({ pings });
  }

  /* ---------------- mic ---------------- */

  private micSending() {
    const s = getState();
    if (!this.micStream) return false;
    if (s.muted || s.deafened) return false;
    if (s.settings.ptt && !s.pttHeld) return false;
    return true;
  }

  applyMicEnabled() {
    const on = this.micSending();
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  /** Ganho (sensibilidade) e monitoramento local, sem reabrir o microfone. */
  applyMicTuning() {
    const s = getState().settings;
    if (this.micGainNode) this.micGainNode.gain.value = s.micGain;
    if (this.monitorGain) this.monitorGain.gain.value = s.micMonitor ? 1 : 0;
  }

  /** Reabre o microfone para aplicar o supressor de ruído. */
  async reopenMic() {
    const d = getState().devices.mic;
    if (d === "none" || !this.rawMicStream) return;
    await this.setMic(d);
  }

  async setMic(deviceId: string) {
    const old = this.micStream;
    const oldRaw = this.rawMicStream;
    if (deviceId === "none") {
      if (old) {
        old.getTracks().forEach((t) => {
          this.peers.forEach((p) => this.removeTrackFrom(p, t));
          t.stop();
        });
      }
      oldRaw?.getTracks().forEach((t) => t.stop());
      this.micStream = this.rawMicStream = null;
      this.localSource?.disconnect();
      this.micGainNode?.disconnect();
      this.monitorGain?.disconnect();
      this.localSource = this.localAnalyser = null;
      this.micGainNode = this.monitorGain = this.micDest = null;
      await this.publishPresence();
      return;
    }
    const st = getState().settings;
    const constraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: st.noiseSuppression,
      autoGainControl: st.noiseSuppression,
      channelCount: 1,
    };
    if (deviceId !== "default") constraints.deviceId = { exact: deviceId };
    const raw = await navigator.mediaDevices.getUserMedia({ audio: constraints });

    // Cadeia: microfone → ganho → (destino enviado aos amigos, analisador de fala, monitor)
    const ctx = this.ensureCtx();
    this.localSource?.disconnect();
    this.micGainNode?.disconnect();
    this.monitorGain?.disconnect();
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

    const stream = this.micDest.stream;
    const track = stream.getAudioTracks()[0]!;
    const oldTrack = old?.getAudioTracks()[0];
    this.micStream = stream;
    this.rawMicStream = raw;
    if (oldRaw && oldRaw !== raw) oldRaw.getTracks().forEach((t) => t.stop());

    this.peers.forEach((p) => {
      const sender = oldTrack ? p.senders.get(oldTrack) : undefined;
      if (sender) {
        void sender.replaceTrack(track);
        p.senders.delete(oldTrack!);
        p.senders.set(track, sender);
      } else {
        this.addTrackTo(p, track, stream);
      }
    });
    oldTrack?.stop();
    this.applyMicEnabled();
    await this.publishPresence();
  }

  async setMuted(v: boolean) {
    setState({ muted: v });
    this.applyMicEnabled();
    await this.publishPresence();
  }

  async setDeafened(v: boolean) {
    setState({ deafened: v });
    if (this.master) this.master.gain.value = v ? 0 : 1;
    this.applyMicEnabled();
    await this.publishPresence();
  }

  setPttHeld(v: boolean) {
    if (getState().pttHeld === v) return;
    setState({ pttHeld: v });
    this.applyMicEnabled();
  }

  /* ---------------- channels ---------------- */

  async joinChannel(ch: ChannelId) {
    const s = getState();
    if (s.myChannel === ch) {
      setState({ view: ch });
      return;
    }
    this.ensureCtx();
    setState({ myChannel: ch, view: ch, watching: null });
    if (!this.micStream && s.devices.mic !== "none") {
      try {
        await this.setMic(s.devices.mic);
      } catch (e) {
        console.warn("mic unavailable", e);
      }
    }
    const def = VOICE_CHANNELS.find((c) => c.id === ch);
    if (def?.autoMute && !getState().muted) await this.setMuted(true);
    await this.publishPresence();
    this.reconcilePeers(getState().members);
  }

  async leaveChannel() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    await this.stopShare(false);
    await this.stopCam(false);
    setState({ myChannel: null, view: "text", watching: null, speaking: {}, pings: {} });
    await this.publishPresence();
  }

  moveMember(target: string, channel: ChannelId) {
    if (target === this.me) return void this.joinChannel(channel);
    void this.channel?.send({ type: "broadcast", event: "move", payload: { target, channel } });
  }

  /* ---------------- camera ---------------- */

  async startCam(deviceId: string) {
    if (deviceId === "none") return;
    const constraints: MediaTrackConstraints = {
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 24, max: 30 },
    };
    if (deviceId !== "default") constraints.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
    await this.setLocalCam(stream, false);
  }

  private async setLocalCam(stream: MediaStream | null, fromPhone: boolean) {
    const prev = getState().localCam;
    if (prev && prev !== stream) {
      prev.getTracks().forEach((t) => {
        this.peers.forEach((p) => this.removeTrackFrom(p, t));
        if (!getState().phoneCamConnected) t.stop();
      });
    }
    setState({ localCam: stream, camOn: !!stream, phoneCamConnected: fromPhone && !!stream });
    if (stream) {
      stream.getTracks().forEach((t) => {
        t.onended = () => void this.stopCam();
        this.peers.forEach((p) => this.addTrackTo(p, t, stream));
      });
    }
    await this.publishPresence();
  }

  async stopCam(publish = true) {
    const s = getState();
    if (!s.localCam) return;
    const wasPhone = s.phoneCamConnected;
    s.localCam.getTracks().forEach((t) => {
      this.peers.forEach((p) => this.removeTrackFrom(p, t));
      if (!wasPhone) t.stop();
    });
    setState({ localCam: null, camOn: false, phoneCamConnected: false });
    if (publish) await this.publishPresence();
  }

  /* ---------------- phone camera ---------------- */

  private onPhoneStream(stream: MediaStream | null) {
    if (!stream) {
      if (getState().phoneCamConnected) void this.stopCam();
      return;
    }
    // Wrap the remote track in a fresh local stream so peers see a stable id.
    const wrapped = new MediaStream(stream.getVideoTracks());
    void this.setLocalCam(wrapped, true);
  }

  private dropPhonePeer() {
    if (!this.phonePeer) return;
    this.phonePeer.pc.close();
    this.phonePeer = null;
    if (getState().phoneCamConnected) void this.stopCam();
  }

  /* ---------------- screen share ---------------- */

  async startShare() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, max: 60 },
      },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const v = stream.getVideoTracks()[0];
    if (v) {
      v.contentHint = "motion";
      v.onended = () => void this.stopShare();
    }
    setState({ localScreen: stream, sharing: true });
    stream.getTracks().forEach((t) => this.peers.forEach((p) => this.addTrackTo(p, t, stream)));
    await this.publishPresence();
  }

  async stopShare(publish = true) {
    const s = getState();
    if (!s.localScreen) return;
    s.localScreen.getTracks().forEach((t) => {
      this.peers.forEach((p) => this.removeTrackFrom(p, t));
      t.stop();
    });
    setState({ localScreen: null, sharing: false });
    if (publish) await this.publishPresence();
  }
}

/* ---------------- Phone camera source (runs on the smartphone) ---------------- */

export class PhoneCamClient {
  private host: string;
  private me: string;
  private channel: RealtimeChannel | null = null;
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private makingOffer = false;
  onState: (s: string) => void = () => {};

  constructor(host: string) {
    this.host = host;
    this.me = `${host}:cam`;
  }

  async start(facing: "environment" | "user" = "environment") {
    this.stream = await navigator.mediaDevices.getUserMedia({
      // Sem pedir resolução: o celular escolhe a câmera padrão, sem recorte/zoom.
      video: { facingMode: facing },
      audio: false,
    });
    // Garante zoom no mínimo (padrão do telefone) quando a câmera expõe esse controle.
    const vt = this.stream.getVideoTracks()[0];
    const caps = (vt?.getCapabilities?.() ?? {}) as { zoom?: { min?: number } };
    if (vt && caps.zoom?.min != null) {
      try {
        await vt.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] } as unknown as MediaTrackConstraints);
      } catch {
        /* ignore */
      }
    }
    this.channel = supabase.channel(ROOM, {
      config: { presence: { key: this.me }, broadcast: { self: false, ack: false } },
    });
    this.channel
      .on("broadcast", { event: "signal" }, ({ payload }) => void this.onSignal(payload as Signal))
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await this.channel!.track({ role: "phonecam", host: this.host, peerId: this.me });
          this.connect();
        }
      });
    return this.stream;
  }

  private connect() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ to: this.host, from: this.me, description: pc.localDescription! });
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) =>
      this.send({ to: this.host, from: this.me, candidate: candidate ? candidate.toJSON() : null });
    pc.onconnectionstatechange = () => this.onState(pc.connectionState);
    this.stream!.getTracks().forEach((t) => pc.addTrack(t, this.stream!));
  }

  private send(msg: Signal) {
    void this.channel?.send({ type: "broadcast", event: "signal", payload: msg });
  }

  private async onSignal(msg: Signal) {
    if (msg.to !== this.me || !this.pc) return;
    try {
      if (msg.description) {
        // Phone is impolite: ignore colliding offers.
        if (msg.description.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable")) return;
        await this.pc.setRemoteDescription(msg.description);
        if (msg.description.type === "offer") {
          await this.pc.setLocalDescription();
          this.send({ to: this.host, from: this.me, description: this.pc.localDescription! });
        }
      } else if (msg.candidate !== undefined) {
        await this.pc.addIceCandidate(msg.candidate ?? undefined);
      }
    } catch (e) {
      console.warn("phone signal error", e);
    }
  }

  async stop() {
    this.pc?.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.channel) await supabase.removeChannel(this.channel);
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
