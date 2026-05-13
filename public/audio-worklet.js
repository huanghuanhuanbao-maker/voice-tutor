// AudioWorklet 处理器：把麦克风的 Float32 PCM 累积成 ~20ms 一包，
// 用最简单的线性下采样把 sampleRate (一般 48k) → 16k，发回主线程。

class MicPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate  = 16000;
    this.inputRate   = sampleRate;   // 全局：AudioContext 的实际采样率
    this.ratio       = this.inputRate / this.targetRate;
    this.frameSize16k = 320;          // 20ms @ 16k = 320 samples = 640 bytes
    this.bufferF32   = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    if (!ch0) return true;

    // 累积新样本
    const merged = new Float32Array(this.bufferF32.length + ch0.length);
    merged.set(this.bufferF32, 0);
    merged.set(ch0, this.bufferF32.length);
    this.bufferF32 = merged;

    // 每凑够够下采样出 320 个 16k 样本 (= 320 * ratio 个原始样本) 就发一包
    const neededOriginal = Math.ceil(this.frameSize16k * this.ratio);
    while (this.bufferF32.length >= neededOriginal) {
      const slice = this.bufferF32.subarray(0, neededOriginal);
      this.bufferF32 = this.bufferF32.subarray(neededOriginal);

      // 线性下采样到 16k
      const out16k = new Int16Array(this.frameSize16k);
      for (let i = 0; i < this.frameSize16k; i++) {
        const srcIdx = Math.floor(i * this.ratio);
        const sample = slice[srcIdx] || 0;
        let s = Math.max(-1, Math.min(1, sample));
        out16k[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      // 直接 transfer ArrayBuffer，避免拷贝
      this.port.postMessage(out16k.buffer, [out16k.buffer]);
    }
    return true;
  }
}

registerProcessor('mic-pcm-processor', MicPcmProcessor);
