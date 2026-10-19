/**
 * Pajé — AudioWorklet que reproduz blocos PCM (f32le estéreo 48 kHz)
 * recebidos do componente auxiliar local de captura seletiva.
 * Mantém um buffer circular simples; descarta o mais antigo em overflow.
 */
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000 * 2 * 2; // ~2s de estéreo
    this.buf = new Float32Array(this.capacity);
    this.readPos = 0;
    this.writePos = 0;
    this.size = 0;
    this.port.onmessage = (e) => {
      const chunk = e.data;
      if (!(chunk instanceof Float32Array)) return;
      for (let i = 0; i < chunk.length; i++) {
        if (this.size === this.capacity) {
          // overflow: descarta a amostra mais antiga
          this.readPos = (this.readPos + 1) % this.capacity;
          this.size--;
        }
        this.buf[this.writePos] = chunk[i];
        this.writePos = (this.writePos + 1) % this.capacity;
        this.size++;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < out.length; ch++) {
        if (this.size > 0) {
          out[ch][i] = this.buf[this.readPos];
          this.readPos = (this.readPos + 1) % this.capacity;
          this.size--;
        } else {
          out[ch][i] = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-player", PcmPlayerProcessor);
