import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Camera, RefreshCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cameraErrorMessage } from "@/lib/media";
import { PhoneCamClient } from "@/lib/rtc";

export const Route = createFileRoute("/cam/$host")({
  head: () => ({
    meta: [
      { title: "Celular como webcam — Pajé" },
      { name: "description", content: "Use a câmera do seu celular como webcam na sala do Pajé." },
      { property: "og:title", content: "Celular como webcam — Pajé" },
      { property: "og:description", content: "Aponte a câmera e ela aparece na sala de voz no computador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({ k: typeof s["k"] === "string" ? (s["k"] as string) : "" }),
  component: CamPage,
});

function CamPage() {
  const { host } = Route.useParams();
  const { k } = Route.useSearch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const clientRef = useRef<PhoneCamClient | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [status, setStatus] = useState("Toque em iniciar para liberar a câmera.");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    return () => {
      void clientRef.current?.stop();
      clientRef.current = null;
    };
  }, []);

  async function start(next: "environment" | "user" = facing) {
    if (busy) return;
    setBusy(true);
    try {
      await clientRef.current?.stop();
      const c = new PhoneCamClient(host, k);
      c.onState = (s) => {
        if (s === "disconnected") { setLive(false); if (videoRef.current) videoRef.current.srcObject = null; }
        setStatus(
          s === "connected"
            ? "Conectado ao computador."
            : s === "connecting"
              ? "Conectando…"
              : s === "waiting"
                ? "Aguardando o computador abrir o QR…"
                : "Desconectado. Toque em iniciar câmera para reconectar.",
        );
      };
      clientRef.current = c;
      const stream = await c.start(next);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setFacing(next);
      setLive(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setLive(false);
      if (videoRef.current) videoRef.current.srcObject = null;
      setStatus(/Link/.test(msg) ? msg : cameraErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground flex flex-col items-center gap-4 p-4">
      <h1 className="text-lg font-semibold mt-2">Celular como webcam</h1>
      <div className="w-full max-w-sm aspect-[3/4] rounded-xl overflow-hidden bg-tile grid place-items-center">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
      </div>
      <p className="text-sm text-muted-foreground text-center">{status}</p>
      <div className="flex gap-2">
        {!live ? (
          <Button disabled={busy || !k} onClick={() => void start()} className="h-11 px-6 font-semibold">
            <Camera /> Iniciar câmera
          </Button>
        ) : (
          <Button
            disabled={busy}
            variant="secondary"
            className="h-11"
            onClick={() => void start(facing === "environment" ? "user" : "environment")}
          >
            <RefreshCcw /> Virar câmera
          </Button>
        )}
        {live && <Button variant="destructive" disabled={busy} onClick={async () => { await clientRef.current?.stop(); setLive(false); if (videoRef.current) videoRef.current.srcObject = null; setStatus("Câmera desligada."); }}><Square /> Parar</Button>}
      </div>
      <p className="text-xs text-muted-foreground text-center max-w-xs">
        Mantenha esta página aberta e a tela ligada enquanto estiver usando a câmera.
      </p>
    </div>
  );
}
