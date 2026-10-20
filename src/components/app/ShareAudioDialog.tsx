import { useEffect } from "react";
import { AudioLines, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setState, useApp } from "@/lib/store";
import type { VoiceClient } from "@/lib/rtc";

/**
 * Áudio seletivo da transmissão: escolhe qual programa terá o som capturado
 * pelo componente auxiliar local. O Discord nunca entra na transmissão.
 */
export function ShareAudioDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: VoiceClient;
}) {
  const status = useApp((s) => s.helperStatus);
  const processes = useApp((s) => s.helperProcesses);
  const pid = useApp((s) => s.helperPid);

  useEffect(() => {
    if (!open) return;
    void client.helper.connect().then((ok) => {
      if (ok) client.helper.refreshProcesses();
    });
  }, [open, client]);

  const available = status === "ready" || status === "capturing";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AudioLines className="h-4 w-4" /> Áudio da transmissão
          </DialogTitle>
        </DialogHeader>

        {status === "connecting" && <p className="text-sm text-muted-foreground">Procurando o componente auxiliar…</p>}

        {(status === "off" || status === "unavailable") && (
          <div className="space-y-3">
            <p className="text-sm">
              Para transmitir o som de um jogo ou programa <strong>sem incluir as vozes do Discord</strong>, é
              preciso instalar o componente auxiliar do Pajé no Windows.
            </p>
            <p className="text-xs text-muted-foreground">
              Sem ele, a transmissão de tela ou janela vai sem áudio, e só abas do navegador levam som. O
              componente captura apenas o programa que você escolher — o Discord nunca é transmitido.
            </p>
            <Button variant="outline" size="sm" onClick={() => void client.helper.connect().then((ok) => ok && client.helper.refreshProcesses())}>
              <RefreshCw className="h-3.5 w-3.5" /> Detectar novamente
            </Button>
          </div>
        )}

        {available && (
          <div className="space-y-3">
            <p className="text-sm">
              Escolha o programa cujo som será transmitido. As vozes do Discord <strong>não</strong> entram na
              transmissão.
            </p>
            <Select
              value={pid != null ? String(pid) : ""}
              onValueChange={(v) => {
                const n = Number(v);
                setState({ helperPid: n });
                client.helper.selectProcess(n);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o programa…" />
              </SelectTrigger>
              <SelectContent>
                {processes.map((p) => (
                  <SelectItem key={p.pid} value={String(p.pid)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {status === "capturing" ? "Capturando o áudio do programa selecionado." : "A captura começa ao transmitir a tela."}
              </p>
              <Button variant="ghost" size="sm" onClick={() => client.helper.refreshProcesses()}>
                <RefreshCw className="h-3.5 w-3.5" /> Atualizar lista
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
