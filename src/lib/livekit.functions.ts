import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertCamKey, assertToken, makeCamKey } from "./group.server";

const CHANNELS = ["gameplay-1", "gameplay-2", "afk"] as const;

function env() {
  const url = process.env["LIVEKIT_URL"];
  const key = process.env["LIVEKIT_API_KEY"];
  const secret = process.env["LIVEKIT_API_SECRET"];
  if (!url || !key || !secret) throw new Error("Servidor de vídeo não configurado.");
  return { url, key, secret };
}

/** Token de mídia para um canal de voz. Só emitido para quem passou pela senha do grupo. */
export const getVoiceToken = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        token: z.string().max(500),
        peerId: z.string().min(1).max(40).regex(/^[a-z0-9]+$/),
        nickname: z.string().min(1).max(32),
        channel: z.enum(CHANNELS),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    assertToken(data.token);
    const { url, key, secret } = env();
    const { AccessToken, TrackSource } = await import("livekit-server-sdk");
    const at = new AccessToken(key, secret, { identity: data.peerId, name: data.nickname, ttl: "6h" });
    at.addGrant({ room: `paje-${data.channel}`, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: [TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] });
    return { url, jwt: await at.toJwt() };
  });

/** Token do computador para receber a câmera do próprio celular (sala privada por pessoa). */
export const getPhoneHostToken = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ token: z.string().max(500), peerId: z.string().min(1).max(40).regex(/^[a-z0-9]+$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    assertToken(data.token);
    const { url, key, secret } = env();
    const { AccessToken, TrackSource } = await import("livekit-server-sdk");
    const at = new AccessToken(key, secret, { identity: data.peerId, ttl: "6h" });
    at.addGrant({ room: `cam-${data.peerId}`, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false });
    // Chave curta só para a câmera; o celular nunca recebe a sessão do grupo.
    return { url, jwt: await at.toJwt(), phoneKey: makeCamKey(data.peerId) };
  });

/** Token do celular: só publica câmera na sala privada do dono. */
export const getPhoneCamToken = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ key: z.string().max(500), host: z.string().min(1).max(40).regex(/^[a-z0-9]+$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    assertCamKey(data.host, data.key);
    const { url, key, secret } = env();
    const { AccessToken, TrackSource } = await import("livekit-server-sdk");
    const at = new AccessToken(key, secret, { identity: `${data.host}-cam`, ttl: "6h" });
    at.addGrant({
      room: `cam-${data.host}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: false,
      canPublishData: false,
      canPublishSources: [TrackSource.CAMERA],
    });
    return { url, jwt: await at.toJwt() };
  });
