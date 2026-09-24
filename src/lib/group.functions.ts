import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertToken, checkPassword, makeToken, fetchLinkPreview, firstUrl } from "./group.server";

export const joinGroup = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ password: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    if (!checkPassword(data.password)) {
      throw new Error("Senha incorreta.");
    }
    return { token: makeToken() };
  });

export const verifySession = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string() }).parse(d))
  .handler(async ({ data }) => {
    try {
      assertToken(data.token);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

export const listMessages = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ token: z.string().max(500), since: z.string().max(40).nullable().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    assertToken(data.token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("messages").select("*");
    if (data.since) {
      q = q.gt("created_at", data.since).order("created_at", { ascending: true }).limit(200);
      const { data: rows, error } = await q;
      if (error) throw new Error("Falha ao carregar mensagens.");
      return rows ?? [];
    }
    const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("Falha ao carregar mensagens.");
    return (rows ?? []).reverse();
  });

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export const sendMessage = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        token: z.string(),
        peerId: z.string().min(1).max(40),
        nickname: z.string().min(1).max(32),
        avatar: z.string().max(40_000).nullable(),
        content: z.string().max(4000),
        image: z
          .object({
            data: z.string(), // base64 without prefix
            type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
          })
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    assertToken(data.token);
    const content = data.content.trim();
    if (!content && !data.image) throw new Error("Mensagem vazia.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let imageUrl: string | null = null;
    if (data.image) {
      const bytes = Buffer.from(data.image.data, "base64");
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Imagem muito grande (máx. 6 MB).");
      const ext = data.image.type.split("/")[1];
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await supabaseAdmin.storage
        .from("chat-images")
        .upload(path, bytes, { contentType: data.image.type, upsert: false });
      if (up.error) throw new Error("Falha ao enviar imagem.");
      const signed = await supabaseAdmin.storage
        .from("chat-images")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signed.error || !signed.data) throw new Error("Falha ao gerar link da imagem.");
      imageUrl = signed.data.signedUrl;
    }

    const url = content ? firstUrl(content) : null;
    const preview = url ? await fetchLinkPreview(url) : null;

    const { data: row, error } = await supabaseAdmin
      .from("messages")
      .insert({
        peer_id: data.peerId,
        nickname: data.nickname,
        avatar_url: data.avatar,
        content,
        image_url: imageUrl,
        link_preview: preview ? { ...preview } : null,
      })
      .select()
      .single();
    if (error) throw new Error("Falha ao salvar mensagem.");
    return row;
  });
