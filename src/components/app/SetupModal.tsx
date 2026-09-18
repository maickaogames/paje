import { useRef, useState } from "react";
import { ImagePlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "./Avatar";
import { DeviceForm } from "./DeviceForm";
import { shrinkAvatar } from "@/lib/media";
import { newPeerId, setState, useApp } from "@/lib/store";

export function SetupModal() {
  const devices = useApp((s) => s.devices);
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [devs, setDevs] = useState(devices);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setAvatar(await shrinkAvatar(f));
  }

  function finish(e: React.FormEvent) {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) return;
    setState({ profile: { peerId: newPeerId(), nickname: name, avatar }, devices: devs });
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-10">
      <form onSubmit={finish} className="panel w-full max-w-md p-8 animate-fade-up">
        <h1 className="text-2xl font-semibold">Quem é você hoje?</h1>
        <p className="text-sm text-muted-foreground mt-1">Sem conta, sem cadastro. Só um apelido temporário.</p>

        <div className="flex items-center gap-4 mt-6">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Carregar foto"
          >
            <Avatar src={avatar} name={nickname || "?"} size={72} />
            <span className="absolute inset-0 rounded-full bg-background/70 opacity-0 group-hover:opacity-100 grid place-items-center transition-opacity">
              <ImagePlus className="h-5 w-5" />
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} />
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" /> Apelido
            </label>
            <Input
              autoFocus
              maxLength={32}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="ex.: Metzger"
              className="h-10 bg-surface"
            />
          </div>
        </div>
        {avatar && (
          <button type="button" onClick={() => setAvatar(null)} className="text-xs text-muted-foreground hover:text-foreground mt-2">
            Usar ícone padrão
          </button>
        )}

        <div className="mt-7 pt-6 border-t">
          <h2 className="text-sm font-semibold mb-3">Periféricos</h2>
          <DeviceForm value={devs} onChange={setDevs} />
        </div>

        <Button type="submit" disabled={!nickname.trim()} className="w-full h-11 mt-7 font-semibold">
          Entrar no servidor
        </Button>
      </form>
    </div>
  );
}
