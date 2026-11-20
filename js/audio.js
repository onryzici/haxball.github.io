// TOPARLAK — tamamen sentezlenmiş ses (dosya yok)
(function () {
  let ctx = null, master = null, crowdGain = null, noiseBuf = null, muted = false;
  try { muted = localStorage.getItem('tp_muted') === '1'; } catch (e) {}

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startCrowd();
  }

  function noise(dur, type, freq, q, gain, when, attack) {
    if (!ctx) return;
    const t = (when || ctx.currentTime);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.loop = dur > 1.9;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return f;
  }

  function tone(type, f0, f1, dur, gain, when) {
    if (!ctx) return;
    const t = when || ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  function startCrowd() {
    // Sürekli stadyum uğultusu
    crowdGain = ctx.createGain(); crowdGain.gain.value = 0.05;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1800;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.17;
    const lg = ctx.createGain(); lg.gain.value = 0.015;
    lfo.connect(lg); lg.connect(crowdGain.gain);
    src.connect(f); f.connect(f2); f2.connect(crowdGain); crowdGain.connect(master);
    src.start(); lfo.start();
  }

  function roar(intensity, dur) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [fr, q] of [[500, 0.8], [1100, 1.2], [2400, 1.5]]) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22 * intensity, t + 0.25);
      g.gain.setValueAtTime(0.22 * intensity, t + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // tezahürat dalgalanması
      const lfo = ctx.createOscillator(); lfo.frequency.value = 2.2 + Math.random();
      const lg = ctx.createGain(); lg.gain.value = 0.05 * intensity;
      lfo.connect(lg); lg.connect(g.gain);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t, Math.random()); src.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur);
    }
  }

  const S = {
    init,
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('tp_muted', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : 0.8;
      return muted;
    },
    kick(s) {
      const k = Math.min(1, s / 11);
      tone('sine', 190 + 60 * k, 45, 0.16, 0.55 + 0.3 * k);
      noise(0.05, 'highpass', 2200, 0.7, 0.12 + 0.2 * k);
    },
    power(s) {
      tone('sine', 230, 38, 0.3, 0.9);
      tone('triangle', 120, 40, 0.25, 0.4);
      noise(0.09, 'bandpass', 1500, 0.8, 0.5);
      noise(0.35, 'lowpass', 400, 0.7, 0.4, 0, 0.01);
    },
    rocket() {
      tone('sawtooth', 90, 30, 0.45, 0.35);
      noise(0.7, 'bandpass', 900, 0.5, 0.5, 0, 0.01);
      tone('sine', 260, 40, 0.3, 0.9);
    },
    curve() {
      tone('sine', 200, 50, 0.15, 0.6);
      tone('sine', 600, 1400, 0.35, 0.08);
    },
    post(s) {
      const g = Math.min(0.5, 0.12 + s * 0.04);
      for (const f of [1320, 1980, 2640]) tone('sine', f, f * 0.995, 0.6, g / (f / 1320));
      roar(0.5, 1.3);
    },
    wall(s) { tone('sine', 140, 60, 0.08, Math.min(0.3, s * 0.04)); },
    net(s) { noise(0.25, 'bandpass', 600, 1.2, Math.min(0.35, 0.08 + s * 0.03)); },
    bump(s) { tone('sine', 110, 50, 0.15, Math.min(0.6, 0.15 + s * 0.06)); noise(0.06, 'lowpass', 800, 1, 0.2); },
    burn() { noise(0.5, 'bandpass', 1200, 0.6, 0.6, 0, 0.005); tone('square', 300, 60, 0.3, 0.15); },
    whistle(long) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const n = long ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const st = t + i * 0.42, dur = i === n - 1 && long ? 0.9 : 0.32;
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2650;
        const vib = ctx.createOscillator(); vib.frequency.value = 38;
        const vg = ctx.createGain(); vg.gain.value = 90; vib.connect(vg); vg.connect(o.frequency);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2700; f.Q.value = 3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.14, st + 0.02);
        g.gain.setValueAtTime(0.14, st + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
        o.connect(f); f.connect(g); g.connect(master);
        o.start(st); vib.start(st); o.stop(st + dur + 0.05); vib.stop(st + dur + 0.05);
      }
    },
    goal() {
      roar(1.4, 4.5);
      tone('sine', 80, 35, 0.6, 0.8);
      noise(0.6, 'lowpass', 300, 1, 0.6);
    },
    ability(a) {
      switch (a) {
        case 'sok': tone('sine', 120, 25, 0.6, 1); noise(0.5, 'lowpass', 600, 0.7, 0.7); break;
        case 'roket': tone('square', 220, 660, 0.18, 0.08); tone('square', 330, 990, 0.18, 0.06, ctx && ctx.currentTime + 0.08); break;
        case 'falso': tone('sine', 400, 1200, 0.3, 0.15); tone('sine', 1200, 400, 0.3, 0.1, ctx && ctx.currentTime + 0.15); break;
        case 'buz': for (const f of [1800, 2400, 3100]) tone('sine', f, f * 1.02, 0.5, 0.06); noise(0.35, 'highpass', 4000, 0.8, 0.2); break;
        case 'eldiven': tone('triangle', 500, 750, 0.18, 0.12); noise(0.12, 'bandpass', 2500, 2, 0.15); break;
        case 'isinlan': tone('sine', 1500, 200, 0.25, 0.15); tone('triangle', 200, 1600, 0.25, 0.1, ctx && ctx.currentTime + 0.12); break;
        case 'hayalet': tone('sine', 600, 200, 0.6, 0.12); tone('sine', 900, 300, 0.6, 0.06); break;
        case 'turbo': tone('sawtooth', 100, 400, 0.4, 0.15); noise(0.4, 'bandpass', 2000, 1, 0.3); break;
        case 'ters': tone('square', 400, 200, 0.15, 0.08); tone('square', 200, 400, 0.15, 0.08, ctx && ctx.currentTime + 0.15); break;
        case 'bomba': tone('square', 880, 880, 0.08, 0.1); tone('square', 880, 880, 0.08, 0.1, ctx && ctx.currentTime + 0.25); break;
        case 'mayin': tone('triangle', 200, 120, 0.2, 0.2); break;
        case 'ruzgar': noise(1.2, 'bandpass', 600, 0.5, 0.5, 0, 0.2); break;
        case 'cagir': tone('sine', 300, 1500, 0.3, 0.15); tone('triangle', 1500, 1500, 0.2, 0.06, ctx && ctx.currentTime + 0.25); break;
        case 'sis': noise(0.9, 'lowpass', 500, 0.5, 0.4, 0, 0.1); break;
        case 'kalkan': tone('square', 150, 150, 0.2, 0.08); tone('sine', 300, 600, 0.3, 0.2); noise(0.2, 'lowpass', 800, 1, 0.3); break;
      }
    },
    boom(big) { tone('sine', 90, 25, big ? 1.1 : 0.7, 1); noise(big ? 1.2 : 0.7, 'lowpass', 700, 0.7, 0.9, 0, 0.005); noise(0.15, 'highpass', 2000, 0.7, 0.4); roar(0.7, 2); },
    hit(n) { tone('square', 300 + n * 120, 150, 0.08, 0.12); },
    dizzy() { for (let i = 0; i < 4; i++) tone('sine', 1200 - i * 150, 900 - i * 150, 0.12, 0.12, ctx && ctx.currentTime + i * 0.09); },
    tackle() { tone('sine', 160, 50, 0.18, 0.8); noise(0.08, 'bandpass', 1200, 1, 0.5); },
    smack(s) { tone('sine', 200, 40, 0.3, 1); noise(0.12, 'bandpass', 1500, 0.8, 0.7); },
    slam(s) { tone('sine', 120, 40, 0.25, Math.min(0.9, 0.3 + s * 0.05)); noise(0.2, 'lowpass', 600, 1, 0.5); },
    pickup() { [660, 880, 1320].forEach((f, i) => tone('sine', f, f, 0.15, 0.15, ctx && ctx.currentTime + i * 0.07)); },
    perfect() { tone('sine', 300, 40, 0.3, 1); tone('triangle', 1200, 2400, 0.25, 0.15); noise(0.1, 'highpass', 3000, 0.7, 0.4); },
    bumper() { tone('square', 520, 780, 0.09, 0.1); },
    chaos() { [440, 554, 659, 880].forEach((f, i) => tone('square', f, f, 0.12, 0.07, ctx && ctx.currentTime + i * 0.1)); roar(0.6, 1.5); },
    pop() { tone('sine', 500, 900, 0.08, 0.12); },
    ui() { tone('sine', 880, 660, 0.08, 0.12); },
    uiOk() { tone('sine', 660, 990, 0.12, 0.14); },
    tick() { tone('sine', 1000, 1000, 0.06, 0.12); },
    crowdLevel(v) { if (crowdGain) crowdGain.gain.setTargetAtTime(0.04 + v * 0.08, ctx.currentTime, 0.3); },
    end() { roar(1, 5); },
  };
  TP.Audio = S;
})();
