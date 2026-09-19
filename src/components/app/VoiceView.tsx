import { useEffect, useRef, useState } from "react";
import { HeadphoneOff, LogIn, Maximize2, MicOff, MonitorUp, MonitorX, Volume2 } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VOICE_CHANNELS, setState, useApp, type ChannelId, type Member } from "@/lib/store";
import type { VoiceClient } from "@/lib/rtc";
import { Avatar } from "./Avatar";

/** Video element that pauses in power-save mode when the tab is hidden. */
function Video({ stream, mirror, className, muted = true }: { stream: MediaStream; mirror?: boolean; className?: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const hidden = useApp((s) => s.hidden);
  const powerSave = useApp((s) => s.settings.powerSave);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (hidden && powerSave) el.pause();
    else void el.play().catch(() => {});
  }, [hidden, powerSave]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={cn("h-full w-full object-cover bg-background", mirror && "-scale-x-100", className)}
    />
  );
}

function Tile({ m, me, client }: { m: Member; me: string; client: VoiceClient }) {
  const speaking = useApp((s) => !!s.speaking[m.peerId]);
  const remote = useApp((s) => s.streams[m.peerId]);
  const localCam = useApp((s) => s.localCam);
  const localSharing = useApp((s) => s.sharing);
  const phoneCam = useApp((s) => s.phoneCamConnected);
  const volume = useApp((s) => s.volumes[m.peerId] ?? 1);
  const ping = useApp((s) => s.pings[m.peerId]);
  const isMe = m.peerId === me;
  const cam = isMe ? localCam : remote?.cam;
  const hasScreen = isMe ? localSharing : !!remote?.screen;


  const tile = (
    <div
      className={cn(
        "relative aspect-video rounded-xl bg-tile overflow-hidden grid place-items-center transition-shadow",
        speaking ? "ring-speaking" : "ring-idle",
      )}
    >
      {cam ? (
        <Video stream={cam} mirror={isMe && !phoneCam} />
      ) : (
        <Avatar src={m.avatar} name={m.nickname} size={88} />
      )}
      <div className="absolute left-2 bottom-2 flex items-center gap-1.5 rounded-md bg-background/70 backdrop-blur px-2 py-1 text-xs">
        <span className="font-medium">{m.nickname}</span>
        {isMe && <span className="text-muted-foreground">(você)</span>}
        {m.deafened ? <HeadphoneOff className="h-3.5 w-3.5 text-destructive" /> : m.muted ? <MicOff className="h-3.5 w-3.5 text-destructive" /> : null}
        {!isMe && ping != null && <span className="font-mono text-muted-foreground">{ping}ms</span>}
      </div>
      {hasScreen && (
        <button
          onClick={() => setState({ watching: m.peerId })}
          className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-xs font-semibold hover:bg-primary/90"
        >
          <MonitorUp className="h-3.5 w-3.5" /> AO VIVO
        </button>
      )}
    </div>
  );

  if (isMe) return tile;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tile}</ContextMenuTrigger>
      <ContextMenuContent className="w-56 p-3">
        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          <Volume2 className="h-3.5 w-3.5" /> Volume de {m.nickname}: {Math.round(volume * 100)}%
        </p>
        <Slider min={0} max={2} step={0.05} value={[volume]} onValueChange={([v]) => client.setVolume(m.peerId, v ?? 1)} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function useAppPhone() {
  return useApp((s) => s.phoneCamConnected);
}

function ScreenViewer({ owner, me, client }: { owner: Member; me: string; client: VoiceClient }) {
  const remote = useApp((s) => s.streams[owner.peerId]?.screen);
  const local = useApp((s) => s.localScreen);
  const screenVolume = useApp((s) => s.screenVolume);
  const isMe = owner.peerId === me;
  const stream = isMe ? local : remote;
  const boxRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={boxRef} className="relative flex-1 min-h-0 rounded-xl bg-background overflow-hidden group">
      {stream ? (
        <Video stream={stream} className="object-contain" />
      ) : (
        <div className="h-full grid place-items-center text-muted-foreground text-sm">Conectando à transmissão…</div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-3 flex items-center gap-3 bg-gradient-to-t from-background/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-sm font-medium">{owner.nickname} está transmitindo</span>
        <span className="flex-1" />
        {!isMe && (
          <div className="flex items-center gap-2 w-40">
            <Volume2 className="h-4 w-4 text-muted-foreground" />
            <Slider min={0} max={1.5} step={0.05} value={[screenVolume]} onValueChange={([v]) => client.setScreenVolume(v ?? 1)} />
          </div>
        )}
        <Button size="sm" variant="secondary" onClick={() => void boxRef.current?.requestFullscreen?.()}>
          <Maximize2 /> Tela cheia
        </Button>
        {isMe ? (
          <Button size="sm" variant="destructive" onClick={() => void client.stopShare()}>
            <MonitorX /> Encerrar transmissão
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setState({ watching: null })}>
            Fechar
          </Button>
        )}
      </div>
    </div>
  );
}

export function VoiceView({ channel, client }: { channel: ChannelId; client: VoiceClient }) {
  const members = useApp((s) => s.members);
  const myChannel = useApp((s) => s.myChannel);
  const me = useApp((s) => s.profile!.peerId);
  const watching = useApp((s) => s.watching);
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), [channel]);

  const list = Object.values(members)
    .filter((m) => m.channel === channel)
    .sort((a, b) => (a.peerId === me ? -1 : b.peerId === me ? 1 : a.nickname.localeCompare(b.nickname)));
  const def = VOICE_CHANNELS.find((c) => c.id === channel)!;
  const here = myChannel === channel;
  const watched = watching && here ? list.find((m) => m.peerId === watching) : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-12 px-5 flex items-center gap-3 border-b">
        <Volume2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">{def.name}</h2>
        <span className="text-xs text-muted-foreground">{list.length} na sala</span>
        <span className="flex-1" />
        {!here && (
          <Button size="sm" onClick={() => void client.joinChannel(channel)}>
            <LogIn /> Entrar no canal
          </Button>
        )}
      </header>

      <div className="flex-1 min-h-0 p-4 flex flex-col gap-3">
        {watched && <ScreenViewer owner={watched} me={me} client={client} />}
        {list.length === 0 ? (
          <div className="flex-1 grid place-items-center text-muted-foreground text-sm">Ninguém aqui ainda.</div>
        ) : (
          <div
            className={cn(
              "grid gap-3",
              watched ? "grid-flow-col auto-cols-[180px] overflow-x-auto pb-1" : "flex-1 content-center",
            )}
            style={
              watched
                ? undefined
                : { gridTemplateColumns: `repeat(auto-fit, minmax(${list.length > 4 ? 240 : 320}px, 1fr))` }
            }
          >
            {list.map((m) => (
              <Tile key={m.peerId} m={m} me={me} client={client} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
