import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/lib/store";

export function PhoneCamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const peerId = useApp((s) => s.profile?.peerId);
  const connected = useApp((s) => s.phoneCamConnected);
  const [qr, setQr] = useState<string | null>(null);
  const url = typeof window !== "undefined" && peerId ? `${window.location.origin}/cam/${peerId}` : "";

  useEffect(() => {
    if (!open || !url) return;
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#f4f1ea", light: "#00000000" } }).then(setQr);
  }, [open, url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-card">
        <DialogHeader>
          <DialogTitle>Celular como webcam</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Abra este link no celular (mesma rede Wi‑Fi dá o melhor resultado). O vídeo vai direto do celular para este computador.
        </p>
        <div className="grid place-items-center py-2">
          {qr ? <img src={qr} alt="QR code" className="rounded-lg" /> : <div className="h-60 w-60 rounded-lg bg-muted animate-pulse" />}
        </div>
        <code className="block text-xs text-center break-all bg-surface rounded-md p-2 select-all">{url}</code>
        <p className={connected ? "text-sm text-online text-center" : "text-sm text-muted-foreground text-center"}>
          {connected ? "Celular conectado — a câmera dele está sendo usada." : "Aguardando o celular…"}
        </p>
      </DialogContent>
    </Dialog>
  );
}
