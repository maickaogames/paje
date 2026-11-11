import type { CSSProperties } from "react";

/** Ajustes da câmera aplicados na exibição (todos os participantes veem igual, sem custo de CPU). */
export interface CamFx {
  zoom: number; // 1..3
  rotate: 0 | 90 | 180 | 270;
  mirror: boolean;
  brightness: number; // 0.5..1.5
  contrast: number; // 0.5..1.5
  saturation: number; // 0..2
}
export const DEFAULT_CAMFX: CamFx = { zoom: 1, rotate: 0, mirror: false, brightness: 1, contrast: 1, saturation: 1 };

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Sanitiza valores vindos de outros participantes. */
export function normalizeCamFx(raw: unknown): CamFx {
  const r = (raw ?? {}) as Partial<CamFx>;
  const rot = [0, 90, 180, 270].includes(r.rotate as number) ? (r.rotate as CamFx["rotate"]) : 0;
  return {
    zoom: clamp(r.zoom, 1, 3, 1),
    rotate: rot,
    mirror: r.mirror === true,
    brightness: clamp(r.brightness, 0.5, 1.5, 1),
    contrast: clamp(r.contrast, 0.5, 1.5, 1),
    saturation: clamp(r.saturation, 0, 2, 1),
  };
}

export function camFxStyle(fx: CamFx | undefined | null, selfMirror = false): CSSProperties {
  const f = normalizeCamFx(fx);
  if (selfMirror) f.mirror = !f.mirror;
  const transforms = [`rotate(${f.rotate}deg)`, `scale(${f.mirror ? -f.zoom : f.zoom}, ${f.zoom})`];
  const isDefaultColor = f.brightness === 1 && f.contrast === 1 && f.saturation === 1;
  return {
    transform: transforms.join(" "),
    filter: isDefaultColor ? undefined : `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation})`,
  };
}
