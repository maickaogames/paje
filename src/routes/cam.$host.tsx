import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Camera, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneCamClient } from "@/lib/rtc";

export const Route = createFileRoute("/cam/$host")({
  head: () => ({
    meta: [
      { title: "Celular como webcam — LiteVoice" },
      { name: "description", content: "Use a câmera do seu celular como webcam na sala do LiteVoice." },
      { property: "og:title", content: "Celular como webcam — LiteVoice" },
      { property: "og:description", content: "Aponte a câmera e ela aparece na sala de voz no computador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CamPage,
});

function CamPage() {
  const { host } = Route.useParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const clientRef = useRef<PhoneCamClient | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [status, setStatus] = useState("Toque em iniciar para liberar a câmera.");
  const [live, setLive] = useState(false);

  useEffect(() => {
    return () => {
      void clientRef.current?.stop();
      clientRef.current = null;
    };
  }, []);

  async function start(next: "environment" | "user" = facing) {
    try {
      await clientRef.current?.stop();
      const c = new PhoneCamClient(host);
      c.onState = (s) =>
        setStatus(
          s === "connected" ? "Conectado ao computador." : s === "connecting" ? "Conectando…" : `Conexão: ${s}`,
        );
      clientRef.current = c;
      const stream = await c.start(next);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setFacing(next);
      setLive(true);
      setStatus("Aguardando o computador…");
    } catch {
      setStatus("Não foi possível acessar a câmera. Permita o acesso e tente de novo.");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center gap-4 p-4">
      <h1 className="text-lg font-semibold mt-2">Celular como webcam</h1>
      <div className="w-full max-w-sm aspect-[3/4] rounded-xl overflow-hidden bg-tile grid place-items-center">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      </div>
      <p className="text-sm text-muted-foreground text-center">{status}</p>
      <div className="flex gap-2">
        {!live ? (
          <Button onClick={() => void start()} className="h-11 px-6 font-semibold">
            <Camera /> Iniciar câmera
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="h-11"
            onClick={() => void start(facing === "environment" ? "user" : "environment")}
          >
            <RefreshCcw /> Virar câmera
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center max-w-xs">
        Mantenha esta página aberta e a tela ligada enquanto estiver usando a câmera.
      </p>
    </div>
  );
}
