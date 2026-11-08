// Shared match music. The server picks the song and when it started; we play it from the
// same spot as everyone else. Skip changes the song for the whole lobby. Pause and volume
// only affect you (pausing just silences it, so it stays in sync when you turn it back on).
const audio = new Audio();
audio.preload = 'auto';

let state = null;      // current song from the server: { seq, url, artist, title, startedAt }
let clockOffset = 0;   // our clock minus the server's
let listening = true;
let muted = false;     // the M key
let volume = 0.5;
let send = () => {};
let onChange = () => {};

try { const v = parseFloat(localStorage.getItem('dsa-music-vol')); if (Number.isFinite(v)) volume = v; } catch { /* storage blocked */ }
try { if (localStorage.getItem('dsa-music-paused') === '1') listening = false; } catch { /* storage blocked */ }

function applyVolume() {
  audio.volume = volume;
  audio.muted = muted || !listening;
}

// Where the shared song should be right now, in seconds.
function position() {
  return state ? (Date.now() - clockOffset - state.startedAt) / 1000 : 0;
}

function syncAndPlay() {
  if (!state) return;
  const pos = position();
  if (Number.isFinite(audio.duration) && pos >= audio.duration - 0.25) { send({ t: 'musicEnded', seq: state.seq }); return; }
  if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime - pos) > 1) audio.currentTime = Math.max(0, pos);
  if (audio.paused) audio.play().catch(() => {}); // blocked until the first click/key press
}

audio.addEventListener('loadedmetadata', syncAndPlay);
audio.addEventListener('ended', () => state && send({ t: 'musicEnded', seq: state.seq }));
audio.addEventListener('error', () => { if (state) { const seq = state.seq; setTimeout(() => state?.seq === seq && send({ t: 'musicEnded', seq }), 1500); } });
audio.addEventListener('play', () => onChange());
audio.addEventListener('pause', () => onChange());

// Background tabs and slow connections drift; nudge back to the shared position now and then.
setInterval(() => { if (state && !audio.paused && Math.abs(audio.currentTime - position()) > 1.5) audio.currentTime = Math.max(0, position()); }, 5000);

export const music = {
  init(sendFn, changed) {
    send = sendFn;
    onChange = changed;
    applyVolume();
  },
  // Server message: a new/current song, or { stop: true } when the match ends.
  handle(m) {
    if (m.stop) {
      state = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      onChange();
      return;
    }
    clockOffset = Date.now() - m.now;
    if (!state || state.seq !== m.seq) {
      state = m;
      audio.src = m.url;
    } else {
      state = m;
      syncAndPlay();
    }
    onChange();
  },
  // Browsers only allow sound after a click or key press, so call this from one.
  kick() { if (state && audio.paused && audio.readyState >= 1) syncAndPlay(); },
  toggle() {
    listening = !listening;
    applyVolume();
    if (listening) syncAndPlay();
    try { localStorage.setItem('dsa-music-paused', listening ? '0' : '1'); } catch { /* storage blocked */ }
    onChange();
  },
  skip() { if (state) send({ t: 'musicSkip', seq: state.seq }); },
  setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    applyVolume();
    try { localStorage.setItem('dsa-music-vol', String(volume)); } catch { /* storage blocked */ }
  },
  setMuted(m) { muted = m; applyVolume(); },
  get volume() { return volume; },
  get active() { return !!state; },
  get playing() { return !!state && listening && !audio.paused; },
  get track() { return state; },
};
