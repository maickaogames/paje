import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { PasswordGate } from "@/components/app/PasswordGate";
import { SetupModal } from "@/components/app/SetupModal";
import { Sidebar } from "@/components/app/Sidebar";
import { TextChannel } from "@/components/app/TextChannel";
import { VoiceView } from "@/components/app/VoiceView";
import { MEDIA_FEATURES } from "@/lib/media-policy";
import { getClient } from "@/lib/rtc";
import { getState, useApp } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pajé — Bem-vindos à tribo Akidauânus!" },
      {
        name: "description",
        content:
          "Compartilhamento de tela e câmeras para jogar com amigos junto ao Discord, sem cadastro e com baixo consumo de CPU.",
      },
      { property: "og:title", content: "Pajé — Bem-vindos à tribo Akidauânus!" },
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

  if (!profile) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar client={client} />
      <main className="flex-1 flex min-w-0">
        {MEDIA_FEATURES.text && view === "text" ? <TextChannel /> : <VoiceView channel={view === "text" ? "gameplay-1" : view} client={client} />}
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
