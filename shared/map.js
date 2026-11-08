// Deterministic map generators + collision helpers, shared by server and client.
import { TILE } from './config.js';

export const T = {
  GRASS: 0, ROAD: 1, SIDEWALK: 2, HOUSE: 3, TREE: 4, FENCE: 5,
  DRIVEWAY: 6, GRAVE: 7, DIRT: 8, HEDGE: 9, PATCH: 10,
  CORN: 11, HAY: 12, WATER: 13, SOIL: 14, FIRE: 15,
  MALLFLOOR: 16, WALL: 17, CARPET: 18, SHELF: 19, PARKING: 20, GLASS: 21, TABLE: 22, COUNTER: 23, PLANTER: 24,
  WOODFLOOR: 25, LINO: 26, CABINET: 27, BOOKSHELF: 28, TVWALL: 29, TANK: 30, RACK: 31, BIN: 32,
  INSTRUMENT: 33, PEN: 34,
};

const SOLID = new Set([
  T.HOUSE, T.TREE, T.FENCE, T.GRAVE, T.HEDGE, T.CORN, T.HAY, T.WATER, T.FIRE,
  T.WALL, T.SHELF, T.GLASS, T.TABLE, T.COUNTER, T.PLANTER,
  T.CABINET, T.BOOKSHELF, T.TVWALL, T.TANK, T.RACK, T.BIN, T.INSTRUMENT, T.PEN,
]);

// Tall things that block flashlight beams. Glass, water, fences, graves and low fixtures let light through.
const OPAQUE = new Set([T.HOUSE, T.WALL, T.HEDGE, T.CORN, T.TREE, T.SHELF, T.BOOKSHELF, T.TVWALL, T.CABINET]);
export function blocksLight(map, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return OPAQUE.has(map.tiles[ty * map.w + tx]);
}

// Store fixtures sit on top of a floor; maps that use them keep that floor in `map.floor`.
export const FIXTURES = new Set([T.SHELF, T.TABLE, T.COUNTER, T.PLANTER, T.CABINET, T.BOOKSHELF, T.TVWALL, T.TANK, T.RACK, T.BIN, T.INSTRUMENT, T.PEN]);

// Maps the host can pick in the lobby.
export const MAPS = {
  suburb: { name: 'Suburb Street', blurb: 'Cul-de-sacs, porch pumpkins and a cemetery.' },
  farm: { name: 'Corn Farm', blurb: 'Tight corn rows, a red barn and a bonfire.' },
  mall: { name: 'Dead Mall', blurb: 'Flickering neon, looted stores and a dry fountain.' },
};

export function generateMap(id = 'suburb') {
  if (id === 'farm') return generateFarm();
  if (id === 'mall') return generateMall();
  return generateSuburb();
}

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 96, H = 72;
const ROAD_X = [16, 48, 80];
const ROAD_Y = [12, 36, 60];
const ROOF_COLORS = ['#5a2e3a', '#3b3554', '#2f4a4a', '#5a4030', '#463a5c', '#4a2f2f'];

function generateSuburb(seed = 1031) {
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(W * H);
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = t; };
  const get = (x, y) => tiles[y * W + x];
  const houses = [], decor = [], lights = [], spawns = [];

  // Roads with sidewalks.
  for (const cx of ROAD_X) for (let y = 0; y < H; y++) {
    for (let x = cx - 2; x <= cx + 1; x++) set(x, y, T.ROAD);
    if (get(cx - 3, y) !== T.ROAD) set(cx - 3, y, T.SIDEWALK);
    if (get(cx + 2, y) !== T.ROAD) set(cx + 2, y, T.SIDEWALK);
  }
  for (const cy of ROAD_Y) for (let x = 0; x < W; x++) {
    for (let y = cy - 2; y <= cy + 1; y++) set(x, y, T.ROAD);
    if (get(x, cy - 3) !== T.ROAD) set(x, cy - 3, T.SIDEWALK);
    if (get(x, cy + 2) !== T.ROAD) set(x, cy + 2, T.SIDEWALK);
  }

  // Blocks between the sidewalks.
  const xs = [[2, 12], [19, 44], [51, 76], [83, 93]];
  const ys = [[2, 8], [15, 32], [39, 56], [63, 69]];
  for (let bi = 0; bi < xs.length; bi++) for (let bj = 0; bj < ys.length; bj++) {
    const [x0, x1] = xs[bi], [y0, y1] = ys[bj];
    const big = x1 - x0 > 14 && y1 - y0 > 10;
    if (!big) woods(x0, x1, y0, y1);
    else if (bi === 2 && bj === 2) cemetery(x0, x1, y0, y1);
    else if (bi === 1 && bj === 2) park(x0, x1, y0, y1);
    else neighborhood(x0, x1, y0, y1);
  }

  // Hedge border keeps everyone inside; zombies crawl in where roads meet it.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) set(x, y, T.HEDGE);
  }
  for (const cx of ROAD_X) {
    spawns.push({ x: cx * TILE, y: 3 * TILE }, { x: cx * TILE, y: (H - 3) * TILE });
  }
  for (const cy of ROAD_Y) {
    spawns.push({ x: 3 * TILE, y: cy * TILE }, { x: (W - 3) * TILE, y: cy * TILE });
  }

  // Streetlights along sidewalks, skipping intersections.
  const nearRoadCenter = (v, list) => list.some(c => Math.abs(v - c) < 6);
  for (const cx of ROAD_X) for (let y = 6; y < H - 4; y += 9) {
    if (nearRoadCenter(y, ROAD_Y)) continue;
    const side = (y / 9) % 2 ? -3 : 2;
    lamp(cx + side, y);
  }
  for (const cy of ROAD_Y) for (let x = 6; x < W - 4; x += 9) {
    if (nearRoadCenter(x, ROAD_X)) continue;
    const side = (x / 9) % 2 ? -3 : 2;
    lamp(x, cy + side);
  }

  function lamp(tx, ty) {
    const x = tx * TILE + 8, y = ty * TILE + 8;
    decor.push({ type: 'lamp', x, y });
    lights.push({ x, y, r: 70, color: '#ffcf7a', intensity: 0.9, flicker: rand() < 0.2 ? 1 : 0 });
  }

  function pumpkin(px, py) {
    decor.push({ type: 'pumpkin', x: px, y: py, v: Math.floor(rand() * 3) });
    lights.push({ x: px, y: py, r: 34, color: '#ff8a1e', intensity: 0.85, flicker: 1 });
  }

  function woods(x0, x1, y0, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const r = rand();
      if (r < 0.16) set(x, y, T.TREE);
      else if (r < 0.19) set(x, y, T.PATCH);
    }
    // a couple of spooky clearings with pumpkins
    for (let i = 0; i < 2; i++) {
      const cx = x0 + 1 + Math.floor(rand() * (x1 - x0 - 1));
      const cy = y0 + 1 + Math.floor(rand() * (y1 - y0 - 1));
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) set(x, y, T.GRASS);
      }
      if (rand() < 0.6) pumpkin(cx * TILE + 8, cy * TILE + 8);
    }
  }

  function neighborhood(x0, x1, y0, y1) {
    const width = x1 - x0 + 1;
    const lots = Math.floor(width / 8);
    const lotW = width / lots;
    const mid = Math.floor((y0 + y1) / 2);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < lots; i++) {
        const lx = Math.floor(x0 + i * lotW);
        const hw = 6, hh = 4;
        const hx = lx + 1 + Math.floor(rand() * Math.max(1, lotW - hw - 1));
        const hy = row === 0 ? y0 + 2 : y1 - 1 - hh;
        for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + hw; x++) set(x, y, T.HOUSE);
        const facing = row === 0 ? 'n' : 's';
        houses.push({ x: hx * TILE, y: hy * TILE, w: hw * TILE, h: hh * TILE, roof: ROOF_COLORS[Math.floor(rand() * ROOF_COLORS.length)], facing, lit: rand() < 0.7 });
        // driveway to the road
        const dx = rand() < 0.5 ? hx - 1 : hx + hw;
        if (row === 0) for (let y = y0; y < hy + hh; y++) set(dx, y, T.DRIVEWAY);
        else for (let y = hy; y <= y1; y++) set(dx, y, T.DRIVEWAY);
        // porch pumpkins
        const doorX = (hx + hw / 2) * TILE;
        const porchY = row === 0 ? (hy - 0.5) * TILE : (hy + hh + 0.5) * TILE;
        if (rand() < 0.8) pumpkin(doorX - 10, porchY);
        if (rand() < 0.4) pumpkin(doorX + 10, porchY);
        // window light spilling out of lit houses
        const h = houses[houses.length - 1];
        if (h.lit) lights.push({ x: h.x + h.w / 2, y: row === 0 ? h.y - 6 : h.y + h.h + 6, r: 46, color: '#ffb84a', intensity: 0.55, flicker: 0 });
        // backyard tree / grave
        const by = row === 0 ? hy + hh + 1 + Math.floor(rand() * 2) : hy - 2 - Math.floor(rand() * 2);
        const bx = lx + 1 + Math.floor(rand() * (lotW - 2));
        if (rand() < 0.6) set(bx, by, T.TREE);
        else if (rand() < 0.5) { set(bx, by, T.GRAVE); decor.push({ type: 'candle', x: bx * TILE + 8, y: by * TILE + 15 }); lights.push({ x: bx * TILE + 8, y: by * TILE + 15, r: 20, color: '#ffd36a', intensity: 0.6, flicker: 1 }); }
      }
    }
    // back fence with gaps so nobody gets trapped
    for (let x = x0; x <= x1; x++) if (rand() > 0.28 && get(x, mid) === T.GRASS) set(x, mid, T.FENCE);
    // side fences between lots, partially
    for (let i = 1; i < lots; i++) {
      const fx = Math.floor(x0 + i * lotW);
      for (let y = mid - 3; y <= mid + 3; y++) if (rand() > 0.35 && get(fx, y) === T.GRASS) set(fx, y, T.FENCE);
    }
  }

  function cemetery(x0, x1, y0, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, T.GRASS);
    // iron fence ring with gates in the middle of each side
    const mx = Math.floor((x0 + x1) / 2), my = Math.floor((y0 + y1) / 2);
    for (let x = x0 + 1; x <= x1 - 1; x++) {
      if (Math.abs(x - mx) > 1) { set(x, y0 + 1, T.FENCE); set(x, y1 - 1, T.FENCE); }
    }
    for (let y = y0 + 1; y <= y1 - 1; y++) {
      if (Math.abs(y - my) > 1) { set(x0 + 1, y, T.FENCE); set(x1 - 1, y, T.FENCE); }
    }
    for (let x = x0 + 2; x <= x1 - 2; x++) for (let dy = -1; dy <= 1; dy++) set(x, my + dy, T.DIRT);
    for (let y = y0 + 2; y <= y1 - 2; y++) for (let dx = -1; dx <= 1; dx++) set(mx + dx, y, T.DIRT);
    for (let y = y0 + 3; y <= y1 - 3; y += 3) for (let x = x0 + 3; x <= x1 - 3; x += 3) {
      if (Math.abs(x - mx) <= 2 || Math.abs(y - my) <= 2) continue;
      if (rand() < 0.85) {
        set(x, y, T.GRAVE);
        spawns.push({ x: x * TILE + 8, y: (y + 1) * TILE + 8, grave: true });
        if (rand() < 0.3) { decor.push({ type: 'candle', x: x * TILE + 8, y: y * TILE + 15 }); lights.push({ x: x * TILE + 8, y: y * TILE + 15, r: 22, color: '#ffd36a', intensity: 0.6, flicker: 1 }); }
      }
    }
    decor.push({ type: 'crypt', x: mx * TILE + 8, y: (y0 + 4) * TILE });
    lights.push({ x: mx * TILE + 8, y: (y0 + 5) * TILE, r: 60, color: '#6aff9a', intensity: 0.5, flicker: 1 });
  }

  function park(x0, x1, y0, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      const r = rand();
      if (edge && r < 0.35) set(x, y, T.TREE);
      else if (!edge && r < 0.05) set(x, y, T.TREE);
    }
    // pumpkin patch in the middle
    const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2);
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 6; x <= cx + 6; x++) set(x, y, T.PATCH);
    for (let i = 0; i < 10; i++) {
      pumpkin((cx - 5 + rand() * 10) * TILE + 8, (cy - 2 + rand() * 4) * TILE + 8);
    }
    decor.push({ type: 'scarecrow', x: cx * TILE + 8, y: cy * TILE + 8 });
    lights.push({ x: cx * TILE + 8, y: cy * TILE, r: 90, color: '#ff7a1e', intensity: 0.5, flicker: 1 });
  }

  // Lamps/pumpkins are drawn over whatever tile they sit on, but make sure none land in solids.
  const keepDecor = decor.filter(d => !SOLID.has(get(Math.floor(d.x / TILE), Math.floor(d.y / TILE))) || d.type === 'candle');

  return {
    w: W, h: H, tiles, houses, decor: keepDecor, lights, spawns,
    playerSpawn: { x: ROAD_X[1] * TILE, y: ROAD_Y[1] * TILE },
    cemetery: { x0: 51, x1: 76, y0: 39, y1: 56 },
  };
}

function generateFarm(seed = 2024) {
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(W * H);
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = t; };
  const get = (x, y) => tiles[y * W + x];
  const houses = [], decor = [], lights = [], spawns = [];
  const RX = 47, RY = 35; // dirt road crossroads

  const lantern = (tx, ty, r = 64) => {
    const x = tx * TILE + 8, y = ty * TILE + 8;
    decor.push({ type: 'lamp', x, y });
    lights.push({ x, y, r, color: '#ffc46a', intensity: 0.85, flicker: 1 });
  };
  const pumpkin = (px, py) => {
    decor.push({ type: 'pumpkin', x: px, y: py, v: Math.floor(rand() * 3) });
    lights.push({ x: px, y: py, r: 34, color: '#ff8a1e', intensity: 0.85, flicker: 1 });
  };

  // Corn grows in north-south rows two stalks thick, with a walkable furrow between rows
  // and open cross paths every 9 tiles so every row connects.
  function cornfield(x0, x1, y0, y1, holes = []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (holes.some(h => ((x - h.x) / h.rx) ** 2 + ((y - h.y) / h.ry) ** 2 <= 1)) continue;
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      const cross = (y - y0) % 9 === 0;
      const furrow = (x - x0) % 3 === 0;
      set(x, y, edge || cross || furrow || rand() < 0.04 ? T.SOIL : T.CORN);
    }
    // a few scarecrows and lanterns out on the cross paths; zombies creep out of the rows
    for (let y = y0 + 9; y < y1; y += 9) {
      for (let x = x0 + 3; x < x1 - 2; x += 3) {
        if (get(x, y) !== T.SOIL) continue;
        const r = rand();
        if (r < 0.07) { decor.push({ type: 'scarecrow', x: x * TILE + 8, y: y * TILE + 8 }); lights.push({ x: x * TILE + 8, y: y * TILE, r: 40, color: '#ff7a1e', intensity: 0.45, flicker: 1 }); }
        else if (r < 0.12) lantern(x, y, 48);
        else if (r < 0.3) spawns.push({ x: x * TILE + 8, y: y * TILE + 8, corn: true });
      }
    }
  }

  // Quadrants around the crossroads: three cornfields and the farmyard to the north-east.
  cornfield(2, RX - 3, 2, RY - 3);
  const patch = { x: 22, y: 52, rx: 9, ry: 5 };
  cornfield(2, RX - 3, RY + 3, H - 3, [patch]);
  const pond = { x: 78, y: 56, rx: 9, ry: 6 };
  cornfield(RX + 3, W - 3, RY + 3, H - 3, [{ ...pond, rx: pond.rx + 2, ry: pond.ry + 2 }]);

  // pumpkin patch clearing
  for (let y = patch.y - 4; y <= patch.y + 4; y++) for (let x = patch.x - 8; x <= patch.x + 8; x++) {
    if (((x - patch.x) / 8) ** 2 + ((y - patch.y) / 4) ** 2 <= 1) set(x, y, T.PATCH);
  }
  for (let i = 0; i < 12; i++) pumpkin((patch.x - 6 + rand() * 12) * TILE + 8, (patch.y - 3 + rand() * 6) * TILE + 8);
  decor.push({ type: 'scarecrow', x: patch.x * TILE + 8, y: patch.y * TILE + 8 });
  lights.push({ x: patch.x * TILE + 8, y: patch.y * TILE, r: 90, color: '#ff7a1e', intensity: 0.5, flicker: 1 });

  // pond with a muddy bank
  for (let y = pond.y - pond.ry - 1; y <= pond.y + pond.ry + 1; y++) for (let x = pond.x - pond.rx - 1; x <= pond.x + pond.rx + 1; x++) {
    const d = ((x - pond.x) / pond.rx) ** 2 + ((y - pond.y) / pond.ry) ** 2;
    if (d <= 1) set(x, y, T.WATER);
    else if (d <= 1.5) set(x, y, T.GRASS);
  }
  lights.push({ x: pond.x * TILE, y: pond.y * TILE, r: 110, color: '#5a7aff', intensity: 0.25, flicker: 0 });
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2;
    const tx = Math.round(pond.x + Math.cos(a) * (pond.rx + 1)), ty = Math.round(pond.y + Math.sin(a) * (pond.ry + 1));
    if (get(tx, ty) === T.GRASS) set(tx, ty, T.TREE);
  }

  // farmyard: dirt yard, barn, silo, farmhouse, animal pen, hay bales, bonfire
  const fx0 = RX + 3, fx1 = W - 3, fy0 = 2, fy1 = RY - 3;
  for (let y = fy0; y <= fy1; y++) for (let x = fx0; x <= fx1; x++) if (rand() < 0.04) set(x, y, T.TREE);
  for (let y = 12; y <= 30; y++) for (let x = 54; x <= 77; x++) set(x, y, T.DIRT);
  for (let y = 20; y <= 30; y++) for (let x = 78; x <= 89; x++) set(x, y, T.GRASS); // farmhouse lawn
  const building = (tx, ty, tw, th, props) => {
    for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) set(x, y, T.HOUSE);
    houses.push({ x: tx * TILE, y: ty * TILE, w: tw * TILE, h: th * TILE, facing: 's', ...props });
  };
  building(57, 13, 12, 8, { kind: 'barn', roof: '#3a3a44', lit: false });
  lights.push({ x: 63 * TILE, y: 21 * TILE + 6, r: 60, color: '#ffb84a', intensity: 0.7, flicker: 0 });
  lantern(56, 21); lantern(69, 21);
  building(71, 14, 4, 4, { kind: 'silo', roof: '#6a6a74', lit: false });
  building(80, 22, 7, 5, { roof: '#4a2f2f', lit: true });
  lights.push({ x: 83.5 * TILE, y: 27 * TILE + 6, r: 46, color: '#ffb84a', intensity: 0.55, flicker: 0 });
  pumpkin(82 * TILE, 27.6 * TILE); pumpkin(85 * TILE, 27.6 * TILE);
  // animal pen with gates
  for (let x = 52; x <= 68; x++) if (x !== 60) { set(x, 3, T.FENCE); set(x, 9, T.FENCE); }
  for (let y = 3; y <= 9; y++) if (y !== 6) { set(52, y, T.FENCE); set(68, y, T.FENCE); }
  for (let y = 4; y <= 8; y++) for (let x = 53; x <= 67; x++) if (get(x, y) === T.TREE) set(x, y, T.DIRT);
  for (let i = 0; i < 14; i++) {
    const x = 55 + Math.floor(rand() * 22), y = 22 + Math.floor(rand() * 9);
    if (Math.abs(x - 64) < 3 && Math.abs(y - 27) < 3) continue;
    if (get(x, y) === T.DIRT && get(x + 1, y) === T.DIRT) { set(x, y, T.HAY); if (rand() < 0.5) set(x + 1, y, T.HAY); }
  }
  set(64, 27, T.FIRE);
  decor.push({ type: 'fire', x: 64 * TILE + 8, y: 27 * TILE + 8 });
  lights.push({ x: 64 * TILE + 8, y: 27 * TILE + 8, r: 130, color: '#ff7a1e', intensity: 1, flicker: 1 });

  // dirt roads with lanterns
  for (let y = 0; y < H; y++) for (let x = RX - 1; x <= RX + 1; x++) set(x, y, T.DIRT);
  for (let x = 0; x < W; x++) for (let y = RY - 1; y <= RY + 1; y++) set(x, y, T.DIRT);
  for (let y = 6; y < H - 4; y += 10) if (Math.abs(y - RY) > 4) lantern(RX + ((y / 10) % 2 ? 2 : -2), y);
  for (let x = 6; x < W - 4; x += 10) if (Math.abs(x - RX) > 4) lantern(x, RY + ((x / 10) % 2 ? 2 : -2));

  // tree line border
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) set(x, y, T.HEDGE);
  }
  spawns.push({ x: RX * TILE + 8, y: 3 * TILE }, { x: RX * TILE + 8, y: (H - 3) * TILE });
  spawns.push({ x: 3 * TILE, y: RY * TILE + 8 }, { x: (W - 3) * TILE, y: RY * TILE + 8 });

  const keepDecor = decor.filter(d => d.type === 'fire' || !SOLID.has(get(Math.floor(d.x / TILE), Math.floor(d.y / TILE))));
  const keepSpawns = spawns.filter(s => !SOLID.has(get(Math.floor(s.x / TILE), Math.floor(s.y / TILE))));
  return {
    w: W, h: H, tiles, houses, decor: keepDecor, lights, spawns: keepSpawns,
    playerSpawn: { x: RX * TILE + 8, y: RY * TILE + 8 },
    cemetery: null,
  };
}

const ON_FIXTURE = new Set(['skylight', 'kiosk', 'screen', 'tv', 'tank', 'pen', 'critter', 'stall']);

function generateMall(seed = 1987) {
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(W * H).fill(T.PARKING);
  const floor = new Uint8Array(W * H);   // floor under fixtures (0 = default)
  const variant = new Uint8Array(W * H); // which look a fixture uses (bin contents, etc.)
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = t; };
  const get = (x, y) => tiles[y * W + x];
  const fill = (x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t); };
  const fillFloor = (x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { set(x, y, t); floor[y * W + x] = t; } };
  const fixture = (x, y, t, v = 0) => { if (get(x, y) !== T.WALL && get(x, y) !== T.GLASS) { set(x, y, t); variant[y * W + x] = v; } };
  const houses = [], decor = [], lights = [], spawns = [];
  const NEON = ['#ff3df2', '#3df2ff', '#7dff6a', '#ffe45a', '#ff5a5a', '#b56cff'];
  const at = (tx, ty) => ({ x: tx * TILE + 8, y: ty * TILE + 8 });

  // Ceiling fluorescents: some steady, some stuttering (flicker 2), some dead.
  const fluoro = (tx, ty, r = 54) => {
    const roll = rand();
    if (roll < 0.3) return; // burnt out
    lights.push({ ...at(tx, ty), r, color: '#cfe8ff', intensity: 0.55, flicker: roll < 0.6 ? 2 : 0 });
  };
  const neon = (tx, ty, w, color = NEON[Math.floor(rand() * NEON.length)], text = '') => {
    const flicker = rand() < 0.4 ? 2 : 1;
    decor.push({ type: 'neon', ...at(tx, ty), w, color, flicker, text });
    lights.push({ ...at(tx, ty), r: 56, color, intensity: 0.7, flicker });
  };

  // --- building shell ---
  const BX0 = 6, BX1 = 89, BY0 = 14, BY1 = 65;
  fill(BX0, BY0, BX1, BY1, T.WALL);
  fill(BX0 + 1, BY0 + 1, BX1 - 1, BY1 - 1, T.MALLFLOOR);
  const HY0 = 34, HY1 = 45, VX0 = 42, VX1 = 53; // concourses
  const CX = 47.5, CY = 39.5;                  // atrium centre

  // Each shop gets a theme: its own floor, fixtures, neon sign and lighting.
  // Fixture variants (map.variant): bins 1 toys / 2 candy / 3 records / 7 book table; shelf 4 = cage;
  // instruments 1 piano / 2 amp / 4 guitar rack; counters in the food court use the stall's brand number.
  const THEMES = {
    arcade:      { floor: T.CARPET,    neon: '#3df2ff', light: '#b56cff', text: 'ARCADE' },
    books:       { floor: T.WOODFLOOR, neon: '#ffe45a', light: '#ffcf8a', text: 'BOOKS' },
    electronics: { floor: T.LINO,      neon: '#5ad1ff', light: '#9ad8ff', text: 'TECH' },
    boutique:    { floor: T.WOODFLOOR, neon: '#ff5ab4', light: '#ffc8e0', text: 'STYLE' },
    toys:        { floor: T.CARPET,    neon: '#ffb34a', light: '#ffe0a0', text: 'TOYS' },
    pets:        { floor: T.LINO,      neon: '#7dff6a', light: '#5a9cff', text: 'PETS' },
    music:       { floor: T.WOODFLOOR, neon: '#b56cff', light: '#d0a0ff', text: 'MUSIC' },
    candy:       { floor: T.LINO,      neon: '#ff3df2', light: '#ffc0f0', text: 'CANDY' },
  };
  // north row (left to right), then south row
  const themeOrder = ['pets', 'books', 'music', 'arcade', 'electronics', 'candy'];
  let nextTheme = 0;

  // Fill a shop's sales floor (columns ax0..ax1, rows fy0..fy1) for its theme. `wallSide` rows are
  // the ones against the stockroom partition, `frontRow` the one just inside the glass.
  function furnish(theme, ax0, ax1, fy0, fy1, mid, backRow, frontRow) {
    const rows = []; for (let y = fy0; y <= fy1; y++) rows.push(y);
    const aisle = x => x === mid + 1 || x === mid + 2; // keep a straight path to the stockroom door
    switch (theme) {
      case 'arcade': {
        // cabinets lining both walls plus an island of back-to-back machines
        for (const y of rows) if ((y - fy0) % 2 === 0) for (const x of [ax0, ax1]) {
          fixture(x, y, T.CABINET);
          decor.push({ type: 'screen', ...at(x, y), color: NEON[Math.floor(rand() * NEON.length)], side: x === ax0 ? 1 : -1 });
        }
        for (let y = fy0 + 1; y <= fy1 - 1; y += 3) for (const x of [mid - 3, mid + 3]) if (x > ax0 + 1 && x < ax1 - 1) {
          fixture(x, y, T.CABINET);
          decor.push({ type: 'screen', ...at(x, y), color: NEON[Math.floor(rand() * NEON.length)], side: x < mid ? 1 : -1 });
        }
        for (let x = ax0 + 1; x <= ax0 + 3; x++) fixture(x, backRow, T.COUNTER); // prize counter
        break;
      }
      case 'books': {
        // bookshelves floor to ceiling on every wall, two long stacks, a reading nook and a display table
        for (let x = ax0; x <= ax1; x++) if (!aisle(x)) fixture(x, backRow, T.BOOKSHELF);
        for (const y of rows) if (y < fy1 - 1) { fixture(ax0, y, T.BOOKSHELF); fixture(ax1, y, T.BOOKSHELF); }
        for (const y of [fy0 + 1, fy0 + 4]) for (let x = ax0 + 2; x <= ax1 - 2; x++) if (!aisle(x)) fixture(x, y, T.BOOKSHELF);
        const nookY = fy1 - 1;
        decor.push({ type: 'rug', ...at(ax0 + 2.5, nookY) });
        decor.push({ type: 'chair', ...at(ax0 + 2, nookY) }, { type: 'chair', ...at(ax0 + 4, nookY) });
        lights.push({ ...at(ax0 + 3, nookY), r: 30, color: '#ffcf8a', intensity: 0.6, flicker: 1 }); // reading lamp
        for (const x of [ax1 - 3, ax1 - 2]) fixture(x, fy1 - 1, T.BIN, 7);
        break;
      }
      case 'electronics':
        for (let x = ax0; x <= ax1; x++) if (!aisle(x)) { fixture(x, backRow, T.TVWALL); decor.push({ type: 'tv', ...at(x, backRow) }); }
        for (let y = fy0 + 2; y <= fy1 - 1; y += 3) for (const x of [mid - 3, mid - 2, mid + 3, mid + 4]) if (x > ax0 && x < ax1) fixture(x, y, T.COUNTER);
        break;
      case 'boutique':
        for (let y = fy0 + 1; y <= fy1 - 2; y += 2) for (let x = ax0 + 1; x <= ax1 - 1; x += 3) if (!aisle(x) && rand() < 0.75) fixture(x, y, T.RACK, Math.floor(rand() * 3));
        for (const x of [ax0 + 1, ax1 - 1]) decor.push({ type: 'mannequin', ...at(x, frontRow), v: Math.floor(rand() * 2) });
        // two fitting rooms against the back wall
        for (const x of [ax1 - 2, ax1]) fixture(x, backRow, T.SHELF, 5);
        break;
      case 'toys':
        for (let y = fy0 + 1; y <= fy1 - 1; y += 3) for (let x = ax0 + 1; x <= ax1 - 1; x += 2) if (!aisle(x) && rand() < 0.8) fixture(x, y, T.BIN, 1);
        for (let k = 0; k < 3; k++) decor.push({ type: 'teddy', ...at(ax0 + Math.floor(rand() * (ax1 - ax0)), rows[Math.floor(rand() * rows.length)]) });
        break;
      case 'pets': {
        // aquarium section: a whole wall of glowing tanks at the back, plus tanks down one side
        for (let x = ax0; x <= ax1; x++) if (!aisle(x)) {
          fixture(x, backRow, T.TANK); decor.push({ type: 'tank', ...at(x, backRow), seed: rand() * 100 });
          if ((x - ax0) % 2 === 0) lights.push({ ...at(x, backRow), r: 34, color: '#3a8aff', intensity: 0.7, flicker: 0 });
        }
        for (let y = fy0 + 1; y <= fy1; y += 2) { fixture(ax1, y, T.TANK); decor.push({ type: 'tank', ...at(ax1, y), seed: rand() * 100 }); }
        // play pens with puppies, kittens and bunnies
        // (one tile in from the cage wall, so there's a walkway along the cages)
        for (const py of [fy0 + 1, fy0 + 5]) for (const px of [ax0 + 2]) {
          if (px + 1 >= ax1 - 1 || aisle(px) || aisle(px + 1)) continue;
          for (let y = py; y <= py + 1; y++) for (let x = px; x <= px + 1; x++) fixture(x, y, T.PEN);
          decor.push({ type: 'pen', x: (px + 1) * TILE, y: (py + 1) * TILE, kinds: [0, 1, 2].map(() => Math.floor(rand() * 3)), seed: rand() * 100 });
        }
        // hamster and bird cages along the other wall
        for (let y = fy0; y <= fy1; y += 2) { fixture(ax0, y, T.SHELF, 4); decor.push({ type: 'critter', ...at(ax0, y), kind: Math.floor(rand() * 2), seed: rand() * 100 }); }
        break;
      }
      case 'music':
        // an instrument shop: guitars on the walls, pianos, a rack of guitars on stands, amps and drum kits
        for (const y of rows) for (const x of [ax0, ax1]) decor.push({ type: 'guitar', ...at(x, y), color: ['#c83a2a', '#e8c83a', '#1a1a1a', '#3a6ac8', '#e8e8e8', '#6a3a1a'][Math.floor(rand() * 6)], side: x === ax0 ? 1 : -1 });
        for (let x = ax0 + 1; x <= ax1 - 1; x++) if (!aisle(x)) fixture(x, backRow, T.INSTRUMENT, 2); // amp wall
        for (const y of [fy0 + 1, fy0 + 4]) for (const x of [ax0 + 2, ax0 + 3, ax1 - 3, ax1 - 2]) if (!aisle(x)) fixture(x, y, T.INSTRUMENT, 1); // pianos
        for (let x = ax0 + 2; x <= ax1 - 2; x++) if (!aisle(x)) fixture(x, fy0 + 7, T.INSTRUMENT, 4); // guitar stands
        decor.push({ type: 'drums', ...at(ax0 + 2, frontRow) }, { type: 'drums', ...at(ax1 - 2, frontRow) });
        break;
      case 'candy':
        for (let y = fy0; y <= fy1 - 1; y += 2) for (let x = ax0 + 1; x <= ax1 - 1; x++) if (!aisle(x) && rand() < 0.7) fixture(x, y, T.BIN, 2);
        for (let x = ax1 - 2; x <= ax1; x++) fixture(x, frontRow, T.COUNTER);
        break;
    }
  }

  // A door through the outer wall (row wy) at column x, with an EXIT sign inside and a concrete pad
  // outside so no car parks in front of it. `inward` is +1 if inside is below the wall, -1 if above.
  function emergencyExit(x, wy, inward) {
    set(x, wy, T.MALLFLOOR);
    for (const k of [1, 2]) set(x, wy - inward * k, T.SIDEWALK);
    decor.push({ type: 'exit', ...at(x, wy + inward) }, { type: 'door', ...at(x, wy), inward });
    lights.push({ ...at(x, wy + inward), r: 28, color: '#ff3030', intensity: 0.6, flicker: 0 });
    spawns.push(at(x, wy - inward * 3));
  }

  // A row of shops facing a concourse. `north` rows have their glass front on y1, south rows on y0.
  function shopRow(x0, x1, y0, y1, n, north) {
    const frontY = north ? y1 : y0;
    const backY = north ? y0 : y1;
    const partY = north ? y0 + 5 : y1 - 5;
    const width = x1 - x0 + 1;
    for (let i = 0; i < n; i++) {
      const theme = themeOrder[nextTheme++ % themeOrder.length];
      const look = THEMES[theme];
      // neighbouring shops share a wall column
      const sx0 = x0 + Math.round(i * (width - 1) / n), sx1 = x0 + Math.round((i + 1) * (width - 1) / n);
      fillFloor(sx0, Math.min(y0, y1), sx1, Math.max(y0, y1), look.floor);
      // stockroom gets bare concrete
      fillFloor(sx0, north ? y0 : partY, sx1, north ? partY : y1, T.MALLFLOOR);
      // walls between shops, glass front, stockroom partition
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { set(sx0, y, T.WALL); set(sx1, y, T.WALL); }
      const mid = Math.floor((sx0 + sx1) / 2);
      for (let x = sx0; x <= sx1; x++) {
        set(x, frontY, x === sx0 || x === sx1 ? T.WALL : Math.abs(x - mid) <= 1 ? T.MALLFLOOR : rand() < 0.18 ? T.MALLFLOOR : T.GLASS);
        set(x, partY, x === sx0 || x === sx1 || Math.abs(x - (mid + 2)) > 0 ? T.WALL : T.MALLFLOOR);
      }
      set(mid + 1, partY, T.MALLFLOOR); // stockroom door is 2 wide
      const floorFrom = north ? partY + 1 : frontY + 1, floorTo = north ? frontY - 1 : partY - 1;
      furnish(theme, sx0 + 1, sx1 - 1, floorFrom + 1, floorTo - 1, mid, north ? floorFrom : floorTo, north ? floorTo : floorFrom);
      // stockroom: boxes, and the dead come shambling out of the back
      for (let k = 0; k < 2; k++) { const bx = sx0 + 4 + Math.floor(rand() * (sx1 - sx0 - 5)), by = north ? backY + 1 + Math.floor(rand() * 3) : backY - 1 - Math.floor(rand() * 3); if (get(bx, by) === T.MALLFLOOR) set(bx, by, T.SHELF); }
      spawns.push(at(mid, north ? backY + 2 : backY - 2));
      // emergency exit out the back of the stockroom
      emergencyExit(sx0 + 2, north ? BY0 : BY1, north ? 1 : -1);
      neon(mid, north ? frontY + 1 : frontY - 1, Math.min(5, sx1 - sx0 - 2), look.neon, look.text);
      if (rand() < 0.75) lights.push({ ...at(mid, (floorFrom + floorTo) / 2), r: 56, color: look.light, intensity: 0.5, flicker: rand() < 0.4 ? 2 : 0 });
    }
  }

  // NW: department store anchor with two entrances, clothing racks and mannequins
  {
    const x0 = BX0 + 1, x1 = VX0 - 1, y0 = BY0 + 1, y1 = HY0 - 1;
    fillFloor(x0, y0, x1, y1, T.CARPET);
    for (let y = y0; y <= y1; y++) set(x1, y, T.WALL);
    for (let x = x0; x <= x1; x++) set(x, y1, Math.abs(x - 15) <= 1 || Math.abs(x - 32) <= 1 ? T.MALLFLOOR : rand() < 0.15 ? T.MALLFLOOR : T.GLASS);
    for (let x = x0; x <= x1; x++) set(x, y0 + 4, Math.abs(x - 24) <= 1 ? T.CARPET : T.WALL); // stockroom
    // clothing racks and mannequins out front, a perfume/makeup counter, shoe wall at the back
    for (let y = y0 + 8; y <= y1 - 3; y += 3) for (let x = x0 + 2; x <= x1 - 2; x += 3) {
      if (Math.abs(x - 24) <= 1) continue;
      if (rand() < 0.72) fixture(x, y, T.RACK, Math.floor(rand() * 3));
      else if (rand() < 0.6) decor.push({ type: 'mannequin', ...at(x, y), v: Math.floor(rand() * 3) });
    }
    for (let x = x0 + 4; x <= x0 + 9; x++) fixture(x, y1 - 2, T.COUNTER);
    for (let x = x0 + 1; x <= x1 - 1; x++) if (Math.abs(x - 24) > 1 && rand() < 0.85) fixture(x, y0 + 5, T.SHELF);
    spawns.push(at(12, y0 + 2), at(34, y0 + 2));
    emergencyExit(10, BY0, 1); emergencyExit(38, BY0, 1);
    neon(15, y1 + 1, 6, '#ff5ab4', 'FASHION'); neon(32, y1 + 1, 6, '#ff5ab4', 'FASHION');
    for (let x = 12; x <= 36; x += 8) lights.push({ ...at(x, 24), r: 60, color: '#bcd8ff', intensity: 0.55, flicker: rand() < 0.5 ? 2 : 0 });
  }
  // NE and SW: rows of three shops
  shopRow(VX1 + 1, BX1 - 1, BY0 + 1, HY0 - 1, 3, true);
  shopRow(BX0, VX0 - 1, HY1 + 1, BY1 - 1, 3, false);

  // SE: food court, open to the concourses. Four counters along the back, each with its own sign:
  // brand 1 McDonald's, 2 Wendy's, 3 pizza, 4 tacos. Kitchens behind, with back doors out.
  {
    const x0 = VX1 + 1, x1 = BX1 - 1, y0 = HY1 + 1, y1 = BY1 - 1;
    const STALL_LIGHT = { 1: '#ffd23a', 2: '#ff4a4a', 3: '#7dff6a', 4: '#ff9a3a' };
    [58, 65, 72, 79].forEach((sx, i) => {
      const brand = i + 1;
      for (let x = sx - 2; x <= sx + 3; x++) fixture(x, y1 - 3, T.COUNTER, brand);
      decor.push({ type: 'stall', x: (sx + 1) * TILE, y: (y1 - 3) * TILE + 2, brand });
      lights.push({ x: (sx + 1) * TILE, y: (y1 - 4) * TILE, r: 50, color: STALL_LIGHT[brand], intensity: 0.65, flicker: rand() < 0.3 ? 2 : 0 });
      spawns.push(at(sx + 1, y1 - 1));
    });
    emergencyExit(60, BY1, -1); emergencyExit(82, BY1, -1);
    for (let y = y0 + 2; y <= y1 - 6; y += 3) for (let x = x0 + 3; x <= x1 - 3; x += 4) if (rand() < 0.8) set(x, y, T.TABLE);
    for (let x = x0 + 4; x <= x1 - 4; x += 8) lights.push({ ...at(x, y0 + 7), r: 64, color: '#cfe8ff', intensity: 0.6, flicker: rand() < 0.45 ? 2 : 0 });
  }

  // atrium: a dry, murky fountain under a broken skylight, planters on the corners
  for (let y = HY0; y <= HY1; y++) for (let x = VX0; x <= VX1; x++) {
    if (((x + 0.5 - CX) / 3.1) ** 2 + ((y + 0.5 - CY) / 2.3) ** 2 <= 1) set(x, y, T.WATER);
  }
  for (const [px, py] of [[VX0 + 1, HY0 + 1], [VX1 - 1, HY0 + 1], [VX0 + 1, HY1 - 1], [VX1 - 1, HY1 - 1]]) set(px, py, T.PLANTER);
  lights.push({ x: CX * TILE, y: CY * TILE, r: 120, color: '#7a9cff', intensity: 0.42, flicker: 0 }); // moonlight through the skylight
  decor.push({ type: 'skylight', x: CX * TILE, y: CY * TILE });

  // concourse dressing: planters, kiosks and the ceiling lights
  for (const x of [14, 26, 36, 60, 70, 82]) {
    if (rand() < 0.5) { set(x, 39, T.COUNTER); set(x + 1, 39, T.COUNTER); decor.push({ type: 'kiosk', ...at(x + 0.5, 39) }); }
    else { set(x, 39, T.PLANTER); set(x, 40, T.PLANTER); }
  }
  for (let x = 10; x < BX1; x += 7) if (x < VX0 - 1 || x > VX1 + 1) { fluoro(x, 36); fluoro(x + 3, 43); }
  for (let y = BY0 + 3; y < BY1 - 1; y += 7) if (y < HY0 - 1 || y > HY1 + 1) { fluoro(45, y); fluoro(50, y + 3); }
  for (let i = 0; i < 9; i++) { // abandoned shopping carts
    const x = 8 + Math.floor(rand() * 80), y = HY0 + 1 + Math.floor(rand() * 10);
    if (get(x, y) === T.MALLFLOOR) decor.push({ type: 'cart', ...at(x, y), a: rand() * Math.PI * 2 });
  }

  // entrances (doors blown open) with exit signs, and zombies wandering in from the lot
  const exits = [[46, BY0, 49, BY0], [46, BY1, 49, BY1], [BX0, 38, BX0, 41], [BX1, 38, BX1, 41]];
  for (const [ax, ay, bx, by] of exits) {
    fill(ax, ay, bx, by, T.MALLFLOOR);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const inX = mx === BX0 ? 1 : mx === BX1 ? -1 : 0, inY = my === BY0 ? 1 : my === BY1 ? -1 : 0;
    decor.push({ type: 'exit', ...at(mx + inX, my + inY) });
    lights.push({ ...at(mx + inX, my + inY), r: 30, color: '#ff3030', intensity: 0.6, flicker: 0 });
    spawns.push(at(mx - inX * 4, my - inY * 4));
  }

  // parking lot: cars in the stalls (some burnt out) and a few working lamps
  const car = (tx, ty, vertical) => {
    const w = vertical ? 1 : 2, h = vertical ? 2 : 1;
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (get(x, y) !== T.PARKING) return;
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) set(x, y, T.HOUSE);
    const colors = ['#5a1a1a', '#1a2a4a', '#2a3a2a', '#4a4a50', '#6a5a2a', '#2a2a2e', '#7a7a80'];
    houses.push({ kind: 'car', x: tx * TILE, y: ty * TILE, w: w * TILE, h: h * TILE, vertical, roof: colors[Math.floor(rand() * colors.length)], burnt: rand() < 0.2, facing: 's' });
  };
  for (const row of [4, 9]) for (let x = 4; x < 92; x += 2) if (rand() < 0.45 && Math.abs(x - 47.5) > 4) car(x, row, true);
  for (let y = 18; y < 62; y += 3) { if (rand() < 0.4) car(2, y, false); if (rand() < 0.4) car(92, y, false); }
  for (let x = 6; x < 92; x += 4) if (rand() < 0.4 && Math.abs(x - 47.5) > 4) car(x, 67, false);
  for (const x of [10, 30, 66, 86]) {
    decor.push({ type: 'lamp', ...at(x, 7) });
    if (rand() < 0.7) lights.push({ ...at(x, 7), r: 80, color: '#ffcf7a', intensity: 0.8, flicker: rand() < 0.3 ? 2 : 0 });
  }
  for (let x = 6; x < 92; x += 10) spawns.push(at(x, 3));
  spawns.push(at(3, 30), at(3, 50), at(92, 30), at(92, 50), at(20, 68), at(75, 68));

  // tree line border, like the other maps
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) set(x, y, T.HEDGE);

  const keep = list => list.filter(s => !SOLID.has(get(Math.floor(s.x / TILE), Math.floor(s.y / TILE))));
  return {
    w: W, h: H, tiles, floor, variant, houses,
    // decor that's part of a fixture (screens, TVs, fish tanks...) is allowed on solid tiles
    decor: decor.filter(d => ON_FIXTURE.has(d.type) || !SOLID.has(get(Math.floor(d.x / TILE), Math.floor(d.y / TILE)))),
    lights, spawns: keep(spawns),
    playerSpawn: { x: CX * TILE, y: (HY0 + 1) * TILE + 8 },
    cemetery: null,
    indoor: true,
  };
}

export function isSolidTile(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return SOLID.has(map.tiles[ty * map.w + tx]);
}

export function isSolidAt(map, px, py) {
  return isSolidTile(map, Math.floor(px / TILE), Math.floor(py / TILE));
}

// Advances a projectile by dt. Bouncing ones (grenades) reflect off walls and lose speed.
export function stepProjectile(map, b, dt) {
  const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
  b.dist += Math.hypot(b.vx, b.vy) * dt;
  if (!b.bounce) { b.x = nx; b.y = ny; return; }
  if (isSolidAt(map, nx, b.y)) b.vx *= -0.6; else b.x = nx;
  if (isSolidAt(map, b.x, ny)) b.vy *= -0.6; else b.y = ny;
}

function circleHitsTiles(map, x, y, r) {
  const minX = Math.floor((x - r) / TILE), maxX = Math.floor((x + r) / TILE);
  const minY = Math.floor((y - r) / TILE), maxY = Math.floor((y + r) / TILE);
  for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
    if (!isSolidTile(map, tx, ty)) continue;
    const nx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
    const ny = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
    if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
  }
  return false;
}

// Moves a circle by (dx, dy), sliding along walls. Returns the new position.
export function moveCircle(map, x, y, dx, dy, r) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
  const sx = dx / steps, sy = dy / steps;
  // Already overlapping a wall (spawned or shoved into it): let it move freely so it can escape.
  if (circleHitsTiles(map, x, y, r)) return { x: x + dx, y: y + dy };
  for (let i = 0; i < steps; i++) {
    if (!circleHitsTiles(map, x + sx, y, r)) x += sx;
    if (!circleHitsTiles(map, x, y + sy, r)) y += sy;
  }
  return { x, y };
}
