// Client-side game: prediction for your own player, interpolation for everything else,
// and the pixel renderer with darkness, colored lights and bloom.
import { TILE, PLAYER, WEAPONS, WEAPON_LIST, DROP_TYPES, POWERUPS, STAR_SPEED, FRAGS, RARITIES, rarityOf } from '/shared/config.js';
import { generateMap, moveCircle, isSolidAt, isSolidTile, stepProjectile, blocksLight } from '/shared/map.js';
import * as art from './art.js';
import * as gore from './gore.js';
import { sfx } from './audio.js';

const WEAPON_KEYS = WEAPON_LIST;
const INTERP_DELAY = 100;
const ZRADIUS = [5, 4, 7, 16];
const DROP_NAMES = DROP_TYPES.map(d => d === 'health' ? 'Health' : POWERUPS[d]?.name ?? WEAPONS[d].name);
// guns glow in their rarity colour; everything else in its own colour
const DROP_GLOW = DROP_TYPES.map(d => d === 'health' ? '#ff4a5a' : rarityOf(d) ? RARITIES[rarityOf(d)].color : (POWERUPS[d] ?? WEAPONS[d]).color);
const COSMIC = ['#c83dff', '#3df2ff', '#ffffff', '#ff3df2'];
// Colour of a drop right now: rainbow guns cycle through colours, cosmic ones shimmer.
function dropColor(code, t) {
  const r = rarityOf(DROP_TYPES[code]);
  if (r === 'rainbow') return RAINBOW[Math.floor(t * 10) % RAINBOW.length];
  if (r === 'cosmic') return COSMIC[Math.floor(t * 7 + Math.sin(t * 3) * 2 + 8) % COSMIC.length];
  return DROP_GLOW[code];
}
const D = Object.fromEntries(DROP_TYPES.map((d, i) => [d, i])); // drop key -> code
const RAINBOW = ['#ff4a4a', '#ffb34a', '#ffe45a', '#7dff6a', '#5ad1ff', '#b56cff'];
const W = Object.fromEntries(WEAPON_LIST.map((w, i) => [w, i])); // weapon key -> code

export class GameClient {
  constructor({ canvas, send, myId, isTyping, hud, mapId, options = {} }) {
    this.options = options; // lobby toggles: { noEyes, friendlyFire }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.send = send;
    this.myId = myId;
    this.isTyping = isTyping;
    this.hud = hud;
    this.map = generateMap(mapId);
    this.bg = art.renderMapBackground(this.map);
    this.bgCtx = this.bg.getContext('2d');
    // Blood, corpses and scorch marks go on their own layer: clipped to walkable floor so
    // walls stay readable, and slowly fading so the map doesn't drown in red.
    this.decals = document.createElement('canvas');
    this.decals.width = this.bg.width; this.decals.height = this.bg.height;
    this.decalCtx = this.decals.getContext('2d');
    this.floorMask = makeFloorMask(this.map, this.bg.width, this.bg.height);
    this.decalFade = 0;
    this.light = document.createElement('canvas');
    this.lightCtx = this.light.getContext('2d');
    this.glow = document.createElement('canvas');
    this.glowCtx = this.glow.getContext('2d');
    this.lightSprite = makeLightSprite();
    this.tinted = new Map();

    this.snaps = [];
    this.offset = null;
    this.me = null;
    this.myTp = -1;
    this.lastShot = 0;
    this.lastInputSent = 0;
    this.stamina = PLAYER.maxStamina;
    this.staminaCd = 0;
    this.exhausted = false;
    this.bullets = [];
    this.particles = [];
    this.zFace = new Map();
    this.zHurt = new Map();
    this.prevZ = new Map();
    this.cam = { x: this.map.playerSpawn.x, y: this.map.playerSpawn.y };
    this.shake = 0;
    this.hurtFlash = 0;
    this.downFlash = 0;
    this.nukeFlash = 0;
    this.screenSplats = [];
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false };
    this.time = 0;
    this.fog = Array.from({ length: 16 }, () => ({
      x: Math.random() * this.bg.width, y: Math.random() * this.bg.height,
      r: 70 + Math.random() * 90, vx: 4 + Math.random() * 6, vy: (Math.random() - 0.5) * 3,
    }));
    this.leaves = [];
    this.banner = null;
    this.hudTimer = 0;
    this.moving = new Map();

    this.onResize = () => this.resize();
    this.onKeyDown = e => {
      if (this.isTyping()) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'tab') { e.preventDefault(); this.hud.scoreboard(true); }
      if (k === 'q' && !e.repeat) this.throwFrag();
    };
    this.onKeyUp = e => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'tab') this.hud.scoreboard(false);
    };
    this.onMouseMove = e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
    this.onMouseDown = e => { if (e.button === 0) this.mouse.down = true; };
    this.onMouseUp = e => { if (e.button === 0) this.mouse.down = false; };
    this.onBlur = () => { this.keys.clear(); this.mouse.down = false; };
    this.onContext = e => e.preventDefault();
  }

  start() {
    this.resize();
    addEventListener('resize', this.onResize);
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    addEventListener('mouseup', this.onMouseUp);
    addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('contextmenu', this.onContext);
    this.last = performance.now();
    const loop = now => {
      if (this.stopped) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    removeEventListener('mouseup', this.onMouseUp);
    removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('contextmenu', this.onContext);
  }

  resize() {
    this.scale = Math.max(2, Math.round(innerHeight / 240));
    this.vw = Math.ceil(innerWidth / this.scale);
    this.vh = Math.ceil(innerHeight / this.scale);
    for (const c of [this.canvas, this.light, this.glow]) { c.width = this.vw; c.height = this.vh; }
    this.ctx.imageSmoothingEnabled = false;
    this.vignette = makeVignette(this.vw, this.vh);
  }

  // ---------- networking ----------

  onSnapshot(m) {
    const now = Date.now();
    const sample = now - m.time;
    this.offset = this.offset === null ? sample : Math.min(sample, this.offset * 0.98 + sample * 0.02);
    const snap = {
      time: m.time, round: m.round, phase: m.phase, timer: m.timer, left: m.left,
      players: new Map(m.p.map(a => [a[0], {
        id: a[0], x: a[1], y: a[2], a: a[3], hp: a[4], state: a[5], weapon: a[6], ammo: a[7],
        score: a[8], kills: a[9], tp: a[10], revive: a[11], bleed: a[12], name: a[13], color: a[14],
        star: a[15] ?? 0, ghost: a[16] ?? 0, frags: a[17] ?? 0, minigun: a[18] ?? 0,
      }])),
      zombies: new Map(m.z.map(a => [a[0], { id: a[0], type: a[1], x: a[2], y: a[3], hp: a[4], maxHp: a[5], bs: a[6], enraged: !!a[7] }])),
      drops: m.d.map(a => ({ id: a[0], type: a[1], x: a[2], y: a[3], life: a[4] })),
      bombs: (m.b ?? []).map(a => ({ id: a[0], sx: a[1], sy: a[2], tx: a[3], ty: a[4], k: a[5] })),
      recvAt: this.time, // bombs are extrapolated from here between snapshots
    };
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();
    this.latest = snap;
    for (const ev of m.ev) this.handleEvent(ev);
  }

  handleEvent(ev) {
    const near = (x, y) => {
      const d = Math.hypot(x - this.cam.x, y - this.cam.y);
      return Math.max(0, 1 - d / 400);
    };
    switch (ev.e) {
      case 'shot': {
        if (ev.p === this.myId) break;
        this.fire(ev.x, ev.y, ev.a, ev.w, ev.p);
        const v = near(ev.x, ev.y);
        if (v > 0) sfx.shot(ev.w, v * 0.7);
        break;
      }
      case 'throw':
        if (ev.p !== this.myId) { this.lob(ev.x, ev.y, ev.a, ev.s, ev.p); if (near(ev.x, ev.y) > 0) sfx.throw(); }
        break;
      case 'hit': {
        this.zHurt.set(ev.z, this.time + 0.08);
        const a = ev.a ?? Math.random() * Math.PI * 2;
        gore.spray(this.particles, ev.x, ev.y, a, 5);
        if (Math.random() < 0.5) gore.mist(this.particles, ev.x, ev.y, 1, 4);
        if (Math.random() < 0.2) gore.splat(this.decalCtx, ev.x + Math.cos(a) * 6, ev.y + Math.sin(a) * 6, 1.5, a);
        if (near(ev.x, ev.y) > 0.3) sfx.hit();
        break;
      }
      case 'kill': {
        const a = ev.a ?? Math.random() * Math.PI * 2;
        const boss = ev.z === 3;
        const blown = boss || ev.blast; // explosions (and the boss) leave no body, just pieces
        gore.splat(this.decalCtx, ev.x, ev.y, boss ? 10 : ev.z === 2 ? 4 : 3, a);
        if (!blown) art.drawCorpse(this.decalCtx, ev.x + Math.cos(a) * 3, ev.y + Math.sin(a) * 3, a, ev.z, ev.id ?? 0);
        gore.gibs(this.particles, ev.x, ev.y, boss ? 45 : blown ? 10 : 3 + Math.floor(Math.random() * 3), blown ? null : a, boss ? 150 : blown ? 110 : 70, boss);
        gore.spray(this.particles, ev.x, ev.y, a, boss ? 35 : 10, boss ? 150 : 100);
        gore.mist(this.particles, ev.x, ev.y, boss ? 10 : 2, boss ? 20 : 6);
        if (boss) {
          for (let i = 0; i < 3; i++) gore.splat(this.decalCtx, ev.x + (Math.random() - 0.5) * 40, ev.y + (Math.random() - 0.5) * 30, 5 + Math.random() * 4, Math.random() * Math.PI * 2);
          this.shake = 12;
          this.showBanner('THE GOURD KING FALLS', 2.5, '#c8ff5a');
        }
        // blood on the lens when it happens right in your face
        if (this.me && Math.hypot(ev.x - this.me.x, ev.y - this.me.y) < (boss ? 60 : blown ? 40 : 26)) {
          const n = boss ? 4 : 1 + (Math.random() < 0.4 ? 1 : 0);
          for (let i = 0; i < n; i++) this.screenSplats.push(gore.newScreenSplat(this.vw, this.vh));
        }
        if (near(ev.x, ev.y) > 0) sfx.kill();
        break;
      }
      case 'enrage':
        sfx.slam();
        this.shake = Math.max(this.shake, 8);
        this.showBanner('THE GOURD KING IS ENRAGED!', 2.2, '#ff3030', 'Faster. Angrier. Bigger slams.');
        break;
      case 'pickup': {
        const p = this.latest?.players.get(ev.p);
        const color = dropColor(ev.d, this.time);
        if (p) this.burst(p.x, p.y, 16, ['#ffffff', color], 50, false, true);
        const rarity = rarityOf(DROP_TYPES[ev.d]);
        const brag = { [D.star]: 'is INVINCIBLE', [D.ghost]: 'is INVISIBLE', [D.minigun]: 'has the MINIGUN' }[ev.d];
        if (ev.p === this.myId) {
          if (ev.d === D.star || ev.d === D.minigun) sfx.star(); else if (ev.d === D.ghost) sfx.ghost(); else sfx.pickup();
          this.hud.toast(`+ ${DROP_NAMES[ev.d]}${rarity ? ` (${RARITIES[rarity].name})` : ''}`, color);
        } else if (p && brag) this.hud.toast(`${p.name} ${brag}!`, color);
        else if (p && (rarity === 'gold' || rarity === 'rainbow' || rarity === 'cosmic')) this.hud.toast(`${p.name} found a ${RARITIES[rarity].name} ${DROP_NAMES[ev.d]}!`, color);
        break;
      }
      case 'nuke': {
        // blinding flash, a huge shockwave, and everything nearby goes up at once
        this.nukeFlash = 1;
        this.shake = 16;
        this.particles.push({ type: 'ring', x: ev.x, y: ev.y, r: 6, maxR: 260, life: 0.7, max: 0.7 });
        this.particles.push({ type: 'boom', x: ev.x, y: ev.y, life: 0.6, max: 0.6 });
        sfx.boom(1); sfx.boom(0.8);
        const who = this.latest?.players.get(ev.p);
        this.showBanner('NUKE!', 1.8, '#7dff6a', `${who?.name ?? 'Someone'} wiped out ${ev.n} zombies`);
        break;
      }
      case 'hurt': {
        if (ev.p === this.myId) { this.hurtFlash = 0.5; this.shake = Math.max(this.shake, 4); sfx.hurt(); }
        const p = ev.p === this.myId && this.me ? this.me : this.latest?.players.get(ev.p);
        if (p) { gore.spray(this.particles, p.x, p.y - 1, Math.random() * Math.PI * 2, 6, 60); gore.drip(this.decalCtx, p.x, p.y); }
        break;
      }
      case 'down': {
        const p = this.latest?.players.get(ev.p);
        if (ev.p === this.myId) {
          sfx.down();
          this.hud.toast('YOU ARE DOWN! Teammates can revive you', '#ff4a4a');
        } else {
          sfx.alarm();
          this.downFlash = 1;
          this.showBanner(`${(p?.name ?? 'A TEAMMATE').toUpperCase()} IS DOWN!`, 1.8, '#ff4a4a', 'Get to them before they bleed out');
        }
        break;
      }
      case 'revive': {
        sfx.revive();
        const p = this.latest?.players.get(ev.p), by = this.latest?.players.get(ev.by);
        this.hud.toast(ev.p === this.myId ? 'Revived!' : `${by?.name ?? 'Someone'} revived ${p?.name ?? 'a teammate'}`, '#7dff6a');
        break;
      }
      case 'dead': if (ev.p === this.myId) this.hud.toast('You bled out. Back next round.', '#ff4a4a'); break;
      case 'round':
        sfx.round(ev.boss);
        this.showBanner(ev.boss ? `ROUND ${ev.n}: BOSS` : `ROUND ${ev.n}`, 2.5, ev.boss ? '#ff3df2' : '#ff8a2a', ev.boss ? 'The Gourd King approaches...' : '');
        break;
      case 'clear': sfx.clear(); this.showBanner('ROUND CLEARED', 2.2, '#7dff6a', ev.drink ? 'Take a Drink' : 'Catch your breath'); break;
      case 'slam':
        this.particles.push({ type: 'ring', x: ev.x, y: ev.y, r: 4, maxR: ev.r, life: 0.45, max: 0.45 });
        this.burst(ev.x, ev.y, 30, ['#3b2a1e', '#5a4030'], 120, false);
        this.shake = 9; sfx.slam();
        break;
      case 'boom':
        this.particles.push({ type: 'ring', x: ev.x, y: ev.y, r: 3, maxR: ev.r, life: 0.3, max: 0.3 });
        this.particles.push({ type: 'boom', x: ev.x, y: ev.y, life: 0.25, max: 0.25 });
        this.burst(ev.x, ev.y, 26, ['#ffe07a', '#ff8a2a', '#ff4a1a', '#ffffff'], 140, false, true);
        this.burst(ev.x, ev.y, 14, ['#2a2430', '#3a3440', '#1a1820'], 50, true);
        if (ev.k === 1) { // boss pumpkin bomb: shell shards and burning pulp
          this.burst(ev.x, ev.y, 18, ['#d0561a', '#a83a0a', '#ffb030', '#2a4a10'], 110, true, true);
          this.decalCtx.globalAlpha = 0.6; this.decalCtx.fillStyle = '#1a0e08';
          this.decalCtx.beginPath(); this.decalCtx.arc(ev.x, ev.y, ev.r * 0.45, 0, Math.PI * 2); this.decalCtx.fill(); // scorch mark
          this.decalCtx.globalAlpha = 1;
        }
        this.shake = Math.max(this.shake, 6 * near(ev.x, ev.y) + 1);
        if (near(ev.x, ev.y) > 0) sfx.boom(near(ev.x, ev.y));
        break;
      case 'rise':
        this.burst(ev.x, ev.y, 10, ['#3b2a1e', '#2a1e16', '#4a3a28'], 40, false);
        if (near(ev.x, ev.y) > 0.3) sfx.rise();
        break;
    }
  }

  showBanner(text, dur, color, sub = '') {
    this.hud.banner(text, color, sub, dur);
  }

  // ---------- simulation ----------

  myState() { return this.latest?.players.get(this.myId); }

  update(dt) {
    this.time += dt;
    const st = this.myState();
    if (st && !this.me) this.me = { x: st.x, y: st.y, a: 0 };
    if (st && st.tp !== this.myTp) { this.me.x = st.x; this.me.y = st.y; this.myTp = st.tp; }
    const me = this.me;

    if (me && st) {
      const alive = st.state === 0;
      let mx = 0, my = 0;
      if (alive && !this.isTyping()) {
        if (this.keys.has('w') || this.keys.has('arrowup')) my -= 1;
        if (this.keys.has('s') || this.keys.has('arrowdown')) my += 1;
        if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
        if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
      }
      const len = Math.hypot(mx, my);
      // Sprint: Shift drains stamina; running dry locks sprint until it recovers a bit.
      if (this.exhausted && this.stamina >= PLAYER.staminaMinRestart) this.exhausted = false;
      const sprinting = len > 0 && this.keys.has('shift') && !this.exhausted && this.stamina > 0;
      if (sprinting) {
        this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
        this.staminaCd = PLAYER.staminaDelay;
        if (this.stamina === 0) this.exhausted = true;
      } else if ((this.staminaCd -= dt) <= 0) {
        this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * dt);
      }
      if (len) {
        const speed = PLAYER.speed * (sprinting ? PLAYER.sprintMul : 1) * (st.star > 0 ? STAR_SPEED : 1) * dt;
        const pos = moveCircle(this.map, me.x, me.y, mx / len * speed, my / len * speed, PLAYER.radius);
        me.x = pos.x; me.y = pos.y;
        if (sprinting && Math.random() < dt * 12) this.particles.push({ type: 'px', x: me.x, y: me.y + 3, vx: -mx / len * 15, vy: -my / len * 15, life: 0.3, max: 0.3, color: '#3a3448', drag: 5 });
      }
      this.moving.set(this.myId, len > 0);
      if (alive && Math.hypot(st.x - me.x, st.y - me.y) > 48 && !len) { me.x = st.x; me.y = st.y; }
      const wx = this.cam.x - this.vw / 2 + this.mouse.x / this.scale;
      const wy = this.cam.y - this.vh / 2 + this.mouse.y / this.scale;
      me.a = Math.atan2(wy - (me.y - 1), wx - me.x);

      const now = performance.now();
      if (now - this.lastInputSent > 33) {
        this.lastInputSent = now;
        this.send({ t: 'input', x: +me.x.toFixed(1), y: +me.y.toFixed(1), a: +me.a.toFixed(3) });
      }

      const gun = st.minigun > 0 ? W.minigun : st.weapon; // the Minigun powerup overrides your gun
      const w = WEAPONS[WEAPON_KEYS[gun]];
      if (alive && this.mouse.down && !this.isTyping() && now - this.lastShot >= w.fireRate * 1000) {
        this.lastShot = now;
        const angles = [];
        for (let i = 0; i < w.pellets; i++) {
          // shotgun pellets fan out; double pistols fire side by side
          const fan = w.pellets > 1 && !w.offsets ? (i / (w.pellets - 1) - 0.5) * w.spread : 0;
          angles.push(me.a + fan + (Math.random() - 0.5) * (w.pellets > 1 && !w.offsets ? 0.08 : w.spread));
        }
        this.send({ t: 'shoot', a: angles.map(v => +v.toFixed(3)) });
        this.fire(me.x, me.y, angles, gun, this.myId);
        sfx.shot(gun);
        if (gun === W.shotgun || gun === W.grenade) this.shake = Math.max(this.shake, 3);
        if (gun === W.minigun) this.shake = Math.max(this.shake, 1.2);
      }
    }

    // camera follows you (or a living teammate while you're out)
    let focus = me;
    if (st && st.state === 2) {
      const mate = [...(this.latest?.players.values() ?? [])].find(p => p.state === 0);
      if (mate) focus = this.interpPlayer(mate.id) || mate;
    }
    if (focus) {
      let tx = focus.x, ty = focus.y;
      if (focus === me) {
        tx += (this.mouse.x / this.scale - this.vw / 2) * 0.18;
        ty += (this.mouse.y / this.scale - this.vh / 2) * 0.18;
      }
      this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 8);
      this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 8);
    }
    const mw = this.bg.width, mh = this.bg.height;
    this.cam.x = Math.max(this.vw / 2, Math.min(mw - this.vw / 2, this.cam.x));
    this.cam.y = Math.max(this.vh / 2, Math.min(mh - this.vh / 2, this.cam.y));

    this.shake = Math.max(0, this.shake - dt * 30);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.downFlash = Math.max(0, this.downFlash - dt * 0.6);
    this.nukeFlash = Math.max(0, this.nukeFlash - dt * 0.9);
    this.view = this.interpolate();
    // wounded zombies leave a blood trail
    for (const z of this.view?.zombies ?? []) if (z.hp < z.maxHp && Math.random() < dt * (z.type === 3 ? 6 : 1.2)) gore.drip(this.decalCtx, z.x, z.y);
    this.updateBullets(dt);
    this.updateParticles(dt);
    for (const f of this.fog) {
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.x - f.r > this.bg.width) f.x = -f.r;
    }
    if (this.leaves.length < 40 && Math.random() < dt * 8) {
      this.leaves.push({
        x: this.cam.x - this.vw / 2 + Math.random() * this.vw, y: this.cam.y - this.vh / 2 - 5,
        vx: 8 + Math.random() * 10, vy: 12 + Math.random() * 10, ph: Math.random() * 6,
        c: ['#9a4416', '#c8661e', '#6a2a10', '#8a6a1a'][Math.floor(Math.random() * 4)], life: 6,
      });
    }
    for (const l of this.leaves) { l.ph += dt * 3; l.x += (l.vx + Math.sin(l.ph) * 12) * dt; l.y += l.vy * dt; l.life -= dt; }
    this.leaves = this.leaves.filter(l => l.life > 0);
    if (Math.random() < dt * 0.4 && this.view?.zombies.length) sfx.groan();

    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && this.latest) {
      this.hudTimer = 0.1;
      const boss = this.view?.zombies.find(z => z.type === 3);
      this.hud.update(this.latest, this.myId, boss, this.stamina / PLAYER.maxStamina, this.exhausted);
    }
  }

  interpolate() {
    if (!this.snaps.length || this.offset === null) return null;
    const rt = Date.now() - this.offset - INTERP_DELAY;
    let a = this.snaps[0], b = this.snaps[0];
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].time <= rt) { a = this.snaps[i]; b = this.snaps[i + 1] || a; break; }
    }
    const span = b.time - a.time;
    const f = span > 0 ? Math.max(0, Math.min(1, (rt - a.time) / span)) : 0;
    const lerp = (p, q) => p + (q - p) * f;
    const lerpA = (p, q) => { let d = q - p; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return p + d * f; };
    const players = [];
    for (const pb of b.players.values()) {
      const pa = a.players.get(pb.id) || pb;
      const ip = { ...pb, x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y), a: lerpA(pa.a, pb.a) };
      const lat = this.latest.players.get(pb.id);
      if (lat) Object.assign(ip, { hp: lat.hp, state: lat.state, weapon: lat.weapon, revive: lat.revive, bleed: lat.bleed, star: lat.star, ghost: lat.ghost, minigun: lat.minigun });
      this.moving.set(pb.id, pb.id === this.myId ? this.moving.get(pb.id) : Math.hypot(pb.x - pa.x, pb.y - pa.y) > 0.5);
      players.push(ip);
    }
    const zombies = [];
    for (const zb of b.zombies.values()) {
      const za = a.zombies.get(zb.id) || zb;
      const z = { ...zb, x: lerp(za.x, zb.x), y: lerp(za.y, zb.y) };
      const prev = this.prevZ.get(z.id);
      if (prev) {
        const dx = z.x - prev.x, dy = z.y - prev.y;
        if (dx * dx + dy * dy > 0.01) this.zFace.set(z.id, Math.atan2(dy, dx));
      }
      this.prevZ.set(z.id, { x: z.x, y: z.y });
      z.a = this.zFace.get(z.id) ?? 0;
      zombies.push(z);
    }
    if (this.prevZ.size > zombies.length * 2 + 50) {
      const live = new Set(zombies.map(z => z.id));
      for (const id of this.prevZ.keys()) if (!live.has(id)) { this.prevZ.delete(id); this.zFace.delete(id); this.zHurt.delete(id); }
    }
    const bombs = this.latest.bombs.map(b => ({ ...b, k: Math.min(1, b.k + (this.time - this.latest.recvAt) / 1.1) }));
    return { players, zombies, drops: this.latest.drops, bombs };
  }

  interpPlayer(id) { return this.view?.players.find(p => p.id === id); }

  // Q: lob a grenade so it lands about where the cursor is.
  throwFrag() {
    const st = this.myState(), me = this.me;
    if (!st || !me || st.state !== 0 || st.frags <= 0) return;
    const now = performance.now();
    if (now - (this.lastThrow ?? 0) < WEAPONS.frag.fireRate * 1000) return;
    this.lastThrow = now;
    const wx = this.cam.x - this.vw / 2 + this.mouse.x / this.scale;
    const wy = this.cam.y - this.vh / 2 + this.mouse.y / this.scale;
    const d = Math.hypot(wx - me.x, wy - me.y);
    this.send({ t: 'throw', a: +me.a.toFixed(3), d: Math.round(d) });
    this.lob(me.x, me.y, me.a, Math.max(FRAGS.minSpeed, Math.min(FRAGS.maxSpeed, d * FRAGS.throwScale)), this.myId);
    sfx.throw();
  }

  lob(x, y, a, speed, owner) {
    this.spawnBullet(x, y, a, W.frag, owner);
    const b = this.bullets[this.bullets.length - 1];
    b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed;
  }

  // One trigger pull: a katana swing, or bullets plus a muzzle flash.
  fire(x, y, angles, w, owner) {
    const def = WEAPONS[WEAPON_KEYS[w]];
    if (def.melee) {
      this.particles.push({ type: 'slash', x, y, a: angles[0], r: def.melee.reach, arc: def.melee.arc, life: 0.14, max: 0.14, flip: Math.random() < 0.5 });
      return;
    }
    angles.forEach((a, i) => this.spawnBullet(x, y, a, w, owner, def.offsets ? def.offsets[i] || 0 : 0));
    for (const off of def.offsets ?? [0]) this.muzzle(x - Math.sin(angles[0]) * off, y + Math.cos(angles[0]) * off, angles[0], w);
  }

  spawnBullet(x, y, a, w, owner, off = 0) {
    const def = WEAPONS[WEAPON_KEYS[w]];
    x -= Math.sin(a) * off; y += Math.cos(a) * off;
    const lead = def.bounce ? 4 : 7;
    this.bullets.push({
      x: x + Math.cos(a) * lead, y: y + Math.sin(a) * lead, px: x, py: y,
      vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed,
      dist: 0, range: def.range, w, pierce: def.pierce, hit: new Set(), owner,
      fuse: def.fuse, bounce: def.bounce, explode: !!def.explode,
    });
  }

  muzzle(x, y, a, w) {
    const color = WEAPONS[WEAPON_KEYS[w]].color;
    this.particles.push({ type: 'flash', x: x + Math.cos(a) * 10, y: y - 1 + Math.sin(a) * 10, life: 0.06, max: 0.06, color });
    if (![W.laser, W.rocket, W.grenade].includes(w)) this.particles.push({ type: 'px', x, y, vx: -Math.sin(a) * 30 + (Math.random() - 0.5) * 10, vy: Math.cos(a) * 30, life: 0.4, max: 0.4, color: '#c8a040', drag: 4 });
  }

  updateBullets(dt) {
    const zs = this.view?.zombies ?? [];
    this.bullets = this.bullets.filter(b => {
      b.px = b.x; b.py = b.y;
      if (b.w === W.rocket && Math.random() < dt * 40) {
        this.particles.push({ type: 'px', x: b.x - b.vx * 0.03, y: b.y - b.vy * 0.03, vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12, life: 0.5, max: 0.5, color: Math.random() < 0.3 ? '#ff9a3a' : '#5a5464', drag: 3, size: 2 });
      }
      if (b.bounce) { const k = Math.max(0, 1 - 1.6 * dt); b.vx *= k; b.vy *= k; }
      for (let s = 0; s < 3; s++) {
        stepProjectile(this.map, b, dt / 3);
        // explosives just vanish locally; the server's 'boom' event draws the blast
        if (b.fuse !== undefined && (b.fuse -= dt / 3) <= 0) return false;
        if (b.dist > b.range) return false;
        if (!b.bounce && isSolidAt(this.map, b.x, b.y)) {
          this.burst(b.x, b.y, 3, ['#ffe0a0', '#c8c8c8'], 30, false, true);
          return false;
        }
        for (const z of zs) {
          if (b.hit.has(z.id)) continue;
          const r = ZRADIUS[z.type] + 2;
          if ((z.x - b.x) ** 2 + (z.y - b.y) ** 2 > r * r) continue;
          b.hit.add(z.id);
          if (b.explode || b.pierce-- <= 0) return false;
        }
        // friendly fire: shots stop at teammates (the server applies the damage)
        if (this.options.friendlyFire) for (const p of this.view?.players ?? []) {
          if (p.id === b.owner || p.state !== 0) continue;
          const px = p.id === this.myId && this.me ? this.me.x : p.x, py = p.id === this.myId && this.me ? this.me.y : p.y;
          if ((px - b.x) ** 2 + (py - b.y) ** 2 <= (PLAYER.radius + 1) ** 2) return false;
        }
      }
      return true;
    });
  }

  burst(x, y, n, colors, speed, decal, glow = false) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        type: 'px', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, max: 0.7,
        color: colors[Math.floor(Math.random() * colors.length)], decal, glow, drag: 6, size: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }

  updateParticles(dt) {
    this.particles = this.particles.filter(p => {
      p.life -= dt;
      if (p.type === 'ring') { p.r += (p.maxR - p.r) * dt * 10; return p.life > 0; }
      if (p.type === 'gib') return gore.updateGib(p, dt, this.decalCtx) && p.life > 0;
      if (p.type === 'px') {
        p.x += p.vx * dt; p.y += p.vy * dt;
        const k = Math.max(0, 1 - (p.drag || 0) * dt);
        p.vx *= k; p.vy *= k;
      }
      if (p.life <= 0) {
        if (p.decal) { this.decalCtx.fillStyle = p.color; this.decalCtx.globalAlpha = 0.7; this.decalCtx.fillRect(Math.round(p.x), Math.round(p.y), p.size || 1, p.size || 1); this.decalCtx.globalAlpha = 1; }
        return false;
      }
      return true;
    });
    if (this.particles.length > 2500) this.particles.splice(0, this.particles.length - 2500);
    this.screenSplats = this.screenSplats.filter(s => (s.life -= dt) > 0);
    // every second: wipe blood off walls, and fade all of it a little (gone in about a minute and a half)
    if ((this.decalFade += dt) >= 1) {
      this.decalFade = 0;
      const g = this.decalCtx;
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(this.floorMask, 0, 0);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.03)';
      g.fillRect(0, 0, this.decals.width, this.decals.height);
      g.globalCompositeOperation = 'source-over';
    }
  }

  // ---------- rendering ----------

  tint(color) {
    let c = this.tinted.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = this.lightSprite.width;
      const g = c.getContext('2d');
      g.drawImage(this.lightSprite, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
      this.tinted.set(color, c);
    }
    return c;
  }

  render() {
    const { ctx, vw, vh } = this;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const camX = Math.round(this.cam.x - vw / 2 + sx), camY = Math.round(this.cam.y - vh / 2 + sy);
    this.camX = camX; this.camY = camY;
    const t = this.time;
    const inView = (x, y, m = 40) => x > camX - m && x < camX + vw + m && y > camY - m && y < camY + vh + m;
    const emitters = [];
    const lights = [];

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05030a'; ctx.fillRect(0, 0, vw, vh);
    ctx.drawImage(this.bg, camX, camY, vw, vh, 0, 0, vw, vh);
    ctx.drawImage(this.decals, camX, camY, vw, vh, 0, 0, vw, vh);
    ctx.save();
    ctx.translate(-camX, -camY);

    // static decor
    for (const d of this.map.decor) {
      if (!inView(d.x, d.y)) continue;
      const flick = 0.5 + 0.5 * Math.sin(t * 9 + d.x * 0.37) * Math.sin(t * 5.3 + d.y);
      if (d.type === 'pumpkin') { art.drawPumpkin(ctx, d.x, d.y, d.v, flick); emitters.push([d.x - 2, d.y - 2, 5, 4, '#ffb030', 0.6 + flick * 0.4]); }
      else if (d.type === 'lamp') { art.drawLamp(ctx, d.x, d.y); emitters.push([d.x - 1, d.y - 1, 3, 2, '#fff0c0', 1]); }
      else if (d.type === 'candle') { art.drawCandle(ctx, d.x, d.y, t); emitters.push([d.x, d.y - 3, 2, 1, '#ffd36a', 0.8]); }
      else if (d.type === 'crypt') { art.drawCrypt(ctx, d.x, d.y); emitters.push([d.x - 2, d.y + 6, 1, 1, '#6aff9a', 1], [d.x + 2, d.y + 6, 1, 1, '#6aff9a', 1]); }
      else if (d.type === 'scarecrow') { art.drawScarecrow(ctx, d.x, d.y, t); emitters.push([d.x - 2, d.y - 10, 4, 3, '#ffe07a', 0.8]); }
      else if (d.type === 'fire') {
        art.drawFire(ctx, d.x, d.y, t);
        emitters.push(...art.fireEmitters(d.x, d.y, t));
        if (Math.random() < 0.3) this.particles.push({ type: 'px', x: d.x + (Math.random() - 0.5) * 6, y: d.y - 6, vx: (Math.random() - 0.5) * 8, vy: -20 - Math.random() * 20, life: 0.8, max: 0.8, color: Math.random() < 0.5 ? '#ffb03a' : '#ff5a1a', glow: true });
      }
      else if (d.type === 'neon') art.drawNeon(ctx, d, t, emitters);
      else if (d.type === 'mannequin') art.drawMannequin(ctx, d.x, d.y, d.v);
      else if (d.type === 'kiosk') { art.drawKiosk(ctx, d.x, d.y, t); emitters.push([d.x - 3, d.y - 5, 6, 1, '#3df2ff', 0.7]); }
      else if (d.type === 'cart') art.drawCart(ctx, d.x, d.y, d.a);
      else if (d.type === 'exit') { art.drawExit(ctx, d.x, d.y); emitters.push([d.x - 4, d.y - 2, 9, 3, '#ff3030', 0.7]); }
      else if (d.type === 'screen') { art.drawScreen(ctx, d, t, emitters); lights.push([d.x, d.y, 26, d.color, 0.35]); }
      else if (d.type === 'tv') art.drawTV(ctx, d, t, emitters);
      else if (d.type === 'tank') { art.drawTank(ctx, d, t, emitters); lights.push([d.x, d.y, 24, '#3a8aff', 0.3]); }
      else if (d.type === 'guitar') art.drawGuitar(ctx, d);
      else if (d.type === 'teddy') art.drawTeddy(ctx, d.x, d.y);
      else if (d.type === 'drums') art.drawDrums(ctx, d.x, d.y);
      else if (d.type === 'chair') art.drawChair(ctx, d.x, d.y);
      else if (d.type === 'rug') art.drawRug(ctx, d.x, d.y);
      else if (d.type === 'stall') art.drawStall(ctx, d, t, emitters);
      else if (d.type === 'pen') art.drawPen(ctx, d, t);
      else if (d.type === 'critter') art.drawCritter(ctx, d, t);
      else if (d.type === 'door') art.drawDoor(ctx, d);
    }
    // house windows and spooky string lights
    const stringColors = ['#ff8a1e', '#b56cff', '#7dff6a'];
    for (const h of this.map.houses) {
      if (!h.lit || !inView(h.x + h.w / 2, h.y + h.h / 2, h.w)) continue;
      const wallY = h.facing === 's' ? h.y + h.h - 7 : h.y;
      for (const wx of [h.x + 8, h.x + 20, h.x + h.w - 28, h.x + h.w - 16]) emitters.push([wx, wallY + 2, 6, 3, '#ffb84a', 0.45]);
      const ly = h.facing === 's' ? h.y + h.h - 8 : h.y + 7;
      for (let x = h.x + 2, i = 0; x < h.x + h.w - 2; x += 5, i++) {
        const on = Math.sin(t * 2 + i * 1.7 + h.x) > -0.3;
        if (on) emitters.push([x, ly + (i % 2), 1, 1, stringColors[(i + h.x) % 3], 0.9]);
      }
    }

    const view = this.view;
    if (view) {
      for (const d of view.drops) {
        if (!inView(d.x, d.y)) continue;
        const col = dropColor(d.type, t + d.id * 0.1);
        const rarity = rarityOf(DROP_TYPES[d.type]);
        if (rarity && !(d.life < 5 && Math.sin(t * 20) > 0)) {
          // guns sit on a glowing plate in their rarity colour
          ctx.globalAlpha = 0.45; ctx.fillStyle = col;
          ctx.beginPath(); ctx.ellipse(d.x, d.y + 3, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          if (rarity === 'cosmic' && Math.random() < 0.5) this.particles.push({ type: 'px', x: d.x + (Math.random() - 0.5) * 18, y: d.y + (Math.random() - 0.5) * 12, vx: 0, vy: -8, life: 0.5, max: 0.5, color: COSMIC[Math.floor(Math.random() * COSMIC.length)], glow: true });
          if (rarity === 'gold' || rarity === 'rainbow' || rarity === 'cosmic') emitters.push([d.x, d.y - 26, 1, 26, col, 0.5]); // light pillar for the good stuff
        }
        art.drawDrop(ctx, d.x, d.y, d.type, t, d.life);
        // pickups light up the ground around them so they read even in pitch black
        lights.push([d.x, d.y, rarity === 'cosmic' ? 60 : 46, col, 0.9]);
        emitters.push([d.x - 2, d.y - 2, 4, 4, col, 0.8]);
      }

      // the boss's flaming pumpkins arc through the air toward where they'll land
      for (const b of view.bombs) {
        const gx = b.sx + (b.tx - b.sx) * b.k, gy = b.sy + (b.ty - b.sy) * b.k;
        const h = Math.sin(b.k * Math.PI) * 46;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.ellipse(gx, gy + 2, 4 + (1 - h / 46) * 2, 2, 0, 0, Math.PI * 2); ctx.fill();
        art.drawPumpkin(ctx, gx, gy - h, 2, 1);
        emitters.push([gx - 2, gy - h - 2, 5, 4, '#ffb030', 1]);
        lights.push([gx, gy - h, 44, '#ff7a1e', 0.8]);
        if (Math.random() < 0.7) this.particles.push({ type: 'px', x: gx + (Math.random() - 0.5) * 4, y: gy - h - 3, vx: (Math.random() - 0.5) * 8, vy: -14, life: 0.35, max: 0.35, color: Math.random() < 0.5 ? '#ff5a1a' : '#ffd36a', glow: true });
      }

      // y-sorted actors
      const actors = [];
      for (const z of view.zombies) if (inView(z.x, z.y)) actors.push({ y: z.y, z });
      for (const p of view.players) {
        if (p.state === 2) continue;
        const pos = p.id === this.myId && this.me ? { ...p, x: this.me.x, y: this.me.y, a: this.me.a } : p;
        actors.push({ y: pos.y, p: pos });
      }
      actors.sort((a, b) => a.y - b.y);
      const order = [...(this.latest?.players.keys() ?? [])];
      for (const act of actors) {
        if (act.z) {
          const z = act.z;
          const hurt = (this.zHurt.get(z.id) ?? 0) > t;
          if (z.type === 3) {
            art.drawBoss(ctx, z.x, z.y, z.a, t, z.bs, hurt, z.enraged);
            const rage = z.enraged || (z.bs >= 1 && z.bs !== 5);
            emitters.push([z.x + Math.cos(z.a) * 4 - 6, z.y - 16 + Math.sin(z.a) * 2, 13, 4, rage ? '#ff3030' : '#c8ff5a', 1]);
            lights.push([z.x, z.y - 10, z.enraged ? 95 : 70, rage ? '#ff3030' : '#9a5aff', z.enraged ? 0.8 : 0.5]);
            if (z.bs === 3) this.particles.push({ type: 'ring', x: z.x, y: z.y, r: z.enraged ? 84 : 64, maxR: z.enraged ? 84 : 64, life: 0.02, max: 0.3, warn: true });
            if (z.bs === 5 && Math.random() < 0.6) { // summoning: green grave-light swirling up around him
              const a = Math.random() * Math.PI * 2;
              this.particles.push({ type: 'px', x: z.x + Math.cos(a) * 28, y: z.y + Math.sin(a) * 28, vx: 0, vy: -30, life: 0.6, max: 0.6, color: '#6aff9a', glow: true, size: 2 });
            }
            if (z.enraged && Math.random() < 0.3) { // enraged: drips burning embers
              this.particles.push({ type: 'px', x: z.x + (Math.random() - 0.5) * 24, y: z.y - 14 + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 10, vy: -25, life: 0.5, max: 0.5, color: Math.random() < 0.5 ? '#ff5a1a' : '#ffb03a', glow: true });
            }
          } else {
            art.drawZombie(ctx, z.x, z.y, z.a, z.type, z.id, t, hurt);
            // faint eyes are the only hint of zombies lurking in the dark
            // ("Disable zombie eyes" lobby option turns this off: then only your flashlight reveals them)
            if (!this.options.noEyes) for (const [ex, ey] of art.zombieEyes(z.x, z.y, z.a, z.type)) emitters.push([ex, ey, 1, 1, z.type === 2 ? '#ff4a2a' : '#b8ff4a', 0.55]);
          }
        } else {
          const p = act.p;
          // invincible: rainbow flashing like a star; invisible: see-through (fainter for teammates)
          const star = p.star > 0, ghost = p.ghost > 0;
          const color = star ? RAINBOW[Math.floor(t * 14) % RAINBOW.length] : p.color;
          if (ghost) ctx.globalAlpha = p.id === this.myId ? 0.45 : 0.25;
          art.drawPlayer(ctx, p.x, p.y, p.a, color, Math.max(0, order.indexOf(p.id)), p.state, t, this.moving.get(p.id), p.minigun > 0 ? W.minigun : p.weapon);
          ctx.globalAlpha = 1;
          if (p.state === 0) lights.push(['cone', p.x, p.y, p.a]);
          lights.push([p.x, p.y, star ? 60 : 40, star ? '#ffe45a' : p.color, star ? 0.8 : 0.35]);
          if (star) {
            emitters.push([p.x - 3, p.y - 6, 6, 7, color, 0.7]);
            if (Math.random() < 0.6) this.particles.push({ type: 'px', x: p.x + (Math.random() - 0.5) * 12, y: p.y - 3 + (Math.random() - 0.5) * 12, vx: 0, vy: -18, life: 0.4, max: 0.4, color: ['#fff', '#ffe45a', '#ff5ab4', '#5ad1ff'][Math.floor(Math.random() * 4)], glow: true });
            // a short warning blink as it runs out
            if (p.star < 2 && Math.sin(t * 30) > 0) emitters.push([p.x - 5, p.y - 8, 10, 11, '#ffffff', 0.5]);
          }
          if (ghost && Math.random() < 0.25) this.particles.push({ type: 'px', x: p.x + (Math.random() - 0.5) * 8, y: p.y + (Math.random() - 0.5) * 8, vx: 0, vy: -10, life: 0.5, max: 0.5, color: '#9ad8ff', glow: true });
        }
      }
    }

    // bullets
    for (const b of this.bullets) {
      const color = WEAPONS[WEAPON_KEYS[b.w]].color;
      if (b.w === W.frag) { // classic round black bomb with a sparking fuse
        const bx = Math.round(b.x), by = Math.round(b.y);
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(bx - 2, by + 2, 6, 2);
        ctx.fillStyle = '#16141a'; ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4a4852'; ctx.fillRect(bx - 2, by - 2, 2, 1);
        ctx.fillStyle = '#8a7a5a'; ctx.fillRect(bx + 1, by - 4, 1, 2);
        const spark = b.fuse < 0.35 ? '#ff3030' : Math.sin(t * 40) > 0 ? '#ffe45a' : '#ff8a2a';
        emitters.push([bx + 1, by - 5, 1, 1, spark, 1]);
        lights.push([b.x, b.y - 4, b.fuse < 0.35 ? 26 : 18, spark, 0.6]);
        if (Math.random() < 0.6) this.particles.push({ type: 'px', x: bx + 1, y: by - 5, vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 20, life: 0.2, max: 0.2, color: spark, glow: true });
        continue;
      }
      if (b.w === W.grenade) { // round shell with a blinking fuse light
        ctx.fillStyle = '#2a3a1a'; ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 3, 3);
        ctx.fillStyle = '#4a6a2a'; ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 1);
        const blink = Math.sin(t * (b.fuse < 0.3 ? 60 : 25)) > 0;
        if (blink) { emitters.push([b.x, b.y - 1, 1, 1, '#9aff5a', 1]); lights.push([b.x, b.y, 18, '#9aff5a', 0.5]); }
        continue;
      }
      if (b.w === W.rocket) { // rocket: dark body with a hot exhaust
        const a = Math.atan2(b.vy, b.vx), ca = Math.cos(a), sa = Math.sin(a);
        ctx.fillStyle = '#4a5a3a';
        for (let i = -2; i <= 2; i++) ctx.fillRect(Math.round(b.x + ca * i), Math.round(b.y + sa * i), 2, 2);
        ctx.fillStyle = '#c8c8d0'; ctx.fillRect(Math.round(b.x + ca * 3), Math.round(b.y + sa * 3), 1, 1);
        emitters.push([b.x - ca * 4, b.y - sa * 4, 2, 2, '#ffb03a', 1]);
        lights.push([b.x, b.y, 34, '#ff8a2a', 0.6]);
        continue;
      }
      const laser = b.w === W.laser;
      const len = laser ? 3 : 1.5;
      ctx.strokeStyle = color; ctx.lineWidth = laser ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(b.x - b.vx / 60 * len, b.y - b.vy / 60 * len); ctx.lineTo(b.x, b.y); ctx.stroke();
      emitters.push(['line', b.x - b.vx / 60 * len, b.y - b.vy / 60 * len, b.x, b.y, color, laser ? 2 : 1]);
      if (laser) lights.push([b.x, b.y, 24, '#ff3df2', 0.5]);
    }

    // particles
    for (const p of this.particles) {
      if (p.type === 'px') {
        ctx.globalAlpha = Math.min(1, p.life / 0.2);
        ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size || 1, p.size || 1);
        if (p.glow) emitters.push([p.x, p.y, 1, 1, p.color, 0.6]);
      } else if (p.type === 'gib') {
        ctx.globalAlpha = 1;
        gore.drawGib(ctx, p);
      } else if (p.type === 'mist') {
        gore.drawMist(ctx, p);
      } else if (p.type === 'flash') {
        lights.push([p.x, p.y, 50, p.color, 0.9]);
        emitters.push([p.x - 1, p.y - 1, 3, 3, '#fff6c0', 1]);
      } else if (p.type === 'boom') {
        const k = p.life / p.max;
        lights.push([p.x, p.y, 70 + 50 * k, '#ff8a2a', 0.7 + 0.3 * k]);
        emitters.push([p.x - 4, p.y - 4, 9, 9, '#ffe07a', k]);
      } else if (p.type === 'slash') {
        // katana sweep: a bright crescent that wipes across the arc
        const k = 1 - p.life / p.max;
        const from = p.a - p.arc / 2, sweep = p.arc * Math.min(1, k * 1.6);
        const a0 = p.flip ? from + p.arc - sweep : from, a1 = p.flip ? from + p.arc : from + sweep;
        ctx.globalAlpha = 1 - k * 0.7;
        ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y - 1, p.r - 3, a0, a1); ctx.stroke();
        ctx.strokeStyle = '#7ac8ff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y - 1, p.r - 6, a0, a1); ctx.stroke();
        const tip = p.flip ? a0 : a1;
        emitters.push([p.x + Math.cos(tip) * (p.r - 3) - 1, p.y - 1 + Math.sin(tip) * (p.r - 3) - 1, 2, 2, '#bfe8ff', 1 - k]);
        lights.push([p.x + Math.cos(p.a) * 12, p.y + Math.sin(p.a) * 12, 30, '#9ad8ff', 0.4 * (1 - k)]);
      }
    }
    ctx.globalAlpha = 1;
    for (const l of this.leaves) { ctx.fillStyle = l.c; ctx.fillRect(Math.round(l.x), Math.round(l.y), 2, 1); }
    ctx.restore();

    this.renderLighting(camX, camY, t, lights, inView);
    this.renderGlow(camX, camY, emitters);
    this.renderOverlays(camX, camY, t);
  }

  renderLighting(camX, camY, t, lights, inView) {
    const lc = this.lightCtx, { vw, vh } = this;
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, vw, vh);
    lc.fillStyle = 'rgba(3,1,10,0.975)';
    lc.fillRect(0, 0, vw, vh);
    lc.globalCompositeOperation = 'destination-out';
    const S = this.lightSprite;
    const cut = (x, y, r, a) => {
      lc.globalAlpha = Math.min(1, a);
      lc.drawImage(S, x - camX - r, y - camY - r, r * 2, r * 2);
    };
    const colored = [];
    for (const L of this.map.lights) {
      if (!inView(L.x, L.y, L.r)) continue;
      // flicker 1: gentle candle/fire wobble; flicker 2: dying fluorescent/neon that blacks out
      const fl = L.flicker === 2 ? (art.stutter(t, L.x * 0.13) ? 0.08 : 1)
        : L.flicker ? 0.85 + 0.15 * Math.sin(t * 11 + L.x) * Math.sin(t * 7.1 + L.y) : 1;
      cut(L.x, L.y, L.r * fl, L.intensity);
      colored.push([L.x, L.y, L.r * fl, L.color, L.intensity * 0.55]);
    }
    for (const L of lights) {
      if (L[0] === 'cone') {
        const [, x, y, a] = L;
        // the beam stops at walls (but shines through glass): clip it to a ray-cast polygon
        lc.save();
        lc.beginPath();
        lc.moveTo(x - camX, y - camY);
        for (const [hx, hy] of this.beamPolygon(x, y, a)) lc.lineTo(hx - camX, hy - camY);
        lc.closePath(); lc.clip();
        cut(x, y, 130, 0.95);
        lc.restore();
        cut(x, y, 26, 0.6); // just enough to see your own feet
        continue;
      }
      cut(L[0], L[1], L[2], L[4] + 0.3);
      colored.push([L[0], L[1], L[2], L[3], L[4] * 0.6]);
    }
    lc.globalAlpha = 1;
    this.ctx.drawImage(this.light, 0, 0);

    // warm colored pools on top of the darkness
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, r, color, a] of colored) {
      ctx.globalAlpha = a;
      ctx.drawImage(this.tint(color), x - camX - r, y - camY - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  renderGlow(camX, camY, emitters) {
    const gc = this.glowCtx, ctx = this.ctx;
    gc.clearRect(0, 0, this.vw, this.vh);
    const drawE = g => {
      for (const e of emitters) {
        if (e[0] === 'line') {
          g.globalAlpha = 1;
          g.strokeStyle = e[5]; g.lineWidth = e[6];
          g.beginPath(); g.moveTo(e[1] - camX, e[2] - camY); g.lineTo(e[3] - camX, e[4] - camY); g.stroke();
        } else {
          g.globalAlpha = e[5];
          g.fillStyle = e[4];
          g.fillRect(Math.round(e[0] - camX), Math.round(e[1] - camY), e[2], e[3]);
        }
      }
      g.globalAlpha = 1;
    };
    drawE(gc);
    // crisp emitters punch through the darkness, blurred copies are the bloom
    ctx.drawImage(this.glow, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(2px)';
    ctx.drawImage(this.glow, 0, 0);
    ctx.filter = 'blur(6px)';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.glow, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  renderOverlays(camX, camY, t) {
    const { ctx, vw, vh } = this;
    // drifting fog
    ctx.globalCompositeOperation = 'screen';
    const fogSprite = this.tint('#6a5a8a');
    for (const f of this.fog) {
      const x = f.x - camX, y = f.y - camY;
      if (x + f.r < 0 || y + f.r < 0 || x - f.r > vw || y - f.r > vh) continue;
      ctx.globalAlpha = 0.035;
      ctx.drawImage(fogSprite, x - f.r, y - f.r, f.r * 2, f.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // rings (boss slam + warning)
    for (const p of this.particles) {
      if (p.type !== 'ring') continue;
      ctx.strokeStyle = p.warn ? `rgba(255,48,48,${0.3 + 0.3 * Math.sin(t * 30)})` : `rgba(255,220,160,${p.life / p.max})`;
      ctx.lineWidth = p.warn ? 1 : 2;
      ctx.beginPath(); ctx.arc(p.x - camX, p.y - camY, p.r, 0, Math.PI * 2); ctx.stroke();
    }

    // player markers, hp bars, revive rings, off-screen arrows
    const view = this.view;
    if (view) {
      for (const p0 of view.players) {
        if (p0.state === 2) continue;
        const p = p0.id === this.myId && this.me ? { ...p0, x: this.me.x, y: this.me.y } : p0;
        const x = Math.round(p.x - camX), y = Math.round(p.y - camY);
        const onScreen = x > 4 && y > 4 && x < vw - 4 && y < vh - 4;
        if (onScreen) {
          if (p.id !== this.myId) {
            ctx.fillStyle = p.color; ctx.fillRect(x - 1, y - 18, 3, 1); ctx.fillRect(x, y - 17, 1, 1);
          }
          if (p.state === 0 && p.hp < PLAYER.maxHp) {
            ctx.fillStyle = '#200'; ctx.fillRect(x - 6, y + 6, 12, 2);
            ctx.fillStyle = p.hp > 50 ? '#7dff6a' : p.hp > 25 ? '#ffd34a' : '#ff4a4a';
            ctx.fillRect(x - 6, y + 6, Math.round(12 * p.hp / PLAYER.maxHp), 2);
          }
          if (p.state === 1) {
            ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y - 1, 11, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#7dff6a';
            ctx.beginPath(); ctx.arc(x, y - 1, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.revive); ctx.stroke();
            ctx.fillStyle = Math.sin(t * 8) > 0 ? '#ff4a4a' : '#ffffff';
            ctx.fillRect(x - 1, y - 20, 3, 5); ctx.fillRect(x - 1, y - 14, 3, 2);
          }
        } else if (p.id !== this.myId) {
          const cx = vw / 2, cy = vh / 2;
          const a = Math.atan2(y - cy, x - cx);
          const k = Math.min((vw / 2 - 8) / Math.abs(Math.cos(a) || 1e-6), (vh / 2 - 8) / Math.abs(Math.sin(a) || 1e-6));
          const ax = cx + Math.cos(a) * k, ay = cy + Math.sin(a) * k;
          ctx.fillStyle = p.state === 1 && Math.sin(t * 8) > 0 ? '#ff4a4a' : p.color;
          ctx.beginPath();
          ctx.moveTo(ax + Math.cos(a) * 4, ay + Math.sin(a) * 4);
          ctx.lineTo(ax + Math.cos(a + 2.5) * 4, ay + Math.sin(a + 2.5) * 4);
          ctx.lineTo(ax + Math.cos(a - 2.5) * 4, ay + Math.sin(a - 2.5) * 4);
          ctx.fill();
        }
      }
      // drop markers over the darkness: a pulsing ring and a bouncing arrow in the item's colour
      for (const d of view.drops) {
        const x = Math.round(d.x - camX), y = Math.round(d.y - camY);
        if (x < -10 || y < -20 || x > vw + 10 || y > vh + 10) continue;
        if (d.life < 5 && Math.sin(t * 20) > 0) continue; // blink with the item before it despawns
        const col = dropColor(d.type, t + d.id * 0.1);
        const pulse = (t * 1.4 + d.id * 0.37) % 1;
        ctx.globalAlpha = 0.9 * (1 - pulse);
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y + 1, 5 + pulse * 9, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        const ay = y - 13 + Math.round(Math.sin(t * 5 + d.id) * 2);
        ctx.fillStyle = '#000'; ctx.fillRect(x - 3, ay - 1, 7, 2); ctx.fillRect(x - 2, ay + 1, 5, 1); ctx.fillRect(x - 1, ay + 2, 3, 2);
        ctx.fillStyle = col; ctx.fillRect(x - 2, ay - 1, 5, 1); ctx.fillRect(x - 1, ay, 3, 1); ctx.fillRect(x, ay + 1, 1, 2);
      }

      // landing warnings for incoming pumpkin bombs, drawn over the darkness so you can dodge
      for (const b of view.bombs) {
        const a = 0.35 + 0.35 * Math.sin(t * 20) + b.k * 0.3;
        ctx.strokeStyle = `rgba(255,90,30,${a})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(b.tx - camX, b.ty - camY, 34 * (0.4 + 0.6 * b.k), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(255,60,20,${0.12 + 0.18 * b.k})`;
        ctx.beginPath(); ctx.arc(b.tx - camX, b.ty - camY, 34, 0, Math.PI * 2); ctx.fill();
      }
      const boss = view.zombies.find(z => z.type === 3);
      if (boss) this.drawBossLocator(boss, camX, camY, t);
    }

    // crosshair
    const mx = Math.round(this.mouse.x / this.scale), my = Math.round(this.mouse.y / this.scale);
    ctx.fillStyle = '#ffcf7a';
    ctx.fillRect(mx - 4, my, 3, 1); ctx.fillRect(mx + 2, my, 3, 1);
    ctx.fillRect(mx, my - 4, 1, 3); ctx.fillRect(mx, my + 2, 1, 3);

    ctx.drawImage(this.vignette, 0, 0);
    for (const s of this.screenSplats) gore.drawScreenSplat(ctx, s);
    if (this.hurtFlash > 0) {
      ctx.fillStyle = `rgba(160,0,0,${this.hurtFlash * 0.5})`;
      ctx.fillRect(0, 0, vw, vh);
    }
    if (this.nukeFlash > 0) { // white-out, fading through radioactive green
      ctx.fillStyle = this.nukeFlash > 0.6 ? `rgba(255,255,240,${(this.nukeFlash - 0.6) * 2.5})` : `rgba(120,255,110,${this.nukeFlash * 0.35})`;
      ctx.fillRect(0, 0, vw, vh);
    }
    if (this.downFlash > 0) { // pulsing red frame when a teammate goes down
      ctx.strokeStyle = `rgba(255,40,40,${this.downFlash * (0.5 + 0.5 * Math.sin(t * 18))})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, vw - 4, vh - 4);
    }
    const st = this.myState();
    if (st && st.state !== 0) {
      ctx.fillStyle = 'rgba(60,0,0,0.25)'; ctx.fillRect(0, 0, vw, vh);
    }
  }

  // Ray-cast the flashlight cone: one ray every ~1.5 degrees, each stopping just inside the
  // first wall it hits so the wall face itself is lit.
  beamPolygon(x, y, a, reach = 120, half = 0.5, rays = 40) {
    const pts = [];
    for (let i = 0; i <= rays; i++) {
      const ra = a - half + (2 * half * i) / rays;
      const dx = Math.cos(ra), dy = Math.sin(ra);
      let d = 3;
      while (d < reach && !blocksLight(this.map, x + dx * d, y + dy * d)) d += 3;
      d = Math.min(reach, d + 3);
      pts.push([x + dx * d, y + dy * d]);
    }
    return pts;
  }

  // Boss locator: a bobbing marker over the boss on screen, or a pumpkin icon + arrow pinned
  // to the screen edge pointing at it, with the distance shown as pips (one per 10m).
  drawBossLocator(boss, camX, camY, t) {
    const { ctx, vw, vh } = this;
    const x = boss.x - camX, y = boss.y - camY;
    const rage = boss.enraged || boss.bs >= 1;
    const col = rage ? '#ff3030' : '#c86aff';
    const margin = 20; // room for the arrow beyond the icon
    if (x > 0 && y > 0 && x < vw && y < vh) {
      const by = Math.round(y - 38 + Math.sin(t * 6) * 2);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x - 5, by); ctx.lineTo(x + 5, by); ctx.lineTo(x, by + 6); ctx.fill();
      return;
    }
    const cx = vw / 2, cy = vh / 2;
    const a = Math.atan2(y - cy, x - cx);
    const dx = Math.cos(a), dy = Math.sin(a);
    // pin to an inset box; the bottom inset keeps it clear of the weapon/HP and chat HUD
    const left = margin, right = vw - margin, top = margin, bottom = vh - 44;
    let k = Infinity;
    if (dx > 0) k = Math.min(k, (right - cx) / dx); else if (dx < 0) k = Math.min(k, (left - cx) / dx);
    if (dy > 0) k = Math.min(k, (bottom - cy) / dy); else if (dy < 0) k = Math.min(k, (top - cy) / dy);
    const ix = Math.round(cx + dx * k), iy = Math.round(cy + dy * k);
    const pulse = 0.6 + 0.4 * Math.sin(t * 8);
    // glow disc
    ctx.globalAlpha = 0.35 * pulse;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(ix, iy, 10, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // pumpkin head icon
    ctx.fillStyle = '#a83a0a'; ctx.fillRect(ix - 5, iy - 4, 11, 8); ctx.fillRect(ix - 4, iy - 5, 9, 10);
    ctx.fillStyle = '#d0561a'; ctx.fillRect(ix - 1, iy - 5, 2, 10);
    ctx.fillStyle = '#2a4a10'; ctx.fillRect(ix, iy - 7, 2, 2);
    ctx.fillStyle = rage ? '#ff3030' : '#c8ff5a';
    ctx.fillRect(ix - 3, iy - 2, 2, 2); ctx.fillRect(ix + 2, iy - 2, 2, 2); ctx.fillRect(ix - 3, iy + 2, 7, 1);
    // arrow pointing out toward the boss
    const ax = ix + Math.cos(a) * 11, ay = iy + Math.sin(a) * 11;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(a) * 5, ay + Math.sin(a) * 5);
    ctx.lineTo(ax + Math.cos(a + 2.4) * 4, ay + Math.sin(a + 2.4) * 4);
    ctx.lineTo(ax + Math.cos(a - 2.4) * 4, ay + Math.sin(a - 2.4) * 4);
    ctx.fill();
    // distance pips toward the screen centre (1 per 10m, max 6)
    const meters = Math.hypot(x - cx, y - cy) / 16;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < Math.min(6, Math.ceil(meters / 10)); i++) {
      ctx.fillRect(Math.round(ix - Math.cos(a) * (14 + i * 4)), Math.round(iy - Math.sin(a) * (14 + i * 4)), 2, 2);
    }
  }
}

// White wherever you can walk, transparent on walls/houses/trees: used to wipe blood off them.
function makeFloorMask(map, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (!isSolidTile(map, tx, ty)) g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
  }
  return c;
}

function makeLightSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return c;
}

function makeVignette(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(10,0,20,0.75)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  return c;
}
