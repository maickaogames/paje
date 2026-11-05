/** Atalhos configuráveis: formato "Ctrl+Shift+F8" (modificadores + KeyboardEvent.code). */
export type HotkeyAction = "cam" | "share" | "pip";
export type Hotkeys = Record<HotkeyAction, string>;
export const DEFAULT_HOTKEYS: Hotkeys = { cam: "F8", share: "F9", pip: "F10" };
export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  cam: "Ligar/desligar webcam",
  share: "Iniciar/encerrar transmissão",
  pip: "Abrir/fechar Picture-in-Picture",
};

const MODIFIER_CODES = ["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"];

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey">;

/** Converte uma tecla pressionada em combinação; null se for só um modificador. */
export function comboFromEvent(e: KeyLike): string | null {
  if (MODIFIER_CODES.includes(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.code);
  return parts.join("+");
}

export function matchesCombo(e: KeyLike, combo: string) {
  return !!combo && comboFromEvent(e) === combo;
}

/** Texto amigável: "Ctrl+KeyP" → "Ctrl+P". */
export function comboLabel(combo: string) {
  return combo
    .split("+")
    .map((p) => p.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num "))
    .join("+");
}

/** Formato aceito pelos atalhos globais do Windows (Tauri): "Ctrl+KeyP" → "Control+KeyP". */
export function comboToAccelerator(combo: string) {
  return combo
    .split("+")
    .map((p) => (p === "Ctrl" ? "Control" : p))
    .join("+");
}
