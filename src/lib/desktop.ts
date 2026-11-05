/** Ponte para recursos nativos do Pajé para Windows (Tauri). No navegador, tudo é no-op. */
interface TauriGlobal {
  core: {
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    Channel: new <T>() => { onmessage: (data: T) => void };
  };
  event?: { listen: <T>(ev: string, cb: (e: { payload: T }) => void) => Promise<() => void> };
}

export function tauri(): TauriGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

export function isDesktop() {
  return tauri() != null;
}

export async function setPipMode(enabled: boolean, width: number, height: number, corner: string) {
  await tauri()?.core.invoke("set_pip_mode", { enabled, width, height, corner });
}

export async function setGlobalHotkeys(keys: { action: string; accelerator: string }[]) {
  const t = tauri();
  if (!t) return [] as string[];
  return t.core.invoke<string[]>("set_hotkeys", { keys });
}

export async function onGlobalHotkey(cb: (action: string) => void) {
  const t = tauri();
  if (!t?.event) return () => {};
  return t.event.listen<string>("paje-hotkey", (e) => cb(e.payload));
}

export interface UpdateInfo {
  current: number;
  latest: number;
  available: boolean;
  url: string;
}

export async function checkUpdate() {
  return tauri()!.core.invoke<UpdateInfo>("check_update");
}

export async function installUpdate(url: string, onProgress: (pct: number) => void) {
  const t = tauri()!;
  const ch = new t.core.Channel<number>();
  ch.onmessage = onProgress;
  await t.core.invoke("install_update", { url, onProgress: ch });
}
