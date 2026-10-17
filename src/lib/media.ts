export interface DeviceLists {
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
}

/** Enumerate without opening devices or interrupting a camera already used by Discord. */
export async function listDevices(): Promise<DeviceLists> {
  const all = await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? [];
  return {
    mics: all.filter((d) => d.kind === "audioinput"),
    speakers: all.filter((d) => d.kind === "audiooutput"),
    cams: all.filter((d) => d.kind === "videoinput"),
  };
}

export function cameraErrorMessage(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Permita a câmera no cadeado do navegador. Confira também a permissão de câmera nas configurações do sistema.";
  if (name === "NotReadableError" || name === "AbortError") return "A câmera está ocupada ou indisponível. Desligue a câmera no Discord e em outros programas e tente novamente.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Nenhuma câmera disponível. Conecte uma webcam ou use o celular como webcam.";
  return e instanceof Error ? e.message : "Não foi possível acessar a câmera. Tente novamente.";
}

export async function acquireCamera(deviceId: string) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("A câmera exige um navegador atualizado e uma conexão HTTPS.");
  const video: MediaTrackConstraints = { frameRate: { ideal: 24, max: 30 } };
  if (deviceId !== "default") video.deviceId = { exact: deviceId };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: false }), usedDefault: false };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (deviceId !== "default" && (name === "NotFoundError" || name === "OverconstrainedError")) {
      return { stream: await navigator.mediaDevices.getUserMedia({ video: { frameRate: { ideal: 24, max: 30 } }, audio: false }), usedDefault: true };
    }
    throw e;
  }
}

export function shrinkAvatar(file: File, size = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("Não foi possível preparar a foto.")); return; }
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
