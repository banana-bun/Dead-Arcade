// Shared tuning values, imported by both the Node server and the browser client.

export const TILE = 16;
export const TICK_RATE = 30;       // server simulation ticks per second
export const SNAPSHOT_RATE = 20;   // state broadcasts per second

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export const PLAYER = {
  radius: 5,
  speed: 78,          // px per second
  maxHp: 100,
  reviveTime: 2.5,    // seconds a teammate must stand next to you
  reviveRadius: 18,
  bleedOutTime: 20,   // seconds downed before you are out for the round
  sprintMul: 1.65,    // speed multiplier while holding Shift
  maxStamina: 100,
  staminaDrain: 38,   // per second while sprinting
  staminaRegen: 22,   // per second once regen kicks in
  staminaDelay: 0.8,  // seconds after sprinting before regen starts
  staminaMinRestart: 25, // after running dry you need this much before sprinting again
  regenDelay: 6,      // seconds without taking damage before health starts coming back
  regenRate: 0.5,     // HP per second (very slow: full heal from 0 takes over 3 minutes)
};

export const PLAYER_COLORS = ['#ff8a2a', '#5ad1ff', '#b56cff', '#7dff6a', '#ff5ab4', '#ffe45a'];

// `tier` is the boss round that introduces a weapon (0 = available from the start).
// `ammo` is shots (or swings for the katana). Special behaviours:
//   melee   - swings hit every zombie in an arc in front of you instead of firing bullets
//   offsets - each pellet leaves from a sideways offset (double pistols)
//   explode - splash damage on impact; with `fuse` + `bounce` it is a bouncing grenade
export const WEAPONS = {
  handgun:     { name: 'Handgun', tier: 0, damage: 1, fireRate: 0.26, speed: 360, range: 260, pellets: 1, spread: 0.05, ammo: Infinity, pierce: 0, color: '#ffd27a' },
  shotgun:     { name: 'Shotgun', tier: 0, damage: 1, fireRate: 0.62, speed: 330, range: 150, pellets: 6, spread: 0.42, ammo: 28, pierce: 0, color: '#ffb35a' },
  laser:       { name: 'Laser', tier: 0, damage: 3, fireRate: 0.11, speed: 620, range: 420, pellets: 1, spread: 0.02, ammo: 140, pierce: 4, color: '#ff3df2' },
  katana:      { name: 'Katana', tier: 0, damage: 4, fireRate: 0.3, speed: 0, range: 0, pellets: 1, spread: 0, ammo: 90, pierce: 0, color: '#bfe8ff', melee: { reach: 24, arc: 2.2 } },
  dualpistols: { name: 'Double Pistols', tier: 0, damage: 1, fireRate: 0.15, speed: 370, range: 260, pellets: 2, spread: 0.04, ammo: 120, pierce: 0, color: '#ffe0a0', offsets: [-3, 3] },
  machinegun:  { name: 'Machine Gun', tier: 5, damage: 1, fireRate: 0.075, speed: 400, range: 280, pellets: 1, spread: 0.14, ammo: 250, pierce: 0, color: '#fff07a' },
  uzi:         { name: 'Uzi', tier: 5, damage: 1, fireRate: 0.055, speed: 380, range: 200, pellets: 1, spread: 0.22, ammo: 220, pierce: 0, color: '#ffe85a' },
  ak47:        { name: 'AK-47', tier: 5, damage: 2, fireRate: 0.11, speed: 440, range: 320, pellets: 1, spread: 0.07, ammo: 150, pierce: 0, color: '#ffc86a' },
  m16:         { name: 'M16', tier: 5, damage: 2, fireRate: 0.14, speed: 480, range: 380, pellets: 1, spread: 0.02, ammo: 150, pierce: 1, color: '#d8f0ff' },
  // Rockets do no direct damage; they explode on impact for splash damage.
  rocket:      { name: 'Rocket Launcher', tier: 10, damage: 0, fireRate: 0.85, speed: 210, range: 340, pellets: 1, spread: 0, ammo: 18, pierce: 0, color: '#ff7a2a', explode: { radius: 42, damage: 7 } },
  grenade:     { name: 'Grenade Launcher', tier: 10, damage: 0, fireRate: 0.7, speed: 190, range: 9999, pellets: 1, spread: 0.03, ammo: 26, pierce: 0, color: '#9aff5a', explode: { radius: 52, damage: 6 }, fuse: 1.0, bounce: true },
  // Hand-thrown bomb (Q). Never held as a gun (tier -1 keeps it out of the weapon pools); carried separately.
  frag:        { name: 'Grenade', tier: -1, damage: 0, fireRate: 0.4, speed: 200, range: 9999, pellets: 1, spread: 0, ammo: 0, pierce: 0, color: '#ffb03a', explode: { radius: 46, damage: 8 }, fuse: 1.2, bounce: true },
  // Only from the Minigun powerup: unlimited ammo while it lasts. Never dropped as a weapon itself.
  minigun:     { name: 'Minigun', tier: -1, droppable: false, damage: 1, fireRate: 0.045, speed: 460, range: 300, pellets: 1, spread: 0.12, ammo: Infinity, pierce: 1, color: '#ff8a2a' },
};

// Gun rarity: sets the colour a dropped gun glows (and its name in the HUD). Rarer tiers come
// with the later bosses. 'rainbow' and 'cosmic' are animated.
export const RARITIES = {
  green:   { name: 'Common',    color: '#5aff6a' },
  blue:    { name: 'Rare',      color: '#4aa8ff' },
  purple:  { name: 'Epic',      color: '#b56cff' },
  red:     { name: 'Legendary', color: '#ff3a3a' },
  gold:    { name: 'Mythic',    color: '#ffd23a' },
  rainbow: { name: 'Prismatic', color: '#ffffff' },
  cosmic:  { name: 'Cosmic',    color: '#c83dff' },
};
// Per gun: rarity, starting drop weight, and the cap it can grow to (+1 per level once unlocked).
export const GUN_DROPS = {
  dualpistols: { rarity: 'green',   weight: 50, cap: 75 },
  katana:      { rarity: 'green',   weight: 50, cap: 75 },
  shotgun:     { rarity: 'blue',    weight: 50, cap: 70 },
  uzi:         { rarity: 'purple',  weight: 40, cap: 60 },
  machinegun:  { rarity: 'purple',  weight: 40, cap: 60 },
  ak47:        { rarity: 'red',     weight: 40, cap: 55 },
  m16:         { rarity: 'red',     weight: 40, cap: 55 },
  grenade:     { rarity: 'gold',    weight: 30, cap: 45 },
  rocket:      { rarity: 'rainbow', weight: 30, cap: 40 },
  laser:       { rarity: 'cosmic',  weight: 5,  cap: 12 },
};
export const rarityOf = weapon => GUN_DROPS[weapon]?.rarity ?? null;

// Drop weight of a gun on a given round: grows 1 per level from the round its tier unlocked
// (round 1 for starting guns), up to its cap. 0 if the gun isn't unlocked yet.
export function gunDropWeight(weapon, round, unlocked = true) {
  const g = GUN_DROPS[weapon];
  if (!g || !unlocked) return 0;
  const since = Math.max(0, round - Math.max(1, WEAPONS[weapon].tier));
  return Math.min(g.cap, g.weight + since);
}

export const FRAGS = {
  max: 3,           // most grenades you can carry
  dropShare: 0.7,   // when a regular zombie drops loot, 70% of the time it's a grenade
  throwScale: 1.9,  // throw speed per pixel of cursor distance, so it lands near where you aim
  minSpeed: 70, maxSpeed: 240,
};

// Powerups roll separately from regular drops (POWERUP_CHANCE per kill, then by weight).
export const POWERUPS = {
  star:  { name: 'Invincibility', color: '#ffe45a', duration: 10, weight: 35 }, // can't be hurt, touching zombies kills them
  ghost: { name: 'Invisibility',  color: '#9ad8ff', duration: 12, weight: 40 }, // zombies ignore you (touching them still hurts)
  nuke:  { name: 'Nuke',          color: '#7dff6a', weight: 25, kills: 50 },    // kills the 50 zombies closest to you
  minigun: { name: 'Minigun',     color: '#ff8a2a', duration: 12, weight: 35 }, // a minigun with unlimited ammo while it lasts
};
export const POWERUP_CHANCE = 0.022; // roughly 2 powerups per 100 kills
export const STAR_SPEED = 1.25; // invincible players move a bit faster

// Network codes: a weapon's code is its index here. Drops use the same index, with 0 = health and powerups at the end.
export const WEAPON_LIST = ['handgun', 'shotgun', 'laser', 'machinegun', 'rocket', 'katana', 'dualpistols', 'uzi', 'ak47', 'm16', 'grenade', 'frag', 'minigun'];
export const DROP_TYPES = ['health', ...WEAPON_LIST.slice(1).filter(w => WEAPONS[w].droppable !== false), ...Object.keys(POWERUPS)];

// Lobby toggles the host can switch on. All off by default.
export const MATCH_OPTIONS = {
  noEyes: { name: 'Disable zombie eyes', blurb: "Zombie eyes stop glowing. You only see them in your flashlight." },
  friendlyFire: { name: 'Friendly fire', blurb: 'Your bullets, blades and blasts hurt teammates.' },
};
export const FRIENDLY_FIRE = { bulletMul: 8, blastMul: 5 }; // weapon damage -> HP damage to teammates

// Each zombie kill has a chance to drop something (it creeps up each level, to a cap); most loot is a
// hand grenade, the rest is health or a gun picked by weight (gun weights also grow per level, see GUN_DROPS).
export const DROP_CHANCE = 0.09;
export const DROP_CHANCE_PER_LEVEL = 0.0025;
export const DROP_CHANCE_MAX = 0.15;
export const HEALTH_DROP_WEIGHT = 30;
export function dropChance(round) {
  return Math.min(DROP_CHANCE_MAX, DROP_CHANCE + DROP_CHANCE_PER_LEVEL * Math.max(0, round - 1));
}
export const DROP_LIFETIME = 25; // seconds before a drop despawns
export const HEALTH_PACK = 40;

export const ZOMBIES = {
  walker: { radius: 5,  speed: 30, hp: 2, damage: 10, color: '#6fae5a' },
  runner: { radius: 4,  speed: 52, hp: 1, damage: 8,  color: '#a3c95a' },
  brute:  { radius: 7,  speed: 22, hp: 6, damage: 20, color: '#4f7a46' },
  boss:   { radius: 16, speed: 26, hp: 25, damage: 30, color: '#7a2a8a' },
};

// Zombies phase in: only this many can be up at once (more with more players); the rest queue.
export const MAX_ALIVE_ZOMBIES = 80;
export function maxAliveZombies(players = 1) {
  return Math.min(MAX_ALIVE_ZOMBIES, 22 + 8 * Math.max(1, players));
}
export const INTERMISSION = 4;    // seconds between rounds
export const FIRST_ROUND_DELAY = 2.5;
export const OPENING_WAVE = 0.35; // share of the alive cap that rises the moment a round starts
export const PLAYER_SCALING = 0.25; // +25% zombies for each player beyond the first
export const ROUND_GROWTH_CAP = 15; // a round never adds more than this many zombies over the last one
export const DRINK_CHANCE = 0.01;  // round-clear message says "Take a Drink" instead

// Round 1 = 5, round 2 = 7, then each round adds 5 more than the last increase
// (17, 32, 47...) until the increase hits ROUND_GROWTH_CAP. Boss rounds (every 5th) don't count.
// The total then scales up with the number of players.
export function zombieCountForRound(round, players = 1) {
  return Math.round(baseZombieCount(round) * (1 + PLAYER_SCALING * Math.max(0, players - 1)));
}

function baseZombieCount(round) {
  let count = 5;
  let normalRound = 1;
  for (let r = 2; r <= round; r++) {
    if (r % 5 === 0) continue;
    normalRound++;
    count += normalRound === 2 ? 2 : Math.min(ROUND_GROWTH_CAP, 5 * (normalRound - 1));
  }
  return count;
}

export function isBossRound(round) {
  return round % 5 === 0;
}

export const BOSS = {
  hpMul: 2,            // on top of the 25 / 35 / 45... curve
  hpPerPlayer: 0.75,   // +75% HP for each player beyond the first
  advancedFrom: 10,    // pumpkin bombs, minions and enrage start at this boss; earlier bosses just charge and slam
  enrageAt: 0.5,       // below half HP: faster, attacks more often, bigger slams
  bomb: { radius: 34, damage: 22, flight: 1.1, count: 3, enragedCount: 5 }, // lobbed flaming pumpkins
  minions: { base: 3, perPlayer: 1, cooldown: 10, cap: 6, capPerPlayer: 2 },
};

// Curve: 25 HP on round 5, 35 on round 10, 45 on round 15... then doubled and scaled by players.
export function bossHpForRound(round, players = 1) {
  const base = 25 + 10 * (round / 5 - 1);
  return Math.round(base * BOSS.hpMul * (1 + BOSS.hpPerPlayer * Math.max(0, players - 1)));
}
