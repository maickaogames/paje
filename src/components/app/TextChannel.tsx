import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Hash, ImagePlus, Loader2, SendHorizonal, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { listMessages, sendMessage } from "@/lib/group.functions";
import { useApp } from "@/lib/store";
import { Avatar } from "./Avatar";

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
}

interface Row {
  id: string;
  created_at: string;
  peer_id: string;
  nickname: string;
  avatar_url: string | null;
  content: string;
  image_url: string | null;
  link_preview: Preview | null;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read error"));
    r.readAsDataURL(file);
  });
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function LinkCard({ p }: { p: Preview }) {
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-1.5 flex gap-3 max-w-lg rounded-lg border bg-surface p-3 hover:bg-muted/40 transition-colors"
    >
      {p.image && <img src={p.image} alt="" loading="lazy" className="h-16 w-16 rounded object-cover shrink-0" />}
      <div className="min-w-0">
        {p.site && <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{p.site}</p>}
        <p className="text-sm font-medium truncate">{p.title ?? p.url}</p>
        {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
      </div>
    </a>
  );
}

export function TextChannel() {
  const profile = useApp((s) => s.profile)!;
  const token = useApp((s) => s.token);
  const send = useServerFn(sendMessage);
  const list = useServerFn(listMessages);
  const [rows, setRows] = useState<Row[]>([]);
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pingRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let last: string | null = null;
    const merge = (incoming: Row[]) => {
      if (!incoming.length) return;
      for (const r of incoming) if (!last || r.created_at > last) last = r.created_at;
      setRows((prev) => {
        const ids = new Set(prev.map((r) => r.id));
        const add = incoming.filter((r) => !ids.has(r.id));
        return add.length ? [...prev, ...add].slice(-300) : prev;
      });
    };
    const load = async () => {
      try {
        const data = (await list({ data: { token, since: last } })) as unknown as Row[];
        if (alive) merge(data);
      } catch {
        /* ignore transient errors */
      }
    };
    void load();
    // New messages are signalled over broadcast; polling is a light fallback.
    const ch = supabase
      .channel("messages-ping", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "new" }, () => void load())
      // Ao (re)conectar, busca o que chegou durante a queda.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
      });
    pingRef.current = ch;
    const iv = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      alive = false;
      window.clearInterval(iv);
      pingRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [token, list]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || (!text.trim() && !image)) return;
    setBusy(true);
    try {
      const img = image
        ? {
            data: await fileToBase64(image),
            type: (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.type)
              ? image.type
              : "image/jpeg") as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          }
        : null;
      const row = (await send({
        data: {
          token: token ?? "",
          peerId: profile.peerId,
          nickname: profile.nickname,
          avatar: profile.avatar,
          content: text,
          image: img,
        },
      })) as unknown as Row;
      setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [...prev, row]));
      void pingRef.current?.send({ type: "broadcast", event: "new", payload: {} });
      setText("");
      setImage(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-12 px-5 flex items-center gap-2 border-b">
        <Hash className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">geral</h2>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda. Diga um oi.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex gap-3">
            <Avatar src={r.avatar_url} name={r.nickname} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className={r.peer_id === profile.peerId ? "font-semibold text-primary" : "font-semibold"}>
                  {r.nickname}
                </span>{" "}
                <span className="text-[11px] text-muted-foreground font-mono">{time(r.created_at)}</span>
              </p>
              {r.content && <p className="text-sm whitespace-pre-wrap break-words">{r.content}</p>}
              {r.image_url && (
                <img
                  src={r.image_url}
                  alt=""
                  loading="lazy"
                  className="mt-1.5 max-h-72 rounded-lg border object-contain"
                />
              )}
              {r.link_preview && <LinkCard p={r.link_preview} />}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="border-t p-3">
        {image && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate max-w-[16rem]">{image.name}</span>
            <button type="button" onClick={() => setImage(null)} className="icon-btn h-6 w-6">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" className="icon-btn h-10 w-10" title="Enviar imagem" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Mensagem em #geral"
            className="h-10 bg-surface"
            maxLength={4000}
          />
          <Button type="submit" disabled={busy || (!text.trim() && !image)} className="h-10">
            {busy ? <Loader2 className="animate-spin" /> : <SendHorizonal />}
          </Button>
        </div>
      </form>
    </div>
  );
}
