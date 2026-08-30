/* ==========================================================
   Звуковые эффекты.
   Ничего не скачиваем — звуки синтезируются прямо в браузере.
   Так срез весит килобайты и работает офлайн сразу.
   ========================================================== */

class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._lastDig = 0;
  }

  /** Звук на iPad включается только после касания экрана. */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.26;   // потише — резкость больше от волны, чем от громкости
    this.master.connect(this.ctx.destination);
  }

  setMuted(v) {
    this.muted = v;
    if (this.master) this.master.gain.value = v ? 0 : 0.26;
  }

  _tone(freq, dur, type = 'sine', delay = 0, vol = 1) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    // Мягкая атака (40мс, не 20) и волна помягче убирают «дребезг» —
    // резкость шла от square/sawtooth и слишком быстрого нарастания.
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.3 * vol, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** Шорох ковша по земле. Зовём часто, поэтому ограничиваем частоту. */
  dig() {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this._lastDig < 150) return;
    this._lastDig = now;

    const dur = 0.16;
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * dur, rate);
    const data = buf.getChannelData(0);
    const fadeIn = Math.floor(data.length * 0.12);
    for (let i = 0; i < data.length; i++) {
      // Шум с плавным затуханием и плавным началом — без них щум
      // начинается «щелчком», который и слышится как резкость
      const env = (i < fadeIn ? i / fadeIn : 1) * (1 - i / data.length);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 550;  // глуше, без «шипения» на iPad-динамиках
    const gain = this.ctx.createGain();
    gain.gain.value = 0.3;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  /** Короткий сигнал «поехали!» — звучит, когда открывается управление. */
  ready() {
    this._tone(660, 0.12, 'sine', 0, 0.5);
    this._tone(880, 0.18, 'triangle', 0.1, 0.5);
  }

  coin() {
    // Было square — дребезжащий писк. Sine + triangle звучит как мягкий «дзинь».
    this._tone(880, 0.14, 'sine', 0, 0.5);
    this._tone(1320, 0.22, 'triangle', 0.09, 0.45);
  }

  /** Победная попевка — до-ми-соль-до. */
  win() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this._tone(f, 0.32, 'triangle', i * 0.13));
  }

  /** Дом вырастает — восходящий гул. */
  build() {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';   // sawtooth звучал жёстко-«пиловочно»; triangle — тот же взлёт, но мягче
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.8);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.22, t0 + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.95);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 1);
  }
}

export const sfx = new Sfx();
