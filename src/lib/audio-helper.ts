/**
 * Cliente do componente auxiliar local de captura seletiva de áudio (Windows).
 *
 * O componente nativo (helper/) escuta em ws://127.0.0.1:47820, valida a
 * origem da página e envia o áudio PCM apenas do processo escolhido pelo
 * usuário — o Discord nunca é incluído, por construção.
 *
 * Falha fechada: se o componente não estiver instalado/rodando, nada é
 * capturado e o app segue o comportamento atual (sem áudio de tela/janela).
 */

export interface HelperProcess {
  pid: number;
  name: string;
}

export type HelperStatus = "off" | "connecting" | "ready" | "capturing" | "unavailable";

const HELPER_PORT = 47820;
const HELPER_PROTOCOL = "paje-audio-v1";
const SAMPLE_RATE = 48000;

/** Buffer circular de amostras PCM; extraído para ser testável fora do worklet. */
export class PcmRingBuffer {
  private buf: Float32Array;
  private readPos = 0;
  private writePos = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buf = new Float32Array(capacity);
  }

  get size() {
    return this.count;
  }

  write(chunk: Float32Array) {
    for (let i = 0; i < chunk.length; i++) {
      if (this.count === this.capacity) {
        this.readPos = (this.readPos + 1) % this.capacity;
        this.count--;
      }
      this.buf[this.writePos] = chunk[i] ?? 0;
      this.writePos = (this.writePos + 1) % this.capacity;
      this.count++;
    }
  }

  read(frames: number, channels: number): Float32Array {
    const out = new Float32Array(frames * channels);
    for (let i = 0; i < out.length; i++) {
      if (this.count > 0) {
        out[i] = this.buf[this.readPos] ?? 0;
        this.readPos = (this.readPos + 1) % this.capacity;
        this.count--;
      }
    }
    return out;
  }

  clear() {
    this.readPos = 0;
    this.writePos = 0;
    this.count = 0;
  }
}

export class HelperAudioClient {
  status: HelperStatus = "off";
  processes: HelperProcess[] = [];
  selectedPid: number | null = null;
  onChange: () => void = () => {};

  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private track: MediaStreamTrack | null = null;

  private setStatus(s: HelperStatus) {
    this.status = s;
    this.onChange();
  }

  /** Tenta conectar ao componente auxiliar local. Retorna true se disponível. */
  async connect(): Promise<boolean> {
    if (this.ws && (this.status === "ready" || this.status === "capturing")) return true;
    if (typeof WebSocket === "undefined") {
      this.setStatus("unavailable");
      return false;
    }
    this.setStatus("connecting");
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${HELPER_PORT}/`, HELPER_PROTOCOL);
      ws.binaryType = "arraybuffer";
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("tempo esgotado")), 3000);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("componente auxiliar não encontrado"));
        };
      });
      this.ws = ws;
      ws.onmessage = (ev) => this.handleMessage(ev);
      ws.onclose = () => this.handleClose();
      ws.onerror = () => this.handleClose();
      this.setStatus("ready");
      return true;
    } catch {
      this.ws = null;
      this.setStatus("unavailable");
      return false;
    }
  }

  private handleMessage(ev: MessageEvent) {
    if (typeof ev.data === "string") {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: "processes"; processes: HelperProcess[] }
          | { type: "selected"; pid: number }
          | { type: "stopped" }
          | { type: "error"; message: string };
        if (msg.type === "processes") {
          this.processes = msg.processes;
          this.onChange();
        } else if (msg.type === "selected") {
          this.selectedPid = msg.pid;
          this.setStatus("capturing");
        } else if (msg.type === "stopped") {
          this.setStatus("ready");
        } else if (msg.type === "error") {
          this.stopCapture();
          this.setStatus("ready");
        }
      } catch {
        /* frame inválido: ignora */
      }
      return;
    }
    // Frame binário: PCM f32le estéreo interleavado → worklet
    if (ev.data instanceof ArrayBuffer && this.node) {
      this.node.port.postMessage(new Float32Array(ev.data));
    }
  }

  private handleClose() {
    this.ws = null;
    this.processes = [];
    this.selectedPid = null;
    void this.releaseAudio();
    this.setStatus("off");
  }

  /** Pede ao componente a lista de processos com saída de áudio. */
  refreshProcesses() {
    this.ws?.send(JSON.stringify({ type: "list" }));
  }

  /** Seleciona o processo cuja saída de áudio será capturada. */
  selectProcess(pid: number) {
    this.ws?.send(JSON.stringify({ type: "select", pid }));
  }

  /**
   * Inicia a captura do processo selecionado e devolve uma faixa de áudio
   * pronta para publicação. Retorna null quando indisponível (falha fechada).
   */
  async startCapture(): Promise<MediaStreamTrack | null> {
    if (!this.ws || this.selectedPid == null) return null;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        await this.ctx.audioWorklet.addModule("/pcm-player-worklet.js");
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.node = new AudioWorkletNode(this.ctx, "pcm-player", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.dest = this.ctx.createMediaStreamDestination();
      this.node.connect(this.dest);
      this.ws.send(JSON.stringify({ type: "start" }));
      this.track = this.dest.stream.getAudioTracks()[0] ?? null;
      return this.track;
    } catch {
      await this.releaseAudio();
      return null;
    }
  }

  /** Encerra a captura e libera a faixa, mantendo a conexão com o componente. */
  async stopCapture() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop" }));
    }
    await this.releaseAudio();
    if (this.status === "capturing") this.setStatus("ready");
  }

  private async releaseAudio() {
    this.track?.stop();
    this.track = null;
    this.node?.disconnect();
    this.node = null;
    this.dest = null;
  }

  /** Desconecta do componente e libera todos os recursos. */
  async dispose() {
    await this.stopCapture();
    this.ws?.close();
    this.ws = null;
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.setStatus("off");
  }
}
