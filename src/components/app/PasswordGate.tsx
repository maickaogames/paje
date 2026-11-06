import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2 } from "lucide-react";
import logo from "@/assets/paje-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinGroup } from "@/lib/group.functions";
import { setState } from "@/lib/store";

export function PasswordGate() {
  const join = useServerFn(joinGroup);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await join({ data: { password } });
      setState({ token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-dvh overflow-y-auto grid place-items-center bg-background px-4">
      <form onSubmit={submit} className="panel w-full max-w-sm p-8 animate-fade-up">
        <div className="flex items-center gap-3 mb-6">
          <img src={logo} alt="Pajé" className="h-12 w-12 rounded-lg object-contain" />
          <div>
            <h1 className="font-display text-xl font-semibold leading-tight">Pajé</h1>
            <p className="text-xs text-muted-foreground">Bem-vindos à tribo Akidauânus!</p>
          </div>
        </div>
        <label className="text-sm text-muted-foreground mb-2 block">Senha do grupo</label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-9 h-11 bg-surface"
            placeholder="••••••••"
          />
        </div>
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        <Button type="submit" disabled={busy || !password} className="w-full h-11 mt-5 font-semibold">
          {busy ? <Loader2 className="animate-spin" /> : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
