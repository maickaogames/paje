import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { PasswordGate } from "@/components/app/PasswordGate";
import { SetupModal } from "@/components/app/SetupModal";
import { Sidebar } from "@/components/app/Sidebar";
import { TextChannel } from "@/components/app/TextChannel";
import { VoiceView } from "@/components/app/VoiceView";
import { getClient } from "@/lib/rtc";
import { getState, useApp } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LiteVoice — voz e vídeo leves para o seu grupo" },
      {
        name: "description",
        content:
          "Sala de voz, vídeo e transmissão de tela peer-to-peer para jogar com amigos, sem cadastro e com baixo consumo de CPU.",
      },
      { property: "og:title", content: "LiteVoice — voz e vídeo leves para o seu grupo" },
      {
        property: "og:description",
        content: "Entre com a senha do grupo, escolha um apelido e fale com os amigos direto no navegador.",
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
  const profile = useApp((s) => s.profile)!;
  const view = useApp((s) => s.view);
  const settings = useApp((s) => s.settings);
  const client = getClient(profile.peerId);

  useEffect(() => {
    void client.start();
    return () => {
      void client.stop();
    };
  }, [client]);

  // Hotkeys: push-to-talk, mute, deafen.
  useEffect(() => {
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

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar client={client} />
      <main className="flex-1 flex min-w-0">
        {view === "text" ? <TextChannel /> : <VoiceView channel={view} client={client} />}
      </main>
    </div>
  );
}

function Index() {
  const hydrated = useHydrated();
  const token = useApp((s) => s.token);
  const profile = useApp((s) => s.profile);

  if (!hydrated) return <div className="min-h-screen bg-background" />;

  return (
    <>
      {!token ? <PasswordGate /> : !profile ? <SetupModal /> : <App />}
      <Toaster />
    </>
  );
}
