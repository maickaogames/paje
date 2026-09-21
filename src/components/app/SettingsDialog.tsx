import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { DeviceForm } from "./DeviceForm";
import { resetSession, setState, useApp, type Settings } from "@/lib/store";
import type { VoiceClient } from "@/lib/rtc";

function KeyPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      onChange(e.code);
      setListening(false);
    };
    window.addEventListener("keydown", h, { capture: true });
    return () => window.removeEventListener("keydown", h, { capture: true });
  }, [listening, onChange]);
  return (
    <button
      type="button"
      onClick={() => setListening(true)}
      className="h-8 min-w-20 px-3 rounded-md border border-input bg-surface font-mono text-xs hover:bg-accent"
    >
      {listening ? "Pressione…" : value.replace(/^Key|^Digit/, "")}
    </button>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: VoiceClient;
}) {
  const settings = useApp((s) => s.settings);
  const devices = useApp((s) => s.devices);
  const camOn = useApp((s) => s.camOn);

  function patch(p: Partial<Settings>) {
    setState({ settings: { ...settings, ...p } });
    if ("ptt" in p) client.applyMicEnabled();
    if ("micGain" in p || "micMonitor" in p) client.applyMicTuning();
    if ("noiseSuppression" in p) void client.reopenMic();
  }

  // Desliga o monitoramento ao fechar as configurações, para não gerar eco.
  useEffect(() => {
    if (open) return;
    if (settings.micMonitor) {
      setState({ settings: { ...settings, micMonitor: false } });
      client.applyMicTuning();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function changeDevices(d: typeof devices) {
    const prev = devices;
    setState({ devices: d });
    if (d.mic !== prev.mic) {
      try {
        await client.setMic(d.mic);
      } catch {
        /* ignore */
      }
    }
    if (d.speaker !== prev.speaker) await client.applySink();
    if (d.cam !== prev.cam && camOn) {
      await client.stopCam();
      if (d.cam !== "none") await client.startCam(d.cam).catch(() => {});
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurações</DialogTitle>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Periféricos</h3>
          <DeviceForm value={devices} onChange={(d) => void changeDevices(d)} />
        </section>

        <section className="space-y-3 pt-4 border-t">
          <h3 className="text-sm font-semibold">Voz</h3>
          <Row label="Push-to-talk" hint="Só transmite enquanto a tecla estiver pressionada">
            <div className="flex items-center gap-2">
              <KeyPicker value={settings.pttKey} onChange={(pttKey) => patch({ pttKey })} />
              <Switch checked={settings.ptt} onCheckedChange={(ptt) => patch({ ptt })} />
            </div>
          </Row>
          <Row label="Sensibilidade do indicador de fala" hint="Menor = borda verde acende mais fácil">
            <div className="w-40">
              <Slider
                min={0.005}
                max={0.1}
                step={0.005}
                value={[settings.vadThreshold]}
                onValueChange={([v]) => patch({ vadThreshold: v ?? 0.02 })}
              />
            </div>
          </Row>
        </section>

        <section className="space-y-3 pt-4 border-t">
          <h3 className="text-sm font-semibold">Microfone</h3>
          <Row
            label={`Sensibilidade do microfone (${Math.round(settings.micGain * 100)}%)`}
            hint="Aumente se os amigos dizem que sua voz está baixa"
          >
            <div className="w-40">
              <Slider
                min={0.2}
                max={3}
                step={0.05}
                value={[settings.micGain]}
                onValueChange={([v]) => patch({ micGain: v ?? 1 })}
              />
            </div>
          </Row>
          <Row label="Supressor de ruído" hint="Remove ventilador, teclado e chiado do ambiente">
            <Switch
              checked={settings.noiseSuppression}
              onCheckedChange={(noiseSuppression) => patch({ noiseSuppression })}
            />
          </Row>
          <Row label="Ouvir meu microfone" hint="Use fones para testar o ajuste sem eco">
            <Switch checked={settings.micMonitor} onCheckedChange={(micMonitor) => patch({ micMonitor })} />
          </Row>
        </section>

        <section className="space-y-3 pt-4 border-t">
          <h3 className="text-sm font-semibold">Atalhos (com a janela em foco)</h3>
          <Row label="Mutar microfone">
            <KeyPicker value={settings.muteKey} onChange={(muteKey) => patch({ muteKey })} />
          </Row>
          <Row label="Surdina">
            <KeyPicker value={settings.deafenKey} onChange={(deafenKey) => patch({ deafenKey })} />
          </Row>
        </section>

        <section className="space-y-3 pt-4 border-t">
          <h3 className="text-sm font-semibold">Desempenho</h3>
          <Row label="Modo economia" hint="Pausa vídeos e a webcam quando a aba está em segundo plano">
            <Switch checked={settings.powerSave} onCheckedChange={(powerSave) => patch({ powerSave })} />
          </Row>
        </section>

        <div className="pt-4 border-t flex justify-between items-center">
          <p className="text-xs text-muted-foreground">Trocar apelido ou foto</p>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await client.stop();
              setState({ profile: null });
              onOpenChange(false);
            }}
          >
            Sair e reconfigurar
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void client.stop().then(resetSession)}>
            Sair do grupo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
