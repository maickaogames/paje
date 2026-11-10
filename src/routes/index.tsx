import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { PasswordGate } from "@/components/app/PasswordGate";
import { SetupModal } from "@/components/app/SetupModal";
import { Sidebar } from "@/components/app/Sidebar";
import { TextChannel } from "@/components/app/TextChannel";
import { VoiceView } from "@/components/app/VoiceView";
import { PipView } from "@/components/app/PipView";
import { UpdateStatus } from "@/components/app/UpdateStatus";
import { toggleCam, toggleShare } from "@/lib/actions";
import { isDesktop, onGlobalHotkey, setGlobalHotkeys, setPipMode } from "@/lib/desktop";
import { DEFAULT_HOTKEYS, comboFromEvent, comboLabel, comboToAccelerator, type HotkeyAction } from "@/lib/hotkeys";
import { pipSize, togglePip } from "@/lib/pip";
import { runUpdate } from "@/lib/updater";
import { MEDIA_FEATURES } from "@/lib/media-policy";
import { getClient } from "@/lib/rtc";
import { getState, useApp } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pajé — yvy’ã ra’ tupá xere fuma" },
      {
        name: "description",
        content:
          "Compartilhamento de tela e câmeras para jogar com amigos junto ao Discord, sem cadastro e com baixo consumo de CPU.",
      },
      { property: "og:title", content: "Pajé — yvy’ã ra’ tupá xere fuma" },
      {
        property: "og:description",
        content: "Entre com a senha do grupo, compartilhe a tela e veja seus amigos pela webcam ou câmera do celular.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}

function App() {
  const profile = useApp((s) => s.profile);
  const view = useApp((s) => s.view);
  const settings = useApp((s) => s.settings);
  const client = getClient(profile?.peerId ?? "");

  useEffect(() => {
    if (!profile) return;
    void client.start();
    return () => {
      void client.stop();
    };
  }, [client, profile]);

  // Hotkeys: push-to-talk, mute, deafen.
  useEffect(() => {
    if (!MEDIA_FEATURES.voice) return;
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (settings.ptt && e.code === settings.pttKey) {
        e.preventDefault();
        client.setPttHeld(true);
        return;
      }
      if (e.code === settings.muteKey) {
        e.preventDefault();
        void client.setMuted(!getState().muted);
      } else if (e.code === settings.deafenKey) {
        e.preventDefault();
        void client.setDeafened(!getState().deafened);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (settings.ptt && e.code === settings.pttKey) client.setPttHeld(false);
    };
    const blur = () => client.setPttHeld(false);

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [client, settings.ptt, settings.pttKey, settings.muteKey, settings.deafenKey]);

  // Atalhos configuráveis: globais no app Windows (funcionam com o jogo em foco), na janela na web.
  const hotkeys = { ...DEFAULT_HOTKEYS, ...settings.hotkeys };
  const hotkeyKey = JSON.stringify(hotkeys);
  useEffect(() => {
    const run = (a: string) => {
      if (a === "cam") void toggleCam(client);
      else if (a === "share") void toggleShare(client);
      else if (a === "pip") void togglePip();
    };
    const entries = Object.entries(hotkeys).filter(([, c]) => !!c) as [HotkeyAction, string][];
    if (isDesktop()) {
      let unlisten: (() => void) | null = null;
      let cancelled = false;
      void setGlobalHotkeys(entries.map(([action, c]) => ({ action, accelerator: comboToAccelerator(c) })))
        .then((failed) => {
          if (failed.length) toast.error(`Atalho em uso por outro programa: ${failed.map(comboLabel).join(", ")}`);
        })
        .catch((e) => console.warn("[hotkeys]", e));
      void onGlobalHotkey(run).then((u) => (cancelled ? u() : (unlisten = u)));
      return () => {
        cancelled = true;
        unlisten?.();
        void setGlobalHotkeys([]).catch(() => {});
      };
    }
    const down = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const combo = comboFromEvent(e);
      const hit = entries.find(([, c]) => c === combo);
      if (!hit) return;
      e.preventDefault();
      run(hit[0]);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [client, hotkeyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pipOpen = useApp((s) => s.pipOpen);
  const pipWindow = useApp((s) => s.pipWindow);
  const pipKey = JSON.stringify(settings.pip ?? null);
  // Mudou tamanho/posição com o PiP aberto no app Windows: reaplica.
  useEffect(() => {
    if (!pipOpen || !isDesktop()) return;
    const { w, h, corner } = pipSize();
    void setPipMode(true, w, h, corner).catch(() => {});
  }, [pipOpen, pipKey]);

  if (!profile) return null;

  if (pipOpen && isDesktop()) return <PipView />;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar client={client} />
      <main className="flex-1 flex min-w-0">
        {MEDIA_FEATURES.text && view === "text" ? <TextChannel /> : <VoiceView channel={view === "text" ? "gameplay-1" : view} client={client} />}
      </main>
      {pipOpen && pipWindow && createPortal(<PipView />, pipWindow.document.body)}
    </div>
  );
}

function Index() {
  const hydrated = useHydrated();
  const token = useApp((s) => s.token);
  const profile = useApp((s) => s.profile);

  // Ao abrir o app Windows, verifica atualizações (mesmo fluxo do botão "Atualizar Pajé").
  useEffect(() => {
    if (hydrated && isDesktop()) void runUpdate();
  }, [hydrated]);

  if (!hydrated) return <div className="min-h-screen bg-background" />;

  return (
    <>
      {!token ? <PasswordGate /> : !profile ? <SetupModal /> : <App />}
      <UpdateStatus />
      <Toaster />
    </>
  );
}
