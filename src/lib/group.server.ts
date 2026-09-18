import { createHmac, timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function makeToken() {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET ausente");
  return createHmac("sha256", secret).update("litevoice-group-v1").digest("hex");
}

export function checkPassword(password: string) {
  const expected = process.env["GROUP_PASSWORD"];
  if (!expected) throw new Error("A senha do grupo ainda não foi configurada.");
  return safeEqual(password, expected);
}

export function assertToken(token: string | null | undefined) {
  if (!token || !safeEqual(token, makeToken())) {
    throw new Error("Sessão inválida. Entre novamente com a senha do grupo.");
  }
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

export function firstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? m[0] : null;
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
    "i",
  );
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2] ?? null;
  return v ? decodeEntities(v) : null;
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; LiteVoiceBot/1.0)", accept: "text/html" },
    });
    clearTimeout(timer);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) {
      if (type.startsWith("image/")) return { url, title: null, description: null, image: url, site: u.hostname };
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) return null;
    let html = "";
    const dec = new TextDecoder();
    while (html.length < 200_000) {
      const { value, done } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null;
    let image = meta(html, "og:image") ?? meta(html, "twitter:image");
    if (image && image.startsWith("/")) image = `${u.origin}${image}`;
    return {
      url,
      title: meta(html, "og:title") ?? (titleTag ? decodeEntities(titleTag.trim()) : null),
      description: meta(html, "og:description") ?? meta(html, "description"),
      image,
      site: meta(html, "og:site_name") ?? u.hostname,
    };
  } catch {
    return null;
  }
}
