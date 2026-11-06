import { useEffect } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/store";
import { dismissUpdate } from "@/lib/updater";

/** Aviso de atualização: aparece ao abrir o app e ao clicar em "Atualizar Pajé". */
export function UpdateStatus() {
  const { phase, percent } = useApp((s) => s.update);

  useEffect(() => {
    if (phase !== "uptodate" && phase !== "error") return;
    const t = setTimeout(dismissUpdate, phase === "error" ? 5000 : 3000);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;

  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 w-72 -translate-x-1/2 rounded-xl border bg-card p-3 shadow-lg animate-fade-up">
      {phase === "checking" && (
        <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Verificando atualizações…</p>
      )}
      {phase === "uptodate" && (
        <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-online" /> O Pajé está atualizado</p>
      )}
      {(phase === "downloading" || phase === "restarting") && (
        <div className="space-y-2">
          <p className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4" /> {phase === "restarting" ? "O Pajé está atualizado" : "Atualizando o Pajé"}</span>
            <span className="font-mono tabular-nums">{percent}%</span>
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          {phase === "restarting" && <p className="text-xs text-muted-foreground">Reabrindo o Pajé…</p>}
        </div>
      )}
      {phase === "error" && <p className="text-sm text-muted-foreground">Não foi possível verificar atualizações agora.</p>}
    </div>
  );
}
