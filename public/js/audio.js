// Tiny synthesized sound effects (no asset files). Press M to mute.
let ctx = null, master = null, muted = false;
let noiseBuf = null;
let sfxVolume = 0.7; // 0..1 from the volume slider
try { const v = parseFloat(localStorage.getItem('dsa-sfx-vol')); if (Number.isFinite(v)) sfxVolume = v; } catch { /* storage blocked */ }

const masterLevel = () => (muted ? 0 : 0.5 * sfxVolume);

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = masterLevel();
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startAmbience();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() { ensure(); }

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = masterLevel();
  return muted;
}

export function getSfxVolume() { return sfxVolume; }

export function setSfxVolume(v) {
  sfxVolume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = masterLevel();
  try { localStorage.setItem('dsa-sfx-vol', String(sfxVolume)); } catch { /* storage blocked */ }
}

function tone({ type = 'square', from, to = from, dur = 0.1, vol = 0.3, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise({ dur = 0.1, vol = 0.3, freq = 1200, q = 1, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

export const sfx = {
  // weapon codes follow WEAPON_LIST in shared/config.js
  shot(weapon, vol = 1) {
    switch (weapon) {
      case 0: noise({ dur: 0.08, vol: 0.25 * vol, freq: 1800 }); tone({ from: 420, to: 90, dur: 0.07, vol: 0.12 * vol }); break; // handgun
      case 1: noise({ dur: 0.22, vol: 0.45 * vol, freq: 700, q: 0.6 }); tone({ from: 160, to: 40, dur: 0.18, vol: 0.2 * vol }); break; // shotgun
      case 2: tone({ type: 'sawtooth', from: 1800, to: 300, dur: 0.09, vol: 0.09 * vol }); tone({ type: 'sine', from: 900, to: 1400, dur: 0.06, vol: 0.06 * vol }); break; // laser
      case 3: noise({ dur: 0.05, vol: 0.18 * vol, freq: 2400 }); tone({ from: 300, to: 120, dur: 0.04, vol: 0.08 * vol }); break; // machine gun
      case 4: noise({ dur: 0.35, vol: 0.2 * vol, freq: 500, q: 0.5 }); tone({ type: 'sawtooth', from: 200, to: 600, dur: 0.25, vol: 0.06 * vol }); break; // rocket
      case 5: noise({ dur: 0.12, vol: 0.2 * vol, freq: 3200, q: 2 }); tone({ type: 'sine', from: 1400, to: 600, dur: 0.1, vol: 0.04 * vol }); break; // katana swoosh
      case 6: noise({ dur: 0.07, vol: 0.22 * vol, freq: 1900 }); noise({ dur: 0.07, vol: 0.2 * vol, freq: 1700, delay: 0.03 }); break; // double pistols
      case 7: noise({ dur: 0.04, vol: 0.15 * vol, freq: 2800 }); tone({ from: 500, to: 200, dur: 0.03, vol: 0.06 * vol }); break; // uzi
      case 8: noise({ dur: 0.09, vol: 0.3 * vol, freq: 1200, q: 0.8 }); tone({ from: 220, to: 70, dur: 0.08, vol: 0.14 * vol }); break; // ak-47
      case 9: noise({ dur: 0.06, vol: 0.24 * vol, freq: 2200, q: 1.2 }); tone({ from: 360, to: 140, dur: 0.05, vol: 0.1 * vol }); break; // m16
      case 12: noise({ dur: 0.035, vol: 0.14 * vol, freq: 2600, q: 1.5 }); tone({ type: 'sawtooth', from: 160, to: 120, dur: 0.03, vol: 0.05 * vol }); break; // minigun brrrt
      default: tone({ type: 'sine', from: 140, to: 60, dur: 0.15, vol: 0.3 * vol }); noise({ dur: 0.1, vol: 0.15 * vol, freq: 400 }); // grenade thump
    }
  },
  boom(vol = 1) {
    tone({ type: 'sine', from: 120, to: 30, dur: 0.6, vol: 0.5 * vol });
    noise({ dur: 0.6, vol: 0.5 * vol, freq: 260, q: 0.4 });
    noise({ dur: 0.2, vol: 0.3 * vol, freq: 1500, q: 0.7 });
  },
  hit() { noise({ dur: 0.05, vol: 0.12, freq: 500 }); },
  kill() { tone({ type: 'triangle', from: 180, to: 50, dur: 0.18, vol: 0.18 }); noise({ dur: 0.12, vol: 0.15, freq: 300 }); },
  hurt() { tone({ type: 'sawtooth', from: 220, to: 110, dur: 0.15, vol: 0.18 }); },
  // invincibility: a quick rising arpeggio, the classic "starman" feeling
  star() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.07, vol: 0.09, delay: i * 0.06 })); },
  ghost() { tone({ type: 'sine', from: 700, to: 200, dur: 0.5, vol: 0.12 }); tone({ type: 'sine', from: 720, to: 210, dur: 0.5, vol: 0.08, delay: 0.05 }); },
  throw() { noise({ dur: 0.18, vol: 0.12, freq: 900, q: 0.8 }); tone({ type: 'triangle', from: 300, to: 520, dur: 0.12, vol: 0.06 }); },
  pickup() { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.08, vol: 0.08, delay: i * 0.05 })); },
  down() { tone({ type: 'triangle', from: 400, to: 60, dur: 0.6, vol: 0.25 }); },
  // teammate down: two-tone siren so you notice even mid-fight
  alarm() { for (let i = 0; i < 3; i++) { tone({ type: 'square', from: 880, dur: 0.12, vol: 0.12, delay: i * 0.28 }); tone({ type: 'square', from: 660, dur: 0.12, vol: 0.12, delay: i * 0.28 + 0.14 }); } },
  revive() { [392, 523, 659].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.12, vol: 0.12, delay: i * 0.07 })); },
  round(boss) {
    tone({ type: 'sine', from: boss ? 55 : 82, to: boss ? 40 : 70, dur: 1.6, vol: 0.35 });
    tone({ type: 'triangle', from: boss ? 110 : 164, to: boss ? 80 : 140, dur: 1.2, vol: 0.15, delay: 0.1 });
    if (boss) noise({ dur: 1.0, vol: 0.2, freq: 200, q: 0.5, delay: 0.2 });
  },
  clear() { [330, 392, 494, 659].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.25, vol: 0.12, delay: i * 0.12 })); },
  slam() { tone({ type: 'sine', from: 90, to: 30, dur: 0.5, vol: 0.5 }); noise({ dur: 0.4, vol: 0.35, freq: 150, q: 0.4 }); },
  rise() { noise({ dur: 0.3, vol: 0.08, freq: 250, q: 0.7 }); },
  groan() { tone({ type: 'sawtooth', from: 90 + Math.random() * 40, to: 60, dur: 0.5, vol: 0.04 }); },
  chat() { tone({ type: 'sine', from: 880, to: 990, dur: 0.06, vol: 0.06 }); },
};

function startAmbience() {
  // low wind drone
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
  const g = ctx.createGain(); g.gain.value = 0.05;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
  const lg = ctx.createGain(); lg.gain.value = 120;
  lfo.connect(lg).connect(f.frequency);
  s.connect(f).connect(g).connect(master);
  s.start(); lfo.start();
}
