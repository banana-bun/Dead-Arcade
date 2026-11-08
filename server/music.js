// Shared music for one match: the server picks the song and when it started, and every
// player's browser plays that song from the same spot.
import fs from 'node:fs';
import path from 'node:path';

const AUDIO_EXT = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.opus', '.flac']);

// Every audio file in public/music is a track. "Artist - Title.mp3" is split for display.
export function listTracks(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* no music folder */ }
  return names
    .filter(n => AUDIO_EXT.has(path.extname(n).toLowerCase()))
    .map(n => {
      const base = path.basename(n, path.extname(n));
      const [artist, ...rest] = base.split(' - ');
      return { url: `/music/${encodeURIComponent(n)}`, artist: rest.length ? artist : '', title: rest.length ? rest.join(' - ') : base };
    });
}

export class Station {
  constructor(dir, broadcast) {
    this.dir = dir;
    this.broadcast = broadcast;
    this.queue = [];
    this.current = null;
    this.seq = 0;          // bumps on every track change so stale "ended"/"skip" messages are ignored
    this.startedAt = 0;
  }

  next() {
    if (!this.queue.length) {
      const tracks = listTracks(this.dir); // re-read so newly added songs join the shuffle
      for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
      if (tracks.length > 1 && tracks[0].url === this.current?.url) tracks.push(tracks.shift());
      this.queue = tracks;
    }
    this.current = this.queue.shift() || null;
    this.seq++;
    this.startedAt = Date.now();
    this.broadcast(this.state());
  }

  state() {
    if (!this.current) return { t: 'music', stop: true };
    return { t: 'music', seq: this.seq, ...this.current, startedAt: this.startedAt, now: Date.now() };
  }

  // A player's browser finished (or failed to load) the song: move on, once.
  ended(seq) { if (seq === this.seq) this.next(); }

  skip(seq) {
    if (seq !== this.seq) return false;
    this.next();
    return true;
  }
}
