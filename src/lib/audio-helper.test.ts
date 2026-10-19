import { describe, expect, test } from "vitest";
import { PcmRingBuffer } from "./audio-helper";

describe("PcmRingBuffer", () => {
  test("preserva a ordem das amostras escritas", () => {
    const rb = new PcmRingBuffer(8);
    rb.write(new Float32Array([1, 2, 3, 4]));
    const out = rb.read(2, 2);
    expect([...out]).toEqual([1, 2, 3, 4]);
    expect(rb.size).toBe(0);
  });

  test("preenche com silêncio quando não há dados suficientes", () => {
    const rb = new PcmRingBuffer(8);
    rb.write(new Float32Array([0.5]));
    const out = rb.read(2, 2);
    expect([...out]).toEqual([0.5, 0, 0, 0]);
  });

  test("descarta as amostras mais antigas em overflow", () => {
    const rb = new PcmRingBuffer(4);
    rb.write(new Float32Array([1, 2, 3, 4]));
    rb.write(new Float32Array([5, 6]));
    const out = rb.read(2, 2);
    expect([...out]).toEqual([3, 4, 5, 6]);
    expect(rb.size).toBe(0);
  });

  test("clear zera o buffer", () => {
    const rb = new PcmRingBuffer(4);
    rb.write(new Float32Array([1, 2]));
    rb.clear();
    expect(rb.size).toBe(0);
    expect([...rb.read(1, 2)]).toEqual([0, 0]);
  });
});
