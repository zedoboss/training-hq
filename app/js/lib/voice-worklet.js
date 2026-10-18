// Microphone tap (step 9), running in the audio thread: averages the phone's microphone (48 kHz on iPhone) down to
// 16 kHz and posts frames of 512 samples (32 ms) to the page, where speech detection runs.
class ThqMic extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is the audio thread's own rate.
    this.ratio = sampleRate / 16000;
    this.pos = 0; this.acc = 0; this.cnt = 0;
    this.frame = new Float32Array(512); this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        this.frame[this.n++] = this.acc / this.cnt;
        this.acc = 0; this.cnt = 0;
        if (this.n === this.frame.length) {
          this.port.postMessage(this.frame, [this.frame.buffer]);
          this.frame = new Float32Array(512); this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('thq-mic', ThqMic);
