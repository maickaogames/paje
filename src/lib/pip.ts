import { toast } from "sonner";
import { isDesktop, setPipMode } from "./desktop";
import { DEFAULT_PIP, PIP_SIZES, getState, setState } from "./store";

interface DocumentPip {
  requestWindow: (o: { width: number; height: number }) => Promise<Window>;
}

function copyStyles(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.document.createElement("style");
      style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      target.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  }
  target.document.documentElement.className = document.documentElement.className;
  target.document.title = "Pajé — PiP";
}

export function pipSize() {
  const pip = getState().settings.pip ?? DEFAULT_PIP;
  const [w, h] = PIP_SIZES[pip.size];
  return { w, h, corner: pip.corner };
}

/** Abre o PiP: no app Windows a janela vira um mini player sempre no topo; na web usa Document PiP. */
export async function openPip() {
  if (getState().pipOpen) return;
  const { w, h, corner } = pipSize();
  if (isDesktop()) {
    setState({ pipOpen: true });
    await setPipMode(true, w, h, corner).catch((e) => console.warn("[pip]", e));
    return;
  }
  const dpip = (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;
  if (!dpip) {
    toast.error("Este navegador não tem Picture-in-Picture. Use o Chrome, o Edge ou o app para Windows.");
    return;
  }
  try {
    const win = await dpip.requestWindow({ width: w, height: h });
    copyStyles(win);
    win.addEventListener("pagehide", () => {
      if (getState().pipWindow === win) setState({ pipOpen: false, pipWindow: null });
    });
    setState({ pipOpen: true, pipWindow: win });
  } catch {
    toast("Clique no botão de Picture-in-Picture (ou use o atalho com o Pajé em foco) para abrir.");
  }
}

export async function closePip() {
  const s = getState();
  if (!s.pipOpen) return;
  if (isDesktop()) {
    setState({ pipOpen: false });
    await setPipMode(false, 0, 0, "").catch((e) => console.warn("[pip]", e));
  } else {
    s.pipWindow?.close();
    setState({ pipOpen: false, pipWindow: null });
  }
}

export function togglePip() {
  return getState().pipOpen ? closePip() : openPip();
}
