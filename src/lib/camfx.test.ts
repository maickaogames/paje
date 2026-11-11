import { describe, expect, it } from "vitest";
import { camFxStyle, normalizeCamFx } from "./camfx";

describe("camfx", () => {
  it("limita zoom entre 1x e 3x", () => {
    expect(normalizeCamFx({ zoom: 9 }).zoom).toBe(3);
    expect(normalizeCamFx({ zoom: 0.2 }).zoom).toBe(1);
  });
  it("aceita só rotações de 90 em 90 graus", () => {
    expect(normalizeCamFx({ rotate: 45 }).rotate).toBe(0);
    expect(normalizeCamFx({ rotate: 270 }).rotate).toBe(270);
  });
  it("espelha invertendo o eixo horizontal", () => {
    expect(camFxStyle({ zoom: 2, rotate: 90, mirror: true, brightness: 1, contrast: 1, saturation: 1 }).transform).toBe("rotate(90deg) scale(-2, 2)");
  });
});
