import { useState } from "react";
import {
  Activity,
  Hash,
  Headphones,
  HeadphoneOff,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Settings,
  Smartphone,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/paje-logo.png";
import { cn } from "@/lib/utils";
import { VOICE_CHANNELS, setState, useApp, type ChannelId, type Member } from "@/lib/store";
import type { VoiceClient } from "@/lib/rtc";
import { Avatar } from "./Avatar";
import { SettingsDialog } from "./SettingsDialog";
import { PhoneCamDialog } from "./PhoneCamDialog";

function MemberRow({ m, speaking, me }: { m: Member; speaking: boolean; me: string }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/peer", m.peerId);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-sidebar-accent cursor-grab active:cursor-grabbing text-sm"
      title="Arraste para mover de canal"
    >
      <Avatar src={m.avatar} name={m.nickname} size={22} speaking={speaking} />
      <span className={cn("truncate flex-1", m.peerId === me ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/80")}>
        {m.nickname}
      </span>
      <span className="flex items-center gap-1 text-muted-foreground">
        {m.screenStream && <MonitorUp className="h-3.5 w-3.5 text-primary" />}
        {m.camStream && <Video className="h-3.5 w-3.5" />}
        {m.deafened ? <HeadphoneOff className="h-3.5 w-3.5 text-destructive" /> : m.muted ? <MicOff className="h-3.5 w-3.5 text-destructive" /> : null}
      </span>
    </div>
  );
}

export function Sidebar({ client }: { client: VoiceClient }) {
  const members = useApp((s) => s.members);
  const speaking = useApp((s) => s.speaking);
  const myChannel = useApp((s) => s.myChannel);
  const view = useApp((s) => s.view);
  const profile = useApp((s) => s.profile)!;
  const muted = useApp((s) => s.muted);
  const deafened = useApp((s) => s.deafened);
  const camOn = useApp((s) => s.camOn);
  const sharing = useApp((s) => s.sharing);
  const pings = useApp((s) => s.pings);
  const devices = useApp((s) => s.devices);
  const connected = useApp((s) => s.connected);
  const ptt = useApp((s) => s.settings.ptt);
  const pttHeld = useApp((s) => s.pttHeld);
  const [dragOver, setDragOver] = useState<ChannelId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);

  const pingValues = Object.values(pings);
  const ping = pingValues.length ? Math.round(pingValues.reduce((a, b) => a + b, 0) / pingValues.length) : null;
  const pingTone = ping == null ? "text-muted-foreground" : ping < 80 ? "text-online" : ping < 160 ? "text-warning" : "text-destructive";

  async function toggleCam() {
    try {
      if (camOn) await client.stopCam();
      else if (devices.cam === "none") toast("Webcam desativada nas configurações.");
      else await client.startCam(devices.cam);
    } catch {
      toast.error("Não foi possível acessar a webcam.");
    }
  }

  async function toggleShare() {
    try {
      if (sharing) await client.stopShare();
      else await client.startShare();
    } catch {
      /* user cancelled */
    }
  }

  const inVoice = !!myChannel;

  return (
    <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
      <header className="h-12 px-4 flex items-center justify-between border-b border-sidebar-border">
        <span className="flex items-center gap-2 font-display font-semibold tracking-tight" title="Bem-vindos à tribo Akidauânus!">
          <img src={logo} alt="" className="h-6 w-6 object-contain" />
          Pajé
        </span>
        <span className={cn("flex items-center gap-1 text-xs font-mono", pingTone)} title="Latência média P2P">
          <Activity className="h-3.5 w-3.5" />
          {connected ? (ping == null ? "—" : `${ping} ms`) : "off"}
        </span>
      </header>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        <div>
          <p className="px-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Canais de voz</p>
          {VOICE_CHANNELS.map((ch) => {
            const list = Object.values(members).filter((m) => m.channel === ch.id);
            const active = view === ch.id;
            return (
              <div
                key={ch.id}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("text/peer")) {
                    e.preventDefault();
                    setDragOver(ch.id);
                  }
                }}
                onDragLeave={() => setDragOver((d) => (d === ch.id ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData("text/peer");
                  if (id) client.moveMember(id, ch.id);
                }}
                className={cn("rounded-md mb-1 transition-colors", dragOver === ch.id && "bg-primary/15 ring-1 ring-primary/50")}
              >
                <button
                  onClick={() => void client.joinChannel(ch.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-sidebar-accent transition-colors",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                    myChannel === ch.id && "font-medium",
                  )}
                >
                  <Volume2 className={cn("h-4 w-4", myChannel === ch.id ? "text-online" : "text-muted-foreground")} />
                  <span className="flex-1 text-left">{ch.name}</span>
                  {ch.autoMute && <span className="text-[10px] text-muted-foreground">auto-mute</span>}
                  {list.length > 0 && <span className="text-xs text-muted-foreground font-mono">{list.length}</span>}
                </button>
                {list.length > 0 && (
                  <div className="pl-4 pb-1">
                    {list.map((m) => (
                      <MemberRow key={m.peerId} m={m} speaking={!!speaking[m.peerId]} me={profile.peerId} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div>
          <p className="px-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Canal de texto</p>
          <button
            onClick={() => setState({ view: "text" })}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-sidebar-accent transition-colors",
              view === "text" && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Hash className="h-4 w-4 text-muted-foreground" />
            <span>geral</span>
          </button>
        </div>
      </nav>

      {inVoice && (
        <div className="mx-2 mb-2 rounded-md bg-sidebar-accent/60 px-3 py-2 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs text-online font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-online animate-pulse-soft" /> Conectado
            </p>
            <p className="text-xs text-muted-foreground truncate">{VOICE_CHANNELS.find((c) => c.id === myChannel)?.name}</p>
          </div>
          <button className="icon-btn h-8 w-8" title="Sair do canal" onClick={() => void client.leaveChannel()}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      )}

      <footer className="border-t border-sidebar-border p-2">
        <div className="flex items-center gap-2 px-1 pb-2">
          <Avatar src={profile.avatar} name={profile.nickname} size={30} speaking={!!speaking[profile.peerId]} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate leading-tight">{profile.nickname}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {ptt ? (pttHeld ? "Falando (PTT)" : "Push-to-talk") : muted ? "Mutado" : "Voz ativa"}
            </p>
          </div>
          <button className="icon-btn h-8 w-8" title="Configurações" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1">
          <button className="icon-btn" data-active={muted || deafened} title="Mutar microfone" onClick={() => void client.setMuted(!muted)}>
            {muted || deafened ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button className="icon-btn" data-active={deafened} title="Surdina (entrada + saída)" onClick={() => void client.setDeafened(!deafened)}>
            {deafened ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
          </button>
          <button className="icon-btn" data-on={camOn} title="Webcam" onClick={() => void toggleCam()} disabled={!inVoice}>
            {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </button>
          <button className="icon-btn" title="Usar celular como webcam" onClick={() => setPhoneOpen(true)} disabled={!inVoice}>
            <Smartphone className="h-4 w-4" />
          </button>
          <button className="icon-btn" data-on={sharing} title="Transmitir tela" onClick={() => void toggleShare()} disabled={!inVoice}>
            {sharing ? <MonitorX className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}
          </button>
        </div>
      </footer>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} client={client} />
      <PhoneCamDialog open={phoneOpen} onOpenChange={setPhoneOpen} />
    </aside>
  );
}
