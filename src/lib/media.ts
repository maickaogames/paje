export interface DeviceLists {
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
}

/** Ask for a one-off permission so labels are readable, then list devices. */
export async function listDevices(): Promise<DeviceLists> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      /* no permission — labels will be generic */
    }
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: all.filter((d) => d.kind === "audioinput"),
    speakers: all.filter((d) => d.kind === "audiooutput"),
    cams: all.filter((d) => d.kind === "videoinput"),
  };
}

export function shrinkAvatar(file: File, size = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d")!;
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
