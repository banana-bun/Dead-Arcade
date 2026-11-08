// Authoritative game simulation for one room: rounds, zombies, boss, bullets, drops.
import {
  TILE, PLAYER, WEAPONS, ZOMBIES, dropChance, HEALTH_DROP_WEIGHT, GUN_DROPS, gunDropWeight, DROP_LIFETIME, HEALTH_PACK,
  maxAliveZombies, INTERMISSION, FIRST_ROUND_DELAY, BOSS, OPENING_WAVE, DRINK_CHANCE, WEAPON_LIST, DROP_TYPES,
  POWERUPS, POWERUP_CHANCE, FRIENDLY_FIRE, FRAGS, zombieCountForRound, isBossRound, bossHpForRound,
} from '../shared/config.js';
import { generateMap, moveCircle, isSolidAt, isSolidTile, stepProjectile } from '../shared/map.js';

const WEAPON_CODE = Object.fromEntries(WEAPON_LIST.map((w, i) => [w, i]));
const ZTYPE_CODE = { walker: 0, runner: 1, brute: 2, boss: 3 };
const DROP_CODE = Object.fromEntries(DROP_TYPES.map((d, i) => [d, i]));
const STATE_CODE = { alive: 0, down: 1, dead: 2 };
const BOSS_STATE = { walk: 0, windup: 1, charge: 2, slamWindup: 3, throwWindup: 4, summonWindup: 5 };
const WALL_RADIUS_CAP = 6; // big bodies still squeeze through 1-tile gaps

export class Game {
  constructor({ onSnapshot, onGameOver, tickRate, snapshotRate, mapId = 'suburb', options = {} }) {
    this.onSnapshot = onSnapshot;
    this.onGameOver = onGameOver;
    this.options = options; // lobby toggles: { noEyes, friendlyFire }
    this.dt = 1 / tickRate;
    this.snapEvery = Math.max(1, Math.round(tickRate / snapshotRate));
    this.mapId = mapId;
    this.map = generateMap(mapId);
    this.players = new Map();
    this.zombies = [];
    this.bullets = [];
    this.bombs = [];
    this.drops = [];
    this.events = [];
    this.nextId = 1;
    this.round = 0;
    this.phase = 'intermission';
    this.timer = FIRST_ROUND_DELAY;
    this.toSpawn = 0;
    this.spawnCd = 0;
    this.tickCount = 0;
    this.flow = new Int16Array(this.map.w * this.map.h);
    this.flowCd = 0;
    this.over = false;
    this.unlockedTiers = new Set([0]); // weapon tiers bosses have introduced into the drop pool
  }

  start() {
    this.lastTime = Date.now();
    this.interval = setInterval(() => this.tick(), this.dt * 1000);
  }

  stop() {
    clearInterval(this.interval);
  }

  addPlayer(c) {
    const s = this.map.playerSpawn;
    const n = this.players.size;
    const p = {
      id: c.id, name: c.name, color: c.color,
      x: s.x + (n % 3 - 1) * 14, y: s.y + (Math.floor(n / 3) - 0.5) * 14, a: 0,
      hp: PLAYER.maxHp, state: this.round > 0 && this.phase === 'fighting' ? 'dead' : 'alive',
      weapon: 'handgun', ammo: Infinity, lastShot: 0,
      score: 0, kills: 0, downs: 0, revives: 0,
      revive: 0, bleed: 0, tp: 1, hurtCd: 0, lastInput: Date.now(),
      star: 0, ghost: 0, minigun: 0, // powerup seconds left
      frags: 0, lastThrow: 0, // hand grenades carried (max FRAGS.max)
    };
    this.players.set(c.id, p);
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.players.size === 0) this.stop();
  }

  handleInput(id, m) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    if (Number.isFinite(m.a)) p.a = m.a;
    const now = Date.now();
    const elapsed = Math.min(0.25, (now - p.lastInput) / 1000);
    p.lastInput = now;
    if (p.state !== 'alive') return;
    let dx = m.x - p.x, dy = m.y - p.y;
    const dist = Math.hypot(dx, dy);
    // Stamina is tracked client-side; the server just allows sprint speed.
    const maxStep = PLAYER.speed * PLAYER.sprintMul * elapsed * 1.5 + 6;
    if (dist > maxStep) { dx *= maxStep / dist; dy *= maxStep / dist; }
    const pos = moveCircle(this.map, p.x, p.y, dx, dy, PLAYER.radius);
    p.x = pos.x; p.y = pos.y;
  }

  handleShoot(id, m) {
    const p = this.players.get(id);
    if (!p || p.state !== 'alive' || !Array.isArray(m.a)) return;
    const gun = p.minigun > 0 ? 'minigun' : p.weapon; // the Minigun powerup overrides whatever you're holding
    const w = WEAPONS[gun];
    const now = Date.now();
    if (now - p.lastShot < w.fireRate * 1000 * 0.75) return;
    p.lastShot = now;
    const angles = m.a.slice(0, w.pellets).filter(Number.isFinite);
    if (!angles.length) return;
    if (w.melee) this.swing(p, angles[0], w);
    else angles.forEach((a, i) => {
      // Start at the player's center so zombies hugging you can still be hit point-blank.
      const off = w.offsets ? w.offsets[i] || 0 : 0;
      this.bullets.push({
        owner: id, x: p.x - Math.sin(a) * off, y: p.y + Math.cos(a) * off,
        vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
        dist: 0, range: w.range, damage: w.damage, pierce: w.pierce, hit: new Set(),
        explode: w.explode, fuse: w.fuse, bounce: w.bounce,
      });
    });
    this.events.push({ e: 'shot', p: id, x: Math.round(p.x), y: Math.round(p.y), a: angles.map(v => +v.toFixed(3)), w: WEAPON_CODE[gun] });
    if (gun === p.weapon && w.ammo !== Infinity) {
      p.ammo--;
      if (p.ammo <= 0) { p.weapon = 'handgun'; p.ammo = Infinity; }
    }
  }

  // Q: lob a grenade toward the cursor. `d` is how far away the player aimed, so it lands about there.
  handleThrow(id, m) {
    const p = this.players.get(id);
    if (!p || p.state !== 'alive' || p.frags <= 0 || !Number.isFinite(m.a)) return;
    const w = WEAPONS.frag;
    const now = Date.now();
    if (now - p.lastThrow < w.fireRate * 1000 * 0.75) return;
    p.lastThrow = now;
    p.frags--;
    const dist = Number.isFinite(m.d) ? m.d : 120;
    const speed = Math.max(FRAGS.minSpeed, Math.min(FRAGS.maxSpeed, dist * FRAGS.throwScale));
    this.bullets.push({
      owner: id, x: p.x, y: p.y, vx: Math.cos(m.a) * speed, vy: Math.sin(m.a) * speed,
      dist: 0, range: w.range, damage: 0, pierce: 0, hit: new Set(), explode: w.explode, fuse: w.fuse, bounce: true,
    });
    this.events.push({ e: 'throw', p: id, x: Math.round(p.x), y: Math.round(p.y), a: +m.a.toFixed(3), s: Math.round(speed) });
  }

  // Katana: hits every zombie within reach inside the arc in front of the player.
  swing(p, a, w) {
    const { reach, arc } = w.melee;
    for (const z of this.zombies) {
      if (z.hp <= 0) continue;
      const dx = z.x - p.x, dy = z.y - p.y;
      const r = reach + ZOMBIES[z.type].radius;
      if (dx * dx + dy * dy > r * r) continue;
      let diff = Math.atan2(dy, dx) - a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > arc / 2 && dx * dx + dy * dy > 64) continue; // anything touching you always gets hit
      z.hp -= w.damage;
      z.lastHitA = Math.atan2(dy, dx);
      this.events.push({ e: 'hit', x: Math.round(z.x), y: Math.round(z.y), z: z.id, a: +z.lastHitA.toFixed(2) });
      if (z.hp <= 0) this.killZombie(z, p.id);
    }
    this.zombies = this.zombies.filter(z => z.hp > 0);
    if (this.options.friendlyFire) {
      for (const o of this.alivePlayers()) {
        if (o === p) continue;
        const dx = o.x - p.x, dy = o.y - p.y;
        if (dx * dx + dy * dy > (reach + PLAYER.radius) ** 2) continue;
        let diff = Math.atan2(dy, dx) - a;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) <= arc / 2) this.damagePlayer(o, w.damage * FRIENDLY_FIRE.bulletMul, true);
      }
    }
  }

  tick() {
    if (this.over) return;
    const dt = this.dt;
    this.tickCount++;

    if (this.phase === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) this.startRound();
    } else {
      this.updateSpawning(dt);
    }

    this.flowCd -= dt;
    if (this.flowCd <= 0) { this.computeFlow(); this.flowCd = 0.25; }

    this.updateBullets(dt);
    this.updateBombs(dt);
    this.updateZombies(dt);
    this.updatePlayers(dt);
    this.updateDrops(dt);

    if (this.phase === 'fighting' && this.toSpawn === 0 && this.zombies.length === 0) {
      this.phase = 'intermission';
      this.timer = INTERMISSION;
      this.events.push({ e: 'clear', n: this.round, drink: Math.random() < DRINK_CHANCE });
      for (const p of this.players.values()) if (p.state === 'alive') p.hp = Math.min(PLAYER.maxHp, p.hp + 25);
    }

    const ps = [...this.players.values()];
    if (ps.length && this.round > 0 && ps.every(p => p.state !== 'alive')) {
      this.over = true;
      this.stop();
      this.snapshot();
      this.onGameOver({
        round: this.round,
        stats: ps.map(p => ({ name: p.name, color: p.color, score: p.score, kills: p.kills, downs: p.downs, revives: p.revives }))
          .sort((a, b) => b.score - a.score),
      });
      return;
    }

    if (this.tickCount % this.snapEvery === 0) this.snapshot();
  }

  startRound() {
    this.round++;
    this.phase = 'fighting';
    const boss = isBossRound(this.round);
    const total = boss ? 0 : zombieCountForRound(this.round, this.players.size);
    this.toSpawn = total;
    this.spawnCd = 0.4;
    // Everyone who was out comes back for the new round.
    const anchor = [...this.players.values()].find(p => p.state === 'alive') || this.map.playerSpawn;
    for (const p of this.players.values()) {
      if (p.state !== 'alive') {
        p.state = 'alive'; p.hp = PLAYER.maxHp; p.revive = 0; p.bleed = 0;
        p.x = anchor.x; p.y = anchor.y; p.tp++;
      }
    }
    if (boss) {
      const sp = this.farthestSpawn();
      const hp = bossHpForRound(this.round, this.players.size);
      this.zombies.push({
        id: this.nextId++, type: 'boss', x: sp.x, y: sp.y, hp, maxHp: hp, attackCd: 0,
        bs: 'walk', bsTimer: 3, dirX: 0, dirY: 0,
      });
    }
    // opening wave: a chunk of the round rises right away so it starts with a crowd
    this.spawnMany(Math.min(total, Math.ceil(maxAliveZombies(this.players.size) * OPENING_WAVE)));
    this.events.push({ e: 'round', n: this.round, boss });
  }

  alivePlayers() {
    return [...this.players.values()].filter(p => p.state === 'alive');
  }

  farthestSpawn() {
    const alive = this.alivePlayers();
    let best = this.map.spawns[0], bestD = -1;
    for (const s of this.map.spawns) {
      if (s.grave) continue;
      const d = Math.min(...alive.map(p => Math.hypot(p.x - s.x, p.y - s.y)), 1e9);
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  updateSpawning(dt) {
    if (this.toSpawn <= 0) return;
    this.spawnCd -= dt;
    if (this.spawnCd > 0 || this.zombies.length >= maxAliveZombies(this.players.size)) return;
    this.spawnCd = Math.max(0.2, 0.8 - this.round * 0.05);
    this.spawnMany(1 + Math.floor(Math.random() * (2 + this.round / 3)));
  }

  spawnMany(n) {
    const alive = this.alivePlayers();
    const far = this.map.spawns.filter(s => alive.every(p => Math.hypot(p.x - s.x, p.y - s.y) > 170));
    const pool = far.length ? far : this.map.spawns;
    const burst = Math.min(this.toSpawn, n, maxAliveZombies(this.players.size) - this.zombies.length);
    for (let i = 0; i < burst; i++) {
      const s = pool[Math.floor(Math.random() * pool.length)];
      const ox = (Math.random() - 0.5) * 10, oy = (Math.random() - 0.5) * 10;
      const pos = moveCircle(this.map, s.x, s.y, ox, oy, 5);
      this.spawnZombie(pos.x, pos.y, s.grave);
      this.toSpawn--;
    }
  }

  spawnZombie(x, y, fromGrave) {
    const r = Math.random();
    let type = 'walker';
    if (this.round >= 6 && r < 0.1) type = 'brute';
    else if (this.round >= 3 && r < 0.32) type = 'runner';
    const def = ZOMBIES[type];
    const hp = def.hp + Math.floor((this.round - 1) / 4);
    this.zombies.push({
      id: this.nextId++, type, x, y, hp, maxHp: hp, attackCd: 0,
      wobble: Math.random() * Math.PI * 2, speedMul: 0.85 + Math.random() * 0.3,
    });
    if (fromGrave) this.events.push({ e: 'rise', x: Math.round(x), y: Math.round(y) });
  }

  computeFlow() {
    const { w, h } = this.map;
    const flow = this.flow;
    flow.fill(-1);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (const p of this.visiblePlayers()) {
      const i = Math.floor(p.y / TILE) * w + Math.floor(p.x / TILE);
      if (flow[i] === -1) { flow[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i / w) | 0;
      const d = flow[i] + 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (isSolidTile(this.map, nx, ny)) continue;
        if (dx && dy && (isSolidTile(this.map, x + dx, y) || isSolidTile(this.map, x, y + dy))) continue;
        const ni = ny * w + nx;
        if (flow[ni] !== -1) continue;
        flow[ni] = d;
        queue[tail++] = ni;
      }
    }
  }

  // Direction a zombie at (x, y) should walk, following the flow field.
  flowDir(x, y) {
    const { w } = this.map;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const here = this.flow[ty * w + tx];
    let best = here, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tx + dx, ny = ty + dy;
      if (isSolidTile(this.map, nx, ny)) continue;
      if (dx && dy && (isSolidTile(this.map, tx + dx, ty) || isSolidTile(this.map, tx, ty + dy))) continue;
      const v = this.flow[ny * w + nx];
      if (v >= 0 && (best < 0 || v < best)) { best = v; bx = dx; by = dy; }
    }
    if (!bx && !by) return null;
    const cx = (tx + bx) * TILE + TILE / 2, cy = (ty + by) * TILE + TILE / 2;
    const len = Math.hypot(cx - x, cy - y) || 1;
    return { x: (cx - x) / len, y: (cy - y) / len };
  }

  // Players zombies can see: alive and not invisible.
  visiblePlayers() {
    return this.alivePlayers().filter(p => p.ghost <= 0);
  }

  nearestAlive(x, y, includeGhosts = false) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (p.state !== 'alive' || (!includeGhosts && p.ghost > 0)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { p: best, d: bd } : null;
  }

  updateZombies(dt) {
    const zs = this.zombies;
    for (const z of zs) {
      const def = ZOMBIES[z.type];
      z.attackCd -= dt;
      if (z.starCd) z.starCd -= dt;
      const target = this.nearestAlive(z.x, z.y); // invisible players aren't targeted
      let mx = 0, my = 0, speed = def.speed * (z.speedMul || 1);

      if (target) {
        if (target.d < 40) {
          mx = (target.p.x - z.x) / target.d; my = (target.p.y - z.y) / target.d;
        } else {
          const f = this.flowDir(z.x, z.y);
          if (f) { mx = f.x; my = f.y; }
        }
      }

      if (z.type === 'boss') ({ mx, my, speed } = this.bossBrain(z, target, mx, my, speed, dt));
      else {
        z.wobble += dt * 3;
        mx += Math.cos(z.wobble) * 0.15; my += Math.sin(z.wobble * 1.3) * 0.15;
      }

      const r = Math.min(def.radius, WALL_RADIUS_CAP);
      const pos = moveCircle(this.map, z.x, z.y, mx * speed * dt, my * speed * dt, r);
      z.x = pos.x; z.y = pos.y;

      // Contact: whoever this zombie is touching (even an invisible player who bumps into it).
      const touch = this.nearestAlive(z.x, z.y, true);
      if (touch) {
        const dx = z.x - touch.p.x, dy = z.y - touch.p.y;
        const d = Math.hypot(dx, dy), min = def.radius + PLAYER.radius - 1;
        // stop at the player's edge instead of standing inside them
        if (d < min && z.bs !== 'charge') {
          const nx = d ? dx / d : 1, ny = d ? dy / d : 0;
          const out = moveCircle(this.map, z.x, z.y, nx * (min - d), ny * (min - d), Math.min(r, 4));
          z.x = out.x; z.y = out.y;
        }
        if (d < def.radius + PLAYER.radius + 2) {
          if (touch.p.star > 0) this.starHit(z, touch.p, dx, dy);
          else if (z.attackCd <= 0) { this.damagePlayer(touch.p, def.damage); z.attackCd = 0.8; }
        }
      }
    }
    if (zs.some(z => z.hp <= 0)) this.zombies = this.zombies.filter(z => z.hp > 0);

    // keep the horde from stacking into one blob
    for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) {
      const a = zs[i], b = zs[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const min = ZOMBIES[a.type].radius + ZOMBIES[b.type].radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2), push = (min - d) / 2;
      const nx = dx / d, ny = dy / d;
      const wa = a.type === 'boss' ? 0.05 : 1, wb = b.type === 'boss' ? 0.05 : 1;
      const pa = moveCircle(this.map, a.x, a.y, -nx * push * wa, -ny * push * wa, 4);
      const pb = moveCircle(this.map, b.x, b.y, nx * push * wb, ny * push * wb, 4);
      a.x = pa.x; a.y = pa.y; b.x = pb.x; b.y = pb.y;
    }
  }

  // Invincible player touched a zombie: it dies on the spot (the boss just takes a chunk of damage).
  starHit(z, p, dx, dy) {
    if (z.hp <= 0) return;
    if (z.type === 'boss') {
      if ((z.starCd ?? 0) > 0) return;
      z.starCd = 0.4;
      z.hp -= 3;
    } else z.hp = 0;
    z.lastHitA = Math.atan2(dy, dx);
    this.events.push({ e: 'hit', x: Math.round(z.x), y: Math.round(z.y), z: z.id, a: +z.lastHitA.toFixed(2) });
    if (z.hp <= 0) this.killZombie(z, p.id);
  }

  // The Gourd King: charges, ground slams, lobs flaming pumpkins, raises minions,
  // and enrages below half HP (faster, shorter cooldowns, bigger attacks).
  bossBrain(z, target, mx, my, speed, dt) {
    const advanced = this.round >= BOSS.advancedFrom; // the round 5 boss only charges and slams
    if (advanced && !z.enraged && z.hp <= z.maxHp * BOSS.enrageAt) {
      z.enraged = true;
      this.events.push({ e: 'enrage', x: Math.round(z.x), y: Math.round(z.y) });
    }
    const haste = z.enraged ? 1.6 : 1;
    z.bsTimer -= dt * haste;
    z.summonCd = (z.summonCd ?? 4) - dt;
    const rest = () => { z.bs = 'walk'; z.bsTimer = advanced ? 1.4 + Math.random() * 1.2 : 2.5 + Math.random() * 1.5; };
    const still = { mx: 0, my: 0, speed: 0 };

    if (z.bs === 'walk') {
      if (z.bsTimer <= 0 && target) {
        const minions = this.zombies.filter(m => m.minion).length;
        const cap = BOSS.minions.cap + BOSS.minions.capPerPlayer * (this.players.size - 1);
        const options = [];
        if (target.d < 70) options.push('slam', 'slam');
        if (target.d < 240) options.push('charge');
        if (advanced && target.d < 320) options.push('throw', 'throw');
        if (advanced && z.summonCd <= 0 && minions < cap) options.push('summon');
        const pick = options.length ? options[Math.floor(Math.random() * options.length)] : null;
        if (pick === 'slam') { z.bs = 'slamWindup'; z.bsTimer = 0.8; }
        else if (pick === 'charge') {
          z.bs = 'windup'; z.bsTimer = 0.6;
          z.dirX = (target.p.x - z.x) / target.d; z.dirY = (target.p.y - z.y) / target.d;
        } else if (pick === 'throw') { z.bs = 'throwWindup'; z.bsTimer = 0.6; z.throwAt = { x: target.p.x, y: target.p.y }; }
        else if (pick === 'summon') { z.bs = 'summonWindup'; z.bsTimer = 1.0; }
        else z.bsTimer = 0.4;
      }
      return { mx, my, speed: speed * (z.enraged ? 1.4 : 1) };
    }
    if (z.bs === 'windup') {
      if (z.bsTimer <= 0) { z.bs = 'charge'; z.bsTimer = 0.9; }
      return still;
    }
    if (z.bs === 'charge') {
      if (z.bsTimer <= 0) rest();
      for (const p of this.alivePlayers()) {
        if (Math.hypot(p.x - z.x, p.y - z.y) < 20 && p.hurtCd <= 0) this.damagePlayer(p, 25);
      }
      return { mx: z.dirX, my: z.dirY, speed: z.enraged ? 215 : 170 };
    }
    if (z.bs === 'slamWindup') {
      if (z.bsTimer <= 0) {
        const R = z.enraged ? 84 : 64;
        this.events.push({ e: 'slam', x: Math.round(z.x), y: Math.round(z.y), r: R });
        for (const p of this.alivePlayers()) {
          if (Math.hypot(p.x - z.x, p.y - z.y) < R) this.damagePlayer(p, 30, true);
        }
        rest();
      }
      return still;
    }
    if (z.bs === 'throwWindup') {
      if (z.bsTimer <= 0) {
        // aim where the player is heading, then fan the rest around them
        const t = target?.p ?? z.throwAt;
        const n = z.enraged ? BOSS.bomb.enragedCount : BOSS.bomb.count;
        for (let i = 0; i < n; i++) {
          const spread = i === 0 ? 0 : 26 + Math.random() * 30;
          const a = Math.random() * Math.PI * 2;
          this.bombs.push({
            id: this.nextId++, sx: z.x, sy: z.y - 14,
            tx: t.x + Math.cos(a) * spread, ty: t.y + Math.sin(a) * spread,
            t: 0, flight: BOSS.bomb.flight * (0.85 + Math.random() * 0.3),
          });
        }
        rest();
      }
      return still;
    }
    if (z.bs === 'summonWindup') {
      if (z.bsTimer <= 0) {
        const n = BOSS.minions.base + BOSS.minions.perPlayer * (this.players.size - 1);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const pos = moveCircle(this.map, z.x, z.y, Math.cos(a) * 28, Math.sin(a) * 28, 5);
          this.spawnZombie(pos.x, pos.y, true);
          this.zombies[this.zombies.length - 1].minion = true;
        }
        z.summonCd = BOSS.minions.cooldown;
        rest();
      }
      return still;
    }
    return { mx, my, speed };
  }

  // Flaming pumpkins in flight; they burst where they land.
  updateBombs(dt) {
    this.bombs = this.bombs.filter(b => {
      b.t += dt;
      if (b.t < b.flight) return true;
      const { radius, damage } = BOSS.bomb;
      this.events.push({ e: 'boom', x: Math.round(b.tx), y: Math.round(b.ty), r: radius, k: 1 });
      for (const p of this.alivePlayers()) {
        if (Math.hypot(p.x - b.tx, p.y - b.ty) < radius + PLAYER.radius) this.damagePlayer(p, damage, true);
      }
      return false;
    });
  }

  damagePlayer(p, amount, ignoreCd = false) {
    if (p.state !== 'alive' || p.star > 0) return;
    if (!ignoreCd && p.hurtCd > 0) return;
    p.hp -= amount;
    p.hurtCd = 0.35;
    p.sinceHurt = 0;
    this.events.push({ e: 'hurt', p: p.id });
    if (p.hp <= 0) {
      p.hp = 0;
      p.state = 'down';
      p.bleed = PLAYER.bleedOutTime;
      p.revive = 0;
      p.downs++;
      this.events.push({ e: 'down', p: p.id });
    }
  }

  updateBullets(dt) {
    const out = [];
    for (const b of this.bullets) {
      const steps = 3;
      let dead = false;
      if (b.bounce) { const k = Math.max(0, 1 - 1.6 * dt); b.vx *= k; b.vy *= k; } // grenades roll to a stop
      for (let s = 0; s < steps && !dead; s++) {
        stepProjectile(this.map, b, dt / steps);
        if (b.fuse !== undefined && (b.fuse -= dt / steps) <= 0) { this.explode(b); dead = true; break; }
        if (b.dist > b.range || (!b.bounce && isSolidAt(this.map, b.x, b.y))) {
          if (b.explode) this.explode(b);
          dead = true; break;
        }
        for (const z of this.zombies) {
          if (z.hp <= 0 || b.hit.has(z.id)) continue;
          const r = ZOMBIES[z.type].radius + 2;
          if ((z.x - b.x) ** 2 + (z.y - b.y) ** 2 > r * r) continue;
          if (b.explode) { this.explode(b); dead = true; break; }
          b.hit.add(z.id);
          z.hp -= b.damage;
          z.lastHitA = Math.atan2(b.vy, b.vx);
          this.events.push({ e: 'hit', x: Math.round(b.x), y: Math.round(b.y), z: z.id, a: +z.lastHitA.toFixed(2) });
          if (z.hp <= 0) this.killZombie(z, b.owner);
          if (b.pierce-- <= 0) { dead = true; break; }
        }
        if (!dead && this.options.friendlyFire) {
          // teammates (never the shooter) are in the line of fire too
          for (const o of this.alivePlayers()) {
            if (o.id === b.owner || (o.x - b.x) ** 2 + (o.y - b.y) ** 2 > (PLAYER.radius + 1) ** 2) continue;
            if (b.explode) this.explode(b);
            else this.damagePlayer(o, b.damage * FRIENDLY_FIRE.bulletMul, true);
            dead = true; break;
          }
        }
      }
      if (!dead) out.push(b);
    }
    this.bullets = out;
    this.zombies = this.zombies.filter(z => z.hp > 0);
  }

  // Rocket splash: damages every zombie in the blast radius.
  explode(b) {
    const { radius, damage } = b.explode;
    this.events.push({ e: 'boom', x: Math.round(b.x), y: Math.round(b.y), r: radius });
    for (const z of this.zombies) {
      if (z.hp <= 0) continue;
      const reach = radius + ZOMBIES[z.type].radius;
      if ((z.x - b.x) ** 2 + (z.y - b.y) ** 2 > reach * reach) continue;
      z.hp -= damage;
      z.lastHitA = Math.atan2(z.y - b.y, z.x - b.x);
      z.blasted = true; // explosions blow zombies apart
      this.events.push({ e: 'hit', x: Math.round(z.x), y: Math.round(z.y), z: z.id, a: +z.lastHitA.toFixed(2) });
      if (z.hp <= 0) this.killZombie(z, b.owner);
    }
    if (this.options.friendlyFire) {
      // splash hurts teammates caught in it, but not the person who fired it
      for (const o of this.alivePlayers()) {
        if (o.id !== b.owner && Math.hypot(o.x - b.x, o.y - b.y) < radius + PLAYER.radius) this.damagePlayer(o, damage * FRIENDLY_FIRE.blastMul, true);
      }
    }
  }

  killZombie(z, ownerId) {
    const p = this.players.get(ownerId);
    const boss = z.type === 'boss';
    if (p) { p.kills++; p.score += boss ? 500 : z.type === 'brute' ? 30 : 10; }
    this.events.push({
      e: 'kill', x: Math.round(z.x), y: Math.round(z.y), z: ZTYPE_CODE[z.type], p: ownerId,
      id: z.id, a: +(z.lastHitA ?? 0).toFixed(2), blast: z.blasted ? 1 : 0,
    });
    if (boss) {
      // The boss introduces its round's weapon tier and drops one of those guns at random.
      // Bosses past the last tier drop any gun that's already unlocked.
      this.unlockedTiers.add(this.round);
      const fresh = WEAPON_LIST.filter(w => WEAPONS[w].tier === this.round);
      const pool = fresh.length ? fresh : WEAPON_LIST.filter(w => w !== 'handgun' && WEAPONS[w].tier >= 0 && this.unlockedTiers.has(WEAPONS[w].tier));
      this.spawnDrop(pool[Math.floor(Math.random() * pool.length)], z.x - 10, z.y);
      this.spawnDrop('health', z.x + 10, z.y);
    } else if (Math.random() < dropChance(this.round)) {
      // most zombie loot is a hand grenade; otherwise health or a gun (gun weights grow each level)
      if (Math.random() < FRAGS.dropShare) { this.spawnDrop('frag', z.x, z.y); return; }
      const table = [{ type: 'health', weight: HEALTH_DROP_WEIGHT }];
      for (const w of Object.keys(GUN_DROPS)) {
        const weight = gunDropWeight(w, this.round, this.unlockedTiers.has(WEAPONS[w].tier));
        if (weight > 0) table.push({ type: w, weight });
      }
      const total = table.reduce((s, d) => s + d.weight, 0);
      let roll = Math.random() * total;
      const pick = table.find(d => (roll -= d.weight) < 0) || table[0];
      this.spawnDrop(pick.type, z.x, z.y);
    } else if (Math.random() < POWERUP_CHANCE) {
      const list = Object.entries(POWERUPS);
      let roll = Math.random() * list.reduce((s, [, p]) => s + p.weight, 0);
      const [type] = list.find(([, p]) => (roll -= p.weight) < 0) || list[0];
      this.spawnDrop(type, z.x, z.y);
    }
  }

  // Nuke: wipes out the zombies closest to whoever grabbed it (the boss shrugs it off).
  nuke(p) {
    const victims = this.zombies.filter(z => z.hp > 0 && z.type !== 'boss')
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
      .slice(0, POWERUPS.nuke.kills);
    this.events.push({ e: 'nuke', x: Math.round(p.x), y: Math.round(p.y), p: p.id, n: victims.length });
    for (const z of victims) {
      z.hp = 0;
      z.lastHitA = Math.atan2(z.y - p.y, z.x - p.x);
      z.blasted = true;
      this.killZombie(z, p.id);
    }
    this.zombies = this.zombies.filter(z => z.hp > 0);
  }

  spawnDrop(type, x, y) {
    this.drops.push({ id: this.nextId++, type, x, y, life: DROP_LIFETIME });
  }

  updateDrops(dt) {
    const nukes = [];
    this.drops = this.drops.filter(d => {
      d.life -= dt;
      if (d.life <= 0) return false;
      for (const p of this.players.values()) {
        if (p.state !== 'alive' || Math.hypot(p.x - d.x, p.y - d.y) > 11) continue;
        if (d.type === 'health') {
          if (p.hp >= PLAYER.maxHp) continue;
          p.hp = Math.min(PLAYER.maxHp, p.hp + HEALTH_PACK);
        } else if (d.type === 'frag') {
          if (p.frags >= FRAGS.max) continue; // pockets full: leave it for someone else
          p.frags++;
        } else if (d.type === 'star' || d.type === 'ghost' || d.type === 'minigun') {
          p[d.type] = POWERUPS[d.type].duration;
        } else if (d.type === 'nuke') {
          this.events.push({ e: 'pickup', p: p.id, d: DROP_CODE[d.type] });
          nukes.push(p); // set off after this loop, so drops from the dead aren't lost mid-filter
          return false;
        } else if (p.weapon === d.type) {
          p.ammo += WEAPONS[d.type].ammo;
        } else {
          p.weapon = d.type; p.ammo = WEAPONS[d.type].ammo;
        }
        this.events.push({ e: 'pickup', p: p.id, d: DROP_CODE[d.type] });
        return false;
      }
      return true;
    });
    for (const p of nukes) this.nuke(p);
  }

  updatePlayers(dt) {
    const alive = this.alivePlayers();
    for (const p of this.players.values()) {
      p.hurtCd -= dt;
      // slow regen once you've gone a while without getting hit
      p.sinceHurt = (p.sinceHurt ?? 0) + dt;
      if (p.state === 'alive' && p.sinceHurt >= PLAYER.regenDelay && p.hp < PLAYER.maxHp) p.hp = Math.min(PLAYER.maxHp, p.hp + PLAYER.regenRate * dt);
      p.star = Math.max(0, p.star - dt);
      p.ghost = Math.max(0, p.ghost - dt);
      p.minigun = Math.max(0, p.minigun - dt);
      if (p.state !== 'alive') { p.star = 0; p.ghost = 0; p.minigun = 0; }
      if (p.state !== 'down') continue;
      const helper = alive.find(o => Math.hypot(o.x - p.x, o.y - p.y) < PLAYER.reviveRadius);
      if (helper) {
        p.revive += dt;
        if (p.revive >= PLAYER.reviveTime) {
          p.state = 'alive'; p.hp = 40; p.revive = 0;
          helper.revives++; helper.score += 50;
          this.events.push({ e: 'revive', p: p.id, by: helper.id });
        }
      } else {
        p.revive = Math.max(0, p.revive - dt);
        p.bleed -= dt;
        if (p.bleed <= 0) { p.state = 'dead'; this.events.push({ e: 'dead', p: p.id }); }
      }
    }
  }

  snapshot() {
    const left = this.toSpawn + this.zombies.length;
    this.onSnapshot({
      t: 's',
      time: Date.now(),
      round: this.round,
      phase: this.phase,
      timer: +Math.max(0, this.timer).toFixed(1),
      left,
      p: [...this.players.values()].map(p => [
        p.id, +p.x.toFixed(1), +p.y.toFixed(1), +p.a.toFixed(2), Math.ceil(p.hp), STATE_CODE[p.state],
        WEAPON_CODE[p.weapon], p.ammo === Infinity ? -1 : p.ammo, p.score, p.kills, p.tp,
        +(p.revive / PLAYER.reviveTime).toFixed(2), Math.ceil(p.bleed), p.name, p.color,
        +p.star.toFixed(1), +p.ghost.toFixed(1), p.frags, +p.minigun.toFixed(1),
      ]),
      z: this.zombies.map(z => [
        z.id, ZTYPE_CODE[z.type], +z.x.toFixed(1), +z.y.toFixed(1), z.hp, z.maxHp,
        z.type === 'boss' ? BOSS_STATE[z.bs] : 0, z.enraged ? 1 : 0,
      ]),
      d: this.drops.map(d => [d.id, DROP_CODE[d.type], Math.round(d.x), Math.round(d.y), Math.ceil(d.life)]),
      b: this.bombs.map(b => [b.id, Math.round(b.sx), Math.round(b.sy), Math.round(b.tx), Math.round(b.ty), +(b.t / b.flight).toFixed(2)]),
      ev: this.events.splice(0),
    });
  }
}
