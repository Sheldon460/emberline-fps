// Emberline — audio: WebAudio-synthesised SFX only. No audio assets, no
// network. The context is created on the first user gesture; every call is
// safe before that (it simply does nothing).
export function createAudio() {
  let ctx = null;
  let muted = false;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch { ctx = null; }
    return ctx;
  }

  function noiseBurst(dur, freq, gainVal, type = 'lowpass') {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }

  function tone(freq, dur, gainVal, type = 'sine', slideTo = 0) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
  }

  const SHOT_FREQ = { pistol: 1400, rifle: 900, smg: 1600, shotgun: 500, sniper: 700 };
  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
    shot(kind) {
      noiseBurst(0.09, SHOT_FREQ[kind] || 900, 0.5);
      tone(180, 0.07, 0.25, 'square', 60);
    },
    enemyShot(dist) {
      const v = Math.max(0.06, 0.4 - dist * 0.008);
      noiseBurst(0.08, 800, v);
    },
    dryFire() { tone(1200, 0.04, 0.12, 'square'); },
    reload() { tone(900, 0.05, 0.15, 'square'); setTimeout(() => tone(600, 0.05, 0.15, 'square'), 160); },
    hit(crit) { tone(crit ? 2400 : 1600, 0.06, 0.25, 'sine'); },
    hurt() { noiseBurst(0.12, 300, 0.35); tone(110, 0.15, 0.3, 'sawtooth', 70); },
    kill() { tone(660, 0.08, 0.25, 'sine'); setTimeout(() => tone(990, 0.12, 0.25, 'sine'), 80); },
    plantBeep() { tone(1200, 0.08, 0.25, 'square'); },
    plantDone() { tone(880, 0.12, 0.3, 'sine'); setTimeout(() => tone(1320, 0.18, 0.3, 'sine'), 120); },
    defuseBeep() { tone(1000, 0.08, 0.25, 'square'); },
    explosion() { noiseBurst(0.8, 220, 0.9); tone(55, 0.7, 0.6, 'sine', 30); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.3, 'sine'), i * 130)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.3, 'sine'), i * 150)); },
    step() { noiseBurst(0.04, 500, 0.06); },
    buy() { tone(980, 0.07, 0.2, 'sine'); setTimeout(() => tone(1240, 0.09, 0.2, 'sine'), 70); },
  };
}
