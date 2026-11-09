/* Mitz & Simz sound v1.0.0: table sounds made in the browser, with no audio files.
   Shared by Hold the Line and Dungeon Delve. Owned by Hold the Line.
     const snd = MitzSound.create({ enabled: true, volume: 0.7 });
     snd.play('clang');                 // or { gain: 0.5 } as a second argument
     snd.enabled(false); snd.volume(0.4);
   Browsers start audio only after a click or key press. create() listens for the first one; call snd.unlock() from
   your own handler too if you like. Until then, and wherever Web Audio is missing (a test, an old browser), play()
   does nothing and returns false. The same sound is never started twice within 45 ms, and at most ten play at once,
   so a busy turn at double speed stays a clatter rather than a roar.
   Sounds: dice, clack, clang, thud, crack, squish, whiff, twang, whoosh, boom, coin, swat, crumble, chime, thump, door, horn. */
var MitzSound = (function () {
  'use strict';
  const VERSION = '1.0.0';
  const GAP = 0.045, MAX_VOICES = 10;

  function create(opts) {
    opts = opts || {};
    let on = opts.enabled !== false, vol = opts.volume == null ? 0.7 : opts.volume;
    let ac = null, master = null, noiseBuf = null, voices = 0;
    const last = {};
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);

    function ensure() {
      if (ac || !AC) return ac;
      try {
        ac = new AC();
        master = ac.createGain(); master.gain.value = vol; master.connect(ac.destination);
        const len = ac.sampleRate;
        noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
      return ac;
    }
    function unlock() { if (ensure() && ac.state === 'suspended') ac.resume().catch(() => {}); }
    if (typeof document !== 'undefined' && document.addEventListener) {
      const first = () => { unlock(); document.removeEventListener('pointerdown', first, true); document.removeEventListener('keydown', first, true); };
      document.addEventListener('pointerdown', first, true); document.addEventListener('keydown', first, true);
    }

    /* ---------- building blocks: a shaped tone, a shaped burst of filtered noise ---------- */
    function env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function tone(t, freq, type, peak, a, d, out, bend) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + a + d);
      env(g, t, a, peak, d); o.connect(g); g.connect(out);
      o.start(t); o.stop(t + a + d + 0.05);
    }
    function noise(t, peak, a, d, out, filt) {
      const s = ac.createBufferSource(), g = ac.createGain();
      s.buffer = noiseBuf;
      let node = s;
      if (filt) {
        const f = ac.createBiquadFilter();
        f.type = filt.type; f.frequency.setValueAtTime(filt.f, t);
        if (filt.to) f.frequency.exponentialRampToValueAtTime(filt.to, t + a + d);
        f.Q.value = filt.q || 1; s.connect(f); node = f;
      }
      env(g, t, a, peak, d); node.connect(g); g.connect(out);
      s.start(t, Math.random() * 0.5); s.stop(t + a + d + 0.05);
    }
    const jit = (v, k) => v * (1 - k + Math.random() * k * 2);

    const SOUNDS = {
      dice(t, o) { // a d20 rattling across the table
        for (let i = 0; i < 5; i++) {
          const tt = t + i * 0.075 + Math.random() * 0.03, k = 1 - i * 0.14;
          noise(tt, 0.28 * k, 0.002, 0.03, o, { type: 'bandpass', f: jit(2800, 0.3), q: 3 });
          tone(tt, jit(1100, 0.25), 'triangle', 0.05 * k, 0.002, 0.04, o);
        }
      },
      clack(t, o) { noise(t, 0.35, 0.001, 0.035, o, { type: 'bandpass', f: 1800, q: 2 }); tone(t, jit(210, 0.08), 'sine', 0.3, 0.002, 0.08, o, 0.7); },
      clang(t, o) {
        [523, 1187, 1873, 2659, 3411].forEach((f, i) => tone(t, jit(f, 0.03), 'sine', 0.12 / (i * 0.6 + 1), 0.002, 0.35 - i * 0.04, o));
        noise(t, 0.2, 0.001, 0.03, o, { type: 'highpass', f: 3000 });
      },
      thud(t, o) { tone(t, jit(120, 0.1), 'sine', 0.45, 0.003, 0.14, o, 0.5); noise(t, 0.18, 0.002, 0.06, o, { type: 'lowpass', f: 900 }); },
      crack(t, o) { noise(t, 0.4, 0.001, 0.05, o, { type: 'bandpass', f: jit(1400, 0.15), q: 1.5 }); tone(t, 340, 'square', 0.06, 0.001, 0.05, o, 0.6); },
      squish(t, o) { noise(t, 0.3, 0.01, 0.16, o, { type: 'lowpass', f: 700, to: 200 }); tone(t, 160, 'sine', 0.2, 0.01, 0.15, o, 1.6); },
      whiff(t, o) { noise(t, 0.15, 0.03, 0.12, o, { type: 'bandpass', f: 600, to: 1800, q: 1 }); },
      twang(t, o) { tone(t, jit(196, 0.05), 'sawtooth', 0.12, 0.002, 0.22, o, 0.92); noise(t, 0.08, 0.001, 0.02, o, { type: 'highpass', f: 2000 }); },
      whoosh(t, o) { noise(t, 0.22, 0.08, 0.3, o, { type: 'bandpass', f: 300, to: 2400, q: 0.8 }); },
      boom(t, o) { noise(t, 0.6, 0.005, 0.7, o, { type: 'lowpass', f: 1200, to: 80 }); tone(t, 70, 'sine', 0.5, 0.005, 0.5, o, 0.5); },
      coin(t, o) { tone(t, jit(2350, 0.04), 'sine', 0.08, 0.001, 0.12, o); tone(t + 0.05, jit(3150, 0.04), 'sine', 0.07, 0.001, 0.18, o); },
      swat(t, o) { noise(t, 0.18, 0.04, 0.1, o, { type: 'bandpass', f: 900, to: 2600, q: 0.9 }); tone(t + 0.08, 160, 'sine', 0.2, 0.003, 0.08, o, 0.6); },
      crumble(t, o) { for (let i = 0; i < 6; i++) noise(t + i * 0.045 + Math.random() * 0.02, 0.22 * (1 - i * 0.1), 0.002, 0.06, o, { type: 'bandpass', f: 500 + Math.random() * 900, q: 1.2 }); },
      chime(t, o) { [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.07, f, 'triangle', 0.09, 0.005, 0.35, o)); },
      thump(t, o) { tone(t, 90, 'sine', 0.35, 0.004, 0.2, o, 0.6); noise(t, 0.12, 0.002, 0.08, o, { type: 'lowpass', f: 500 }); },
      door(t, o) { tone(t, 60, 'sine', 0.55, 0.004, 0.35, o, 0.7); noise(t, 0.3, 0.002, 0.25, o, { type: 'lowpass', f: 600, to: 120 }); },
      horn(t, o) { tone(t, 220, 'sawtooth', 0.06, 0.08, 0.6, o); tone(t, 330, 'sawtooth', 0.04, 0.1, 0.55, o); }
    };

    function play(name, p) {
      if (!on || !SOUNDS[name] || !ensure() || ac.state !== 'running') return false;
      p = p || {};
      const t = ac.currentTime;
      if (last[name] != null && t - last[name] < GAP) return false;
      if (voices >= MAX_VOICES) return false;
      last[name] = t; voices++;
      setTimeout(() => { voices--; }, 700);
      const g = ac.createGain(); g.gain.value = p.gain == null ? 1 : p.gain; g.connect(master);
      try { SOUNDS[name](t, g); } catch (e) { return false; }
      return true;
    }
    return {
      VERSION, NAMES: Object.keys(SOUNDS), play, unlock,
      enabled(v) { if (v != null) on = !!v; return on; },
      volume(v) { if (v != null) { vol = Math.max(0, Math.min(1, +v || 0)); if (master) master.gain.value = vol; } return vol; },
      ready() { return !!ac && ac.state === 'running'; }
    };
  }
  return { VERSION, create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MitzSound;
