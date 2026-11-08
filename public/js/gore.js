// Gore: everything here either flies around as a particle or gets painted permanently
// onto the map canvas, so the streets get bloodier as the night goes on.

const BLOOD = ['#3a0306', '#4a0408', '#6a0a10', '#8a1018', '#5a0a0c'];
const ICHOR = ['#2a3a0a', '#3a4a10']; // zombie blood is a little green
const FLESH = ['#7a2a2a', '#9a3a3a', '#5a1a1a', '#6fae5a', '#4f7a46'];
const BONE = ['#e8e0d0', '#d0c8b4'];
const PUMPKIN = ['#d0561a', '#a83a0a', '#ffb030', '#2a4a10'];

const pick = list => list[Math.floor(Math.random() * list.length)];

// A blood splat painted onto the ground: an irregular pool plus droplets flung along `a`.
export function splat(g, x, y, size, a = null) {
  g.globalAlpha = 0.7;
  const blobs = 2 + Math.floor(size);
  for (let i = 0; i < blobs; i++) {
    const r = size * (0.4 + Math.random() * 0.6);
    const ox = (Math.random() - 0.5) * size * 1.4, oy = (Math.random() - 0.5) * size;
    g.fillStyle = pick(BLOOD);
    g.beginPath(); g.ellipse(Math.round(x + ox), Math.round(y + oy), r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
  }
  if (a !== null) {
    // droplets thrown in the direction of the hit, thinning out with distance
    for (let i = 0; i < size * 2.5; i++) {
      const d = size * 0.5 + Math.random() * size * 4;
      const sp = a + (Math.random() - 0.5) * 0.9;
      g.fillStyle = pick(BLOOD);
      const s = d < size * 2 ? 2 : 1;
      g.fillRect(Math.round(x + Math.cos(sp) * d), Math.round(y + Math.sin(sp) * d), s, s);
    }
    // a streak
    g.fillStyle = pick(BLOOD);
    for (let k = 0; k < 1; k++) {
      const sp = a + (Math.random() - 0.5) * 0.4, len = size * (2 + Math.random() * 2);
      for (let d = size * 0.5; d < len; d += 1) g.fillRect(Math.round(x + Math.cos(sp) * d), Math.round(y + Math.sin(sp) * d), 1, 1);
    }
  }
  if (Math.random() < 0.5) { g.fillStyle = pick(ICHOR); g.fillRect(Math.round(x + (Math.random() - 0.5) * size), Math.round(y + (Math.random() - 0.5) * size), 2, 1); }
  g.globalAlpha = 1;
}

// A single drop, for wounded zombies leaving a trail.
export function drip(g, x, y) {
  g.globalAlpha = 0.75;
  g.fillStyle = pick(BLOOD);
  g.fillRect(Math.round(x + (Math.random() - 0.5) * 4), Math.round(y + 2 + Math.random() * 2), Math.random() < 0.3 ? 2 : 1, 1);
  g.globalAlpha = 1;
}

// Directional spray when a bullet connects.
export function spray(particles, x, y, a, n, speed = 90) {
  for (let i = 0; i < n; i++) {
    const sp = a + (Math.random() - 0.5) * 1.1, v = speed * (0.3 + Math.random() * 0.9);
    particles.push({
      type: 'px', x, y, vx: Math.cos(sp) * v, vy: Math.sin(sp) * v, life: 0.25 + Math.random() * 0.35, max: 0.6,
      color: pick(Math.random() < 0.85 ? BLOOD : ICHOR), decal: true, drag: 5, size: Math.random() < 0.4 ? 2 : 1,
    });
  }
}

// Chunks of zombie that arc through the air, bounce, and stay where they land.
export function gibs(particles, x, y, n, a = null, speed = 80, boss = false) {
  for (let i = 0; i < n; i++) {
    const sp = a === null ? Math.random() * Math.PI * 2 : a + (Math.random() - 0.5) * 2.2;
    const v = speed * (0.3 + Math.random() * 0.9);
    const roll = Math.random();
    const color = boss && roll < 0.4 ? pick(PUMPKIN) : roll < 0.15 ? pick(BONE) : pick(FLESH);
    particles.push({
      type: 'gib', x, y, z: 4 + Math.random() * 6, vx: Math.cos(sp) * v, vy: Math.sin(sp) * v, vz: 40 + Math.random() * 90,
      color, size: Math.random() < 0.35 ? 3 : 2, life: 4, max: 4,
    });
  }
}

// Red puff that hangs in the air for a moment.
export function mist(particles, x, y, n, r = 6) {
  for (let i = 0; i < n; i++) {
    particles.push({ type: 'mist', x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r, r: 2 + Math.random() * r * 0.6, grow: 8 + Math.random() * 10, life: 0.5 + Math.random() * 0.3, max: 0.8 });
  }
}

// Advance a gib: gravity on a fake height axis, one weak bounce, then it sticks to the ground.
// Returns false once it has settled (and been painted).
export function updateGib(p, dt, g) {
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.z += p.vz * dt; p.vz -= 260 * dt;
  if (Math.random() < dt * 8) drip(g, p.x, p.y);
  if (p.z > 0) return true;
  p.z = 0;
  if (p.vz < -45) { p.vz *= -0.3; p.vx *= 0.45; p.vy *= 0.45; return true; }
  g.globalAlpha = 0.95;
  g.fillStyle = p.color;
  g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size - 1 || 1);
  g.fillStyle = pick(BLOOD);
  g.fillRect(Math.round(p.x) - 1, Math.round(p.y) + 1, p.size + 1, 1);
  g.globalAlpha = 1;
  return false;
}

export function drawGib(ctx, p) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(Math.round(p.x), Math.round(p.y) + 1, p.size, 1);
  ctx.fillStyle = p.color;
  ctx.fillRect(Math.round(p.x), Math.round(p.y - p.z), p.size, p.size);
}

export function drawMist(ctx, p) {
  const k = p.life / p.max;
  ctx.globalAlpha = 0.35 * k;
  ctx.fillStyle = '#8a0a12';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r + (1 - k) * p.grow, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

// Blood that splashes onto the "camera" when something dies right next to you.
export function newScreenSplat(vw, vh) {
  const edge = Math.random();
  const x = edge < 0.5 ? Math.random() * vw : (Math.random() < 0.5 ? Math.random() * vw * 0.25 : vw - Math.random() * vw * 0.25);
  const y = edge < 0.5 ? (Math.random() < 0.5 ? Math.random() * vh * 0.3 : vh - Math.random() * vh * 0.3) : Math.random() * vh;
  const blobs = Array.from({ length: 6 + Math.floor(Math.random() * 6) }, () => ({
    ox: (Math.random() - 0.5) * 22, oy: (Math.random() - 0.5) * 16, r: 2 + Math.random() * 7, drip: Math.random() < 0.4 ? 4 + Math.random() * 14 : 0,
  }));
  return { x, y, blobs, life: 2.2, max: 2.2 };
}

export function drawScreenSplat(ctx, s) {
  const k = Math.min(1, s.life / 1.2);
  const slide = (1 - s.life / s.max) * 10; // drips run down the screen
  ctx.globalAlpha = 0.75 * k;
  for (const b of s.blobs) {
    ctx.fillStyle = '#5a0006';
    ctx.beginPath(); ctx.arc(s.x + b.ox, s.y + b.oy, b.r, 0, Math.PI * 2); ctx.fill();
    if (b.drip) ctx.fillRect(Math.round(s.x + b.ox - 1), Math.round(s.y + b.oy), 2, b.drip + slide);
  }
  ctx.fillStyle = '#9a1018';
  for (const b of s.blobs) ctx.fillRect(Math.round(s.x + b.ox - b.r * 0.3), Math.round(s.y + b.oy - b.r * 0.4), 1, 1); // wet glint
  ctx.globalAlpha = 1;
}
