import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { currentClient } from "@/lib/rtc";
import { useApp } from "@/lib/store";

export function PhoneCamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const connected = useApp((s) => s.phoneCamConnected);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = currentClient();
    if (!open || !c) return;
    let alive = true;
    setError(null);
    c.openPhoneCam()
      .then(async (u) => {
        if (!alive) return;
        setUrl(u);
        setQr(await QRCode.toDataURL(u, { margin: 1, width: 240, color: { dark: "#f4f1ea", light: "#00000000" } }));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Falha ao preparar o link."));
    return () => {
      alive = false;
      void c.closePhoneCam();
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-card">
        <DialogHeader>
          <DialogTitle>Celular como webcam</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Escaneie com o celular. O link vale por 12 horas e só serve para enviar a câmera.
        </p>
        <div className="grid place-items-center py-2">
          {error ? (
            <p className="text-sm text-destructive text-center">{error}</p>
          ) : qr ? (
            <img src={qr} alt="QR code" className="rounded-lg" />
          ) : (
            <div className="h-60 w-60 rounded-lg bg-muted animate-pulse" />
          )}
        </div>
        {url && <code className="block text-xs text-center break-all bg-surface rounded-md p-2 select-all">{url}</code>}
        <p className={connected ? "text-sm text-online text-center" : "text-sm text-muted-foreground text-center"}>
          {connected ? "Celular conectado — a câmera dele está sendo usada." : "Aguardando o celular…"}
        </p>
      </DialogContent>
    </Dialog>
  );
}
