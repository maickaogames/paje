/** Temporary product switches; preserved chat/voice code can be enabled later. */
export const MEDIA_FEATURES = { voice: false, text: false } as const;
export const MEDIA_PUBLISH_SOURCES = ["camera", "screen_share", "screen_share_audio"] as const;

export function shouldSubscribeMedia(source: string, owner: string, watching: string | null) {
  if (source === "camera") return true;
  return (source === "screen_share" || source === "screen_share_audio") && owner === watching;
}

export function shouldPlayScreenAudio(owner: string, watching: string | null, speaker: string) {
  return owner === watching && speaker !== "none";
}

/** System/window mixes cannot reliably exclude external Discord audio. Fail closed. */
export function safeScreenAudio(surface: string | undefined) {
  return surface === "browser";
}

/**
 * Áudio vindo do componente auxiliar local é capturado por processo:
 * só o programa escolhido entra, o Discord fica de fora por construção.
 * Por isso ele é permitido em qualquer superfície (tela, janela ou aba).
 */
export function allowScreenAudio(surface: string | undefined, fromHelper: boolean) {
  return fromHelper || safeScreenAudio(surface);
}

export function assertTextEnabled() {
  if (!MEDIA_FEATURES.text) throw new Error("O chat de texto está temporariamente desativado. Use o Discord.");
}