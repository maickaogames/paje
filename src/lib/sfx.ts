/**
 * Sons curtos da interface, sintetizados na hora (nenhum arquivo para baixar,
 * custo de CPU praticamente zero).
 */
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Duas notas em sequência: simples, curto e reconhecível. */
function tones(notes: number[], step = 0.09, vol = 0.07, type: OscillatorType = "sine") {
  const c = ac();
  if (!c) return;
  notes.forEach((f, i) => {
    const t0 = c.currentTime + i * step;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + step + 0.06);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + step + 0.08);
  });
}

export const sfx = {
  mute: () => tones([620, 400]),
  unmute: () => tones([400, 620]),
  deafen: () => tones([520, 330, 260]),
  undeafen: () => tones([260, 400, 620]),
  join: () => tones([440, 660, 880]),
  leave: () => tones([660, 440, 300]),
  shareStart: () => tones([520, 700], 0.08, 0.06, "triangle"),
  shareStop: () => tones([700, 420], 0.08, 0.06, "triangle"),
  camStart: () => tones([480, 720], 0.07, 0.05),
  camStop: () => tones([720, 480], 0.07, 0.05),
  reconnect: () => tones([500, 500], 0.07, 0.05, "triangle"),
};
