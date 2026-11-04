import { useState } from "react";
import { Download, Activity, LogOut, MonitorUp, MonitorX, Settings, Smartphone, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/paje-logo.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VOICE_CHANNELS, useApp } from "@/lib/store";
import { cameraErrorMessage } from "@/lib/media";
import type { VoiceClient } from "@/lib/rtc";
import { Avatar } from "./Avatar";
import { SettingsDialog } from "./SettingsDialog";
import { PhoneCamDialog } from "./PhoneCamDialog";
import { ShareAudioDialog } from "./ShareAudioDialog";

const WINDOWS_DOWNLOAD_URL = "https://github.com/maickaogames/paje/releases/latest/download/Paje-Setup.exe";

export function Sidebar({ client }: { client: VoiceClient }) {
  const members = useApp((s) => s.members);
  const myChannel = useApp((s) => s.myChannel);
  const view = useApp((s) => s.view);
  const profile = useApp((s) => s.profile);
  const camOn = useApp((s) => s.camOn);
  const sharing = useApp((s) => s.sharing);
  const devices = useApp((s) => s.devices);
  const connected = useApp((s) => s.connected);
  const status = useApp((s) => s.voiceStatus);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [shareAudioOpen, setShareAudioOpen] = useState(false);
  const [camBusy, setCamBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const ready = !!myChannel && status === "connected";
  if (!profile) return null;

  async function toggleCam() {
    setCamBusy(true);
    try {
      if (camOn) await client.stopCam();
      else if (devices.cam === "none") toast("Escolha uma webcam nas configurações ou use o celular.");
      else await client.startCam(devices.cam);
    } catch (e) { toast.error(cameraErrorMessage(e)); }
    finally { setCamBusy(false); }
  }

  async function toggleShare() {
    setShareBusy(true);
    try { if (sharing) await client.stopShare(); else await client.startShare(); }
    catch (e) {
      if ((e as { name?: string })?.name !== "NotAllowedError") toast.error(e instanceof Error ? e.message : "Não foi possível iniciar a transmissão.");
    } finally { setShareBusy(false); }
  }

  return (
    <aside className="w-60 max-sm:w-44 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
      <header className="h-12 px-3 flex items-center justify-between border-b border-sidebar-border">
        <span className="flex items-center gap-2 font-display font-semibold" title="Bem-vindos à tribo Akidauânus!">
          <img src={logo} alt="" className="h-7 w-7 object-contain" /> Pajé
        </span>
        <Activity className={cn("h-4 w-4", connected ? "text-online" : "text-warning")} aria-label={connected ? "Online" : "Reconectando"} />
      </header>
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
        <div>
          <p className="px-2 text-xs text-muted-foreground font-semibold mb-2">Salas de vídeo</p>
          {VOICE_CHANNELS.map((ch) => {
            const list = Object.values(members).filter((m) => m.channel === ch.id);
            return (
              <div key={ch.id} className="mb-2">
                <Button variant="ghost" onClick={() => void client.joinChannel(ch.id)} className={cn("w-full justify-start px-2", view === ch.id && "bg-sidebar-accent text-sidebar-accent-foreground")}>
                  <Video className={myChannel === ch.id ? "text-online" : "text-muted-foreground"} />
                  <span className="flex-1 text-left">{ch.name}</span><span className="text-xs text-muted-foreground">{list.length}</span>
                </Button>
                <div className="pl-3">
                  {list.map((m) => <div key={m.peerId} className="flex items-center gap-2 py-1 px-1 text-xs min-w-0">
                    <Avatar src={m.avatar} name={m.nickname} size={22} />
                    <span className="truncate flex-1">{m.nickname}</span>
                    {m.screenStream && <MonitorUp className="h-3 w-3 text-primary shrink-0" />}
                    {m.camStream && <Video className="h-3 w-3 text-muted-foreground shrink-0" />}
                  </div>)}
                </div>
              </div>
            );
          })}
        </div>
      </nav>
      {myChannel && <div className="mx-2 mb-2 flex items-center justify-between border-t border-sidebar-border pt-2">
        <div className="min-w-0 px-1">
          <p className={cn("text-xs font-medium", ready ? "text-online" : "text-warning")}>
            {ready ? "Conectado" : status === "failed" ? "Conexão interrompida" : "Conectando…"}
          </p>
          <p className="text-xs text-muted-foreground truncate">{VOICE_CHANNELS.find((c) => c.id === myChannel)?.name}</p>
        </div>
        <Button variant="ghost" size="icon" title="Sair da sala" aria-label="Sair da sala" onClick={() => void client.leaveChannel()}><LogOut /></Button>
      </div>}
      <footer className="border-t border-sidebar-border p-2">
        <div className="flex items-center gap-2 pb-2">
          <Avatar src={profile.avatar} name={profile.nickname} size={30} />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{profile.nickname}</p><p className="text-xs text-muted-foreground">{camOn ? "Câmera ligada" : "Câmera desligada"}</p></div>
          <Button variant="ghost" size="icon" title="Configurações" aria-label="Configurações" onClick={() => setSettingsOpen(true)}><Settings /></Button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Button variant={camOn ? "secondary" : "ghost"} title="Webcam" aria-label="Webcam" onClick={() => void toggleCam()} disabled={!ready || camBusy}>{camOn ? <Video /> : <VideoOff />}</Button>
          <Button variant="ghost" title="Usar celular como webcam" aria-label="Usar celular como webcam" onClick={() => setPhoneOpen(true)} disabled={!ready}><Smartphone /></Button>
          <Button variant={sharing ? "secondary" : "ghost"} title={sharing ? "Encerrar transmissão" : "Transmitir tela"} aria-label={sharing ? "Encerrar transmissão" : "Transmitir tela"} onClick={() => void toggleShare()} disabled={!ready || shareBusy}>{sharing ? <MonitorX /> : <MonitorUp />}</Button>
        </div>
        {WINDOWS_DOWNLOAD_URL && typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && (
          <a
            href={WINDOWS_DOWNLOAD_URL}
            className="mt-3 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2.5 hover:bg-primary/20 hover:border-primary transition-colors"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"><Download className="h-4 w-4" /></span>
            <span className="min-w-0 leading-tight">
              <span className="block text-sm font-semibold text-foreground">Baixar para Windows</span>
              <span className="block text-xs text-muted-foreground">App leve para jogar</span>
            </span>
          </a>
        )}
      </footer>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} client={client} />
      <PhoneCamDialog open={phoneOpen} onOpenChange={setPhoneOpen} />
      <ShareAudioDialog open={shareAudioOpen} onOpenChange={setShareAudioOpen} client={client} />
    </aside>
  );
}
