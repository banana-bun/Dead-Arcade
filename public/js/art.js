// Procedural pixel art: the pre-rendered map plus sprites drawn each frame.
import { TILE, DROP_TYPES } from '/shared/config.js';
import { T, FIXTURES, mulberry32 } from '/shared/map.js';

const px = (ctx, x, y, w = 1, h = 1) => ctx.fillRect(Math.round(x), Math.round(y), w, h);

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function renderMapBackground(map) {
  const cv = document.createElement('canvas');
  cv.width = map.w * TILE; cv.height = map.h * TILE;
  const ctx = cv.getContext('2d');
  const rand = mulberry32(777);
  const tile = (x, y) => (x < 0 || y < 0 || x >= map.w || y >= map.h) ? T.HEDGE : map.tiles[y * map.w + x];
  const variant = (x, y) => map.variant?.[y * map.w + x] ?? 0;
  const isRoad = (x, y) => tile(x, y) === T.ROAD;

  const noiseFill = (x0, y0, base, specks, density) => {
    ctx.fillStyle = base; ctx.fillRect(x0, y0, TILE, TILE);
    for (let i = 0; i < TILE * TILE * density; i++) {
      ctx.fillStyle = specks[Math.floor(rand() * specks.length)];
      px(ctx, x0 + rand() * TILE, y0 + rand() * TILE);
    }
  };

  // ground pass
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    const x0 = tx * TILE, y0 = ty * TILE, t = tile(tx, ty);
    // fixtures (shelves, cabinets...) are drawn later, on top of whatever floor the shop has
    const ground = FIXTURES.has(t) ? map.floor?.[ty * map.w + tx] || (t === T.SHELF ? T.CARPET : T.MALLFLOOR) : t;
    switch (ground) {
      case T.ROAD: {
        noiseFill(x0, y0, '#25252c', ['#2c2c34', '#1f1f25', '#303038'], 0.25);
        const vert = isRoad(tx, ty - 1) && isRoad(tx, ty + 1) && !(isRoad(tx - 3, ty) && isRoad(tx + 3, ty));
        const horz = isRoad(tx - 1, ty) && isRoad(tx + 1, ty) && !(isRoad(tx, ty - 3) && isRoad(tx, ty + 3));
        ctx.fillStyle = '#8a7a2a';
        // dashed center lines sit on the seam between the two middle road tiles
        if (vert && tile(tx + 1, ty) === T.ROAD && tile(tx + 2, ty) === T.ROAD && tile(tx - 1, ty) === T.ROAD && tile(tx - 2, ty) !== T.ROAD) {
          if (ty % 2 === 0) ctx.fillRect(x0 + TILE - 1, y0 + 2, 2, 10);
        }
        if (horz && tile(tx, ty + 1) === T.ROAD && tile(tx, ty + 2) === T.ROAD && tile(tx, ty - 1) === T.ROAD && tile(tx, ty - 2) !== T.ROAD) {
          if (tx % 2 === 0) ctx.fillRect(x0 + 2, y0 + TILE - 1, 10, 2);
        }
        // cracks
        if (rand() < 0.08) { ctx.fillStyle = '#17171c'; for (let i = 0, cx = x0 + rand() * 16, cy = y0 + rand() * 16; i < 6; i++) { px(ctx, cx, cy); cx += rand() * 2 - 0.5; cy += rand() * 2 - 1; } }
        break;
      }
      case T.SIDEWALK:
        noiseFill(x0, y0, '#45444c', ['#4c4b54', '#3d3c44'], 0.15);
        ctx.fillStyle = '#36353c';
        ctx.fillRect(x0, y0, TILE, 1); ctx.fillRect(x0, y0, 1, TILE);
        break;
      case T.DRIVEWAY:
        noiseFill(x0, y0, '#3b3936', ['#423f3b', '#33312e'], 0.2);
        if (rand() < 0.15) { ctx.fillStyle = '#2a2826'; ctx.fillRect(x0 + 4 + rand() * 6, y0 + 4 + rand() * 6, 3, 2); }
        break;
      case T.DIRT:
        noiseFill(x0, y0, '#33251b', ['#3d2c20', '#2a1e16', '#45321f'], 0.3);
        break;
      case T.PATCH:
        noiseFill(x0, y0, '#2e2318', ['#3a2c1e', '#253818', '#2f4a1c'], 0.35);
        ctx.fillStyle = '#2f5a20';
        for (let i = 0; i < 3; i++) px(ctx, x0 + rand() * 16, y0 + rand() * 16, 2, 1);
        break;
      case T.SOIL:
      case T.CORN: // corn stalks are painted in their own pass below
        noiseFill(x0, y0, '#281c12', ['#30221a', '#21170f', '#3a2a1c'], 0.3);
        ctx.fillStyle = '#1e140c';
        for (let i = 3; i < TILE; i += 5) ctx.fillRect(x0 + i, y0, 1, TILE); // furrows
        if (t === T.SOIL && rand() < 0.15) { ctx.fillStyle = '#8a7a3a'; px(ctx, x0 + rand() * 14, y0 + rand() * 14, 2, 1); } // fallen husks
        break;
      case T.WATER: {
        noiseFill(x0, y0, '#0b1424', ['#0e1a2e', '#09101c', '#122038'], 0.3);
        ctx.fillStyle = '#1e3050';
        for (let i = 0; i < 2; i++) if (rand() < 0.5) px(ctx, x0 + rand() * 12, y0 + rand() * 15, 3 + rand() * 3, 1);
        if (rand() < 0.03) { ctx.fillStyle = '#2a4a1e'; ctx.fillRect(x0 + 4, y0 + 5, 6, 5); ctx.fillStyle = '#d8d0e8'; px(ctx, x0 + 6, y0 + 6, 2, 2); } // lily pad
        const nearBank = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tile(tx + dx, ty + dy) !== T.WATER);
        if (nearBank) { ctx.fillStyle = 'rgba(60,44,28,0.55)'; ctx.fillRect(x0, y0, TILE, TILE); }
        break;
      }
      case T.FIRE:
        noiseFill(x0, y0, '#33251b', ['#3d2c20', '#2a1e16'], 0.3);
        ctx.fillStyle = '#5a5a62';
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) px(ctx, x0 + 7 + Math.cos(a) * 7, y0 + 7 + Math.sin(a) * 7, 2, 2);
        ctx.fillStyle = '#120a06'; ctx.fillRect(x0 + 3, y0 + 3, 10, 10);
        ctx.fillStyle = '#4a2a16'; ctx.fillRect(x0 + 2, y0 + 7, 12, 2); ctx.fillRect(x0 + 7, y0 + 2, 2, 12);
        break;
      case T.HAY:
        noiseFill(x0, y0, '#33251b', ['#3d2c20', '#2a1e16'], 0.3);
        break;
      case T.MALLFLOOR: case T.WALL: case T.GLASS: case T.TABLE: case T.COUNTER: case T.PLANTER: {
        // grimy checkerboard tile floor (also under walls and fixtures)
        for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
          ctx.fillStyle = (tx * 2 + qx + ty * 2 + qy) % 2 ? '#3a3640' : '#2e2b34';
          ctx.fillRect(x0 + qx * 8, y0 + qy * 8, 8, 8);
        }
        ctx.fillStyle = '#211e26'; ctx.fillRect(x0, y0, TILE, 1); ctx.fillRect(x0, y0, 1, TILE);
        for (let i = 0; i < 10; i++) { ctx.fillStyle = ['#26232c', '#44404c', '#1e1b22'][Math.floor(rand() * 3)]; px(ctx, x0 + rand() * 16, y0 + rand() * 16); }
        if (rand() < 0.07) { ctx.fillStyle = '#d8d0c0'; px(ctx, x0 + rand() * 13, y0 + rand() * 13, 3, 2); } // dropped receipt
        else if (rand() < 0.05) { ctx.fillStyle = ['#c83a3a', '#3a8ac8', '#c8a83a'][Math.floor(rand() * 3)]; px(ctx, x0 + rand() * 13, y0 + rand() * 13, 2, 1); } // can
        if (rand() < 0.06) { ctx.fillStyle = '#18161c'; for (let i = 0, cx = x0 + rand() * 16, cy = y0 + rand() * 16; i < 7; i++) { px(ctx, cx, cy); cx += rand() * 2 - 0.5; cy += rand() * 2 - 1; } }
        // glass shards scattered in front of smashed storefronts
        if (t === T.MALLFLOOR && [[0, 1], [0, -1]].some(([dx, dy]) => tile(tx + dx, ty + dy) === T.GLASS)) {
          ctx.fillStyle = 'rgba(170,215,240,0.55)';
          for (let i = 0; i < 5; i++) px(ctx, x0 + rand() * 15, y0 + rand() * 15);
        }
        break;
      }
      case T.WOODFLOOR: {
        // varnished plank floor, scuffed
        ctx.fillStyle = '#3a2618'; ctx.fillRect(x0, y0, TILE, TILE);
        for (let py = 0; py < TILE; py += 4) {
          ctx.fillStyle = ['#432c1c', '#3e2a1a', '#4a301e'][(ty * 4 + py / 4 + tx) % 3];
          ctx.fillRect(x0, y0 + py, TILE, 3);
          ctx.fillStyle = '#2a1a10'; ctx.fillRect(x0 + ((ty * 7 + py * 3 + tx * 5) % 16), y0 + py, 1, 3); // plank ends
        }
        for (let i = 0; i < 4; i++) { ctx.fillStyle = '#2e1e12'; px(ctx, x0 + rand() * 15, y0 + rand() * 15, 2, 1); }
        break;
      }
      case T.LINO: {
        // big pale vinyl tiles, yellowed and dirty
        noiseFill(x0, y0, '#5a5852', ['#62605a', '#52504a', '#4a4842'], 0.25);
        ctx.fillStyle = '#44423c'; ctx.fillRect(x0, y0, TILE, 1); ctx.fillRect(x0, y0, 1, TILE);
        if (rand() < 0.15) { ctx.fillStyle = 'rgba(30,26,20,0.4)'; ctx.fillRect(x0 + 2 + rand() * 8, y0 + 2 + rand() * 8, 5, 4); }
        break;
      }
      case T.CARPET:
      case T.SHELF: {
        // 90s mall carpet: dark base with confetti squiggles
        noiseFill(x0, y0, '#241c2c', ['#2a2134', '#1e1826', '#2c2238'], 0.3);
        const confetti = ['#2a8a8a', '#a83a8a', '#a88a2a', '#3a5aa8'];
        for (let i = 0; i < 3; i++) { ctx.fillStyle = confetti[Math.floor(rand() * 4)]; const cx = x0 + rand() * 13, cy = y0 + rand() * 14; px(ctx, cx, cy, 2, 1); px(ctx, cx + 2, cy + 1); }
        if (rand() < 0.08) { ctx.fillStyle = '#16121a'; ctx.fillRect(x0 + 3 + rand() * 6, y0 + 3 + rand() * 6, 4, 3); } // stain
        break;
      }
      case T.PARKING: {
        noiseFill(x0, y0, '#222228', ['#28282e', '#1c1c22', '#2c2c32'], 0.25);
        ctx.fillStyle = '#8a8a80';
        if ((ty >= 4 && ty <= 5) || (ty >= 9 && ty <= 10)) { if (tx % 2 === 0) ctx.fillRect(x0, y0, 1, TILE); } // stall lines
        if ((tx >= 2 && tx <= 3) || (tx >= 92 && tx <= 93)) { if (ty % 3 === 0) ctx.fillRect(x0, y0, TILE, 1); }
        if (rand() < 0.05) { ctx.fillStyle = 'rgba(10,10,14,0.7)'; ctx.beginPath(); ctx.ellipse(x0 + 8, y0 + 8, 4 + rand() * 3, 3, 0, 0, Math.PI * 2); ctx.fill(); } // oil
        break;
      }
      default: {
        noiseFill(x0, y0, '#1b3022', ['#203826', '#172a1d', '#24402a', '#1a2c20'], 0.45);
        if (rand() < 0.35) { // fallen leaves
          const leaf = ['#7a3a12', '#9a5016', '#6a2a10', '#8a6a1a'];
          for (let i = 0; i < 1 + rand() * 3; i++) { ctx.fillStyle = leaf[Math.floor(rand() * leaf.length)]; px(ctx, x0 + rand() * 15, y0 + rand() * 15, 2, 1); }
        }
        if (rand() < 0.1) { ctx.fillStyle = '#2a4a2e'; px(ctx, x0 + rand() * 14, y0 + rand() * 14, 1, 2); }
      }
    }
  }

  // fences, graves, hedges
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    const x0 = tx * TILE, y0 = ty * TILE, t = tile(tx, ty);
    if (t === T.FENCE) {
      const cemetery = nearCemetery(map, tx, ty);
      const horiz = tile(tx - 1, ty) === T.FENCE || tile(tx + 1, ty) === T.FENCE;
      const post = cemetery ? '#1a1a22' : '#6a5a48';
      const rail = cemetery ? '#2a2a34' : '#857260';
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (horiz) ctx.fillRect(x0, y0 + 9, TILE, 3); else ctx.fillRect(x0 + 8, y0, 3, TILE);
      ctx.fillStyle = rail;
      if (horiz) { ctx.fillRect(x0, y0 + 6, TILE, 2); } else { ctx.fillRect(x0 + 6, y0, 2, TILE); }
      ctx.fillStyle = post;
      for (let i = 1; i < TILE; i += 4) {
        if (horiz) { ctx.fillRect(x0 + i, y0 + 4, 2, 5); if (cemetery) px(ctx, x0 + i, y0 + 3, 2, 1); }
        else { ctx.fillRect(x0 + 5, y0 + i, 4, 2); }
      }
    } else if (t === T.GRAVE) {
      ctx.fillStyle = '#2a1e16'; ctx.fillRect(x0 + 3, y0 + 9, 10, 7); // mound
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x0 + 5, y0 + 4, 8, 9);
      const stone = rand() < 0.5 ? '#6a6a74' : '#5a5e66';
      ctx.fillStyle = stone; ctx.fillRect(x0 + 4, y0 + 3, 8, 9); ctx.fillRect(x0 + 5, y0 + 2, 6, 1);
      ctx.fillStyle = shade('#6a6a74', 0.25); ctx.fillRect(x0 + 4, y0 + 3, 1, 9);
      ctx.fillStyle = '#3a3a42';
      if (rand() < 0.5) { ctx.fillRect(x0 + 7, y0 + 4, 2, 6); ctx.fillRect(x0 + 5, y0 + 6, 6, 2); }
      else { ctx.fillRect(x0 + 5, y0 + 5, 6, 1); ctx.fillRect(x0 + 5, y0 + 7, 6, 1); ctx.fillRect(x0 + 6, y0 + 9, 4, 1); }
    } else if (t === T.HEDGE) {
      ctx.fillStyle = '#0f2014'; ctx.fillRect(x0, y0, TILE, TILE);
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = ['#16301c', '#1c3a22', '#0b170e', '#21402a'][Math.floor(rand() * 4)];
        px(ctx, x0 + rand() * 15, y0 + rand() * 15, 2, 2);
      }
    } else if (t === T.HAY) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x0 + 3, y0 + 4, TILE, 12);
      ctx.fillStyle = '#a8862a'; ctx.fillRect(x0 + 1, y0 + 2, 14, 11);
      ctx.fillStyle = '#c8a440'; ctx.fillRect(x0 + 1, y0 + 2, 14, 3);
      ctx.fillStyle = '#7a5e1a';
      for (let i = 0; i < 12; i++) px(ctx, x0 + 1 + rand() * 13, y0 + 5 + rand() * 7);
      ctx.fillStyle = '#5a3a1a'; ctx.fillRect(x0 + 4, y0 + 2, 1, 11); ctx.fillRect(x0 + 11, y0 + 2, 1, 11); // twine
    } else if (t === T.WALL) {
      // concrete wall seen from above: a lit top face with a shadow cast below
      ctx.fillStyle = '#17151b'; ctx.fillRect(x0, y0, TILE, TILE);
      ctx.fillStyle = '#25232b'; ctx.fillRect(x0, y0, TILE, TILE - 3);
      ctx.fillStyle = '#2f2d36';
      for (let i = 0; i < 6; i++) px(ctx, x0 + rand() * 15, y0 + rand() * 11, 2, 1);
      if (tile(tx, ty - 1) !== T.WALL) { ctx.fillStyle = '#3a3842'; ctx.fillRect(x0, y0, TILE, 1); }
      if (tile(tx, ty + 1) !== T.WALL && tile(tx, ty + 1) !== T.HEDGE) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0, y0 + TILE, TILE, 4); }
    } else if (t === T.GLASS) {
      // storefront window: metal frame, pale pane, the odd crack
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x0, y0 + 9, TILE, 3);
      ctx.fillStyle = 'rgba(120,180,220,0.28)'; ctx.fillRect(x0, y0 + 5, TILE, 5);
      ctx.fillStyle = 'rgba(210,235,255,0.35)'; px(ctx, x0 + 3, y0 + 5, 4, 1);
      ctx.fillStyle = '#4a4a54'; ctx.fillRect(x0, y0 + 4, TILE, 1); ctx.fillRect(x0, y0 + 10, TILE, 1);
      if (tx % 3 === 0) ctx.fillRect(x0, y0 + 4, 1, 7);
      if (rand() < 0.35) { ctx.fillStyle = 'rgba(230,245,255,0.6)'; const cx = x0 + 3 + rand() * 10; px(ctx, cx, y0 + 6); px(ctx, cx + 1, y0 + 7); px(ctx, cx - 1, y0 + 8); px(ctx, cx + 2, y0 + 8); }
    } else if (t === T.SHELF && variant(tx, ty) === 4) {
      // pet store cage: wire box, some doors hanging open
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0 + 2, y0 + 4, TILE - 1, 11);
      ctx.fillStyle = '#2a2a30'; ctx.fillRect(x0 + 1, y0 + 2, 14, 11);
      ctx.fillStyle = '#8a8a96';
      for (let i = 1; i < 15; i += 2) ctx.fillRect(x0 + i, y0 + 2, 1, 11);
      ctx.fillRect(x0 + 1, y0 + 2, 14, 1); ctx.fillRect(x0 + 1, y0 + 12, 14, 1);
      ctx.fillStyle = '#c8a86a'; ctx.fillRect(x0 + 3, y0 + 10, 9, 2); // wood shavings
      if (rand() < 0.4) { ctx.fillStyle = '#2a2a30'; ctx.fillRect(x0 + 5, y0 + 4, 5, 6); } // empty, door open
    } else if (t === T.SHELF && variant(tx, ty) === 5) {
      // fitting room: a little booth with a half-drawn curtain
      ctx.fillStyle = '#25232b'; ctx.fillRect(x0, y0, TILE, TILE);
      ctx.fillStyle = '#3a3842'; ctx.fillRect(x0, y0, TILE, 1);
      ctx.fillStyle = '#6a2a4a'; ctx.fillRect(x0 + 2, y0 + 10, 7, 4);
      ctx.fillStyle = '#8a3a62'; for (let i = 2; i < 9; i += 2) ctx.fillRect(x0 + i, y0 + 10, 1, 4);
    } else if (t === T.CABINET) {
      // arcade cabinet from above: marquee, glowing screen, control panel (the glow is animated per frame)
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x0 + 3, y0 + 3, 13, 13);
      ctx.fillStyle = '#1a1424'; ctx.fillRect(x0 + 1, y0 + 1, 14, 14);
      ctx.fillStyle = ['#c83a8a', '#3a8ac8', '#c8a83a', '#3ac87a'][Math.floor(rand() * 4)]; ctx.fillRect(x0 + 1, y0 + 1, 14, 2);
      ctx.fillStyle = '#0a0a12'; ctx.fillRect(x0 + 3, y0 + 4, 10, 6);
      ctx.fillStyle = '#2a2a34'; ctx.fillRect(x0 + 2, y0 + 11, 12, 3);
      ctx.fillStyle = '#e83a3a'; px(ctx, x0 + 5, y0 + 12); ctx.fillStyle = '#3ae83a'; px(ctx, x0 + 9, y0 + 12); ctx.fillStyle = '#3a3ae8'; px(ctx, x0 + 11, y0 + 12);
    } else if (t === T.BOOKSHELF) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0 + 2, y0 + 4, TILE, 10);
      ctx.fillStyle = '#3a2414'; ctx.fillRect(x0, y0 + 2, TILE, 11);
      ctx.fillStyle = '#5a3a20'; ctx.fillRect(x0, y0 + 2, TILE, 1); ctx.fillRect(x0, y0 + 7, TILE, 1);
      const spines = ['#8a2a2a', '#2a4a8a', '#2a6a3a', '#8a7a2a', '#5a2a6a', '#c8c0a8', '#1a1a1a'];
      for (const row of [3, 8]) for (let i = 0; i < 16; i += 2) if (rand() < 0.75) { ctx.fillStyle = spines[Math.floor(rand() * spines.length)]; ctx.fillRect(x0 + i, y0 + row, 2, 4); }
      if (rand() < 0.3) { ctx.fillStyle = '#c8c0a8'; ctx.fillRect(x0 + rand() * 10, y0 + 13, 4, 2); } // book on the floor
    } else if (t === T.TVWALL) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x0, y0 + 12, TILE, 3);
      ctx.fillStyle = '#141418'; ctx.fillRect(x0, y0 + 1, TILE, 12);
      ctx.fillStyle = '#2a2a30'; ctx.fillRect(x0 + 1, y0 + 2, 14, 9);
      ctx.fillStyle = '#0a0e14'; ctx.fillRect(x0 + 2, y0 + 3, 12, 7);
      if (rand() < 0.3) { ctx.fillStyle = 'rgba(220,235,255,0.5)'; px(ctx, x0 + 4, y0 + 4); px(ctx, x0 + 5, y0 + 5); px(ctx, x0 + 6, y0 + 4); } // smashed screen
    } else if (t === T.TANK) {
      // aquarium: dark frame, blue water and weed (fish swim in the per-frame layer)
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0 + 2, y0 + 4, TILE - 1, 11);
      ctx.fillStyle = '#1a1a20'; ctx.fillRect(x0, y0 + 2, TILE, 11);
      ctx.fillStyle = '#0e2a3a'; ctx.fillRect(x0 + 1, y0 + 3, 14, 9);
      ctx.fillStyle = '#c8b88a'; ctx.fillRect(x0 + 1, y0 + 10, 14, 2); // gravel
      ctx.fillStyle = '#2a6a3a'; for (const wx of [3, 9, 12]) ctx.fillRect(x0 + wx, y0 + 6 + (wx % 3), 1, 4);
      if (rand() < 0.25) { ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x0 + 1, y0 + 3, 14, 9); ctx.fillStyle = 'rgba(200,230,255,0.5)'; px(ctx, x0 + 4, y0 + 5); px(ctx, x0 + 6, y0 + 7); } // drained and cracked
    } else if (t === T.RACK) {
      // round clothing rack seen from above: a ring of hanging clothes
      const palettes = [['#8a2a4a', '#c84a7a', '#e8a8c8'], ['#2a4a8a', '#4a7ac8', '#c8d8e8'], ['#4a4a2a', '#8a7a3a', '#e8d8a8']];
      const pal = palettes[variant(tx, ty) % 3];
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(x0 + 10, y0 + 10, 7, 0, Math.PI * 2); ctx.fill();
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        if (rand() < 0.2) continue; // gaps where clothes were grabbed
        ctx.fillStyle = pal[Math.floor(rand() * 3)];
        ctx.fillRect(Math.round(x0 + 8 + Math.cos(a) * 5) - 1, Math.round(y0 + 8 + Math.sin(a) * 5) - 1, 3, 3);
      }
      ctx.fillStyle = '#8a8a96'; ctx.fillRect(x0 + 7, y0 + 7, 2, 2);
    } else if (t === T.INSTRUMENT) {
      const v = variant(tx, ty);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0 + 2, y0 + 4, TILE - 1, 11);
      if (v === 1) { // upright piano / keyboard: dark case with a row of keys
        ctx.fillStyle = '#1a1214'; ctx.fillRect(x0, y0 + 2, TILE, 11);
        ctx.fillStyle = '#3a2a2a'; ctx.fillRect(x0, y0 + 2, TILE, 1);
        ctx.fillStyle = '#f0ece0'; ctx.fillRect(x0, y0 + 9, TILE, 4);
        ctx.fillStyle = '#141414'; for (let i = 1; i < TILE; i += 2) if (i % 7 !== 5) ctx.fillRect(x0 + i, y0 + 9, 1, 2);
      } else if (v === 2) { // amp stack: black box, grille cloth and knobs
        ctx.fillStyle = '#141416'; ctx.fillRect(x0 + 1, y0 + 1, 14, 13);
        ctx.fillStyle = '#2a2a30'; ctx.fillRect(x0 + 2, y0 + 5, 12, 8);
        ctx.fillStyle = '#3a3a42'; for (let i = 3; i < 14; i += 2) ctx.fillRect(x0 + i, y0 + 6, 1, 6);
        ctx.fillStyle = '#c8a040'; ctx.fillRect(x0 + 2, y0 + 2, 12, 2);
        ctx.fillStyle = '#e8e8e8'; for (let i = 3; i < 14; i += 3) px(ctx, x0 + i, y0 + 2);
      } else { // guitar stand with three guitars
        ctx.fillStyle = '#2a2a30'; ctx.fillRect(x0 + 1, y0 + 12, 14, 2);
        for (let i = 0; i < 3; i++) {
          const gx = x0 + 2 + i * 5;
          ctx.fillStyle = ['#c83a2a', '#e8c83a', '#3a6ac8', '#1a1a1a', '#e8e8e8', '#6a3a1a'][Math.floor(rand() * 6)];
          ctx.fillRect(gx, y0 + 7, 4, 5); ctx.fillRect(gx + 1, y0 + 6, 2, 1);
          ctx.fillStyle = '#5a3a20'; ctx.fillRect(gx + 1, y0 + 1, 1, 5);
          ctx.fillStyle = '#1a1a1a'; px(ctx, gx + 1, y0 + 9);
        }
      }
    } else if (t === T.PEN) {
      // pet play pen: straw on the floor, a low white fence around the 2x2 block
      ctx.fillStyle = '#c8a860'; ctx.fillRect(x0, y0, TILE, TILE);
      ctx.fillStyle = '#a88a48'; for (let i = 0; i < 10; i++) px(ctx, x0 + rand() * 15, y0 + rand() * 15, 2, 1);
      ctx.fillStyle = '#e8e8f0';
      if (tile(tx, ty - 1) !== T.PEN) ctx.fillRect(x0, y0, TILE, 2);
      if (tile(tx, ty + 1) !== T.PEN) ctx.fillRect(x0, y0 + TILE - 2, TILE, 2);
      if (tile(tx - 1, ty) !== T.PEN) ctx.fillRect(x0, y0, 2, TILE);
      if (tile(tx + 1, ty) !== T.PEN) ctx.fillRect(x0 + TILE - 2, y0, 2, TILE);
      if ((tx + ty) % 2 === 0) { ctx.fillStyle = '#5a8ac8'; ctx.fillRect(x0 + 10, y0 + 10, 3, 2); } // water bowl
    } else if (t === T.BIN && variant(tx, ty) === 7) {
      // bookstore display table: stacks of new releases
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x0 + 2, y0 + 4, TILE - 1, 11);
      ctx.fillStyle = '#6a4424'; ctx.fillRect(x0, y0 + 3, TILE, 10);
      ctx.fillStyle = '#8a5a30'; ctx.fillRect(x0, y0 + 3, TILE, 1);
      for (let i = 0; i < 3; i++) for (let k = 0; k < 2 + Math.floor(rand() * 2); k++) {
        ctx.fillStyle = ['#8a2a2a', '#2a4a8a', '#2a6a3a', '#c8a83a', '#e8e0d0', '#5a2a6a'][Math.floor(rand() * 6)];
        ctx.fillRect(x0 + 1 + i * 5, y0 + 9 - k * 2, 4, 2);
      }
    } else if (t === T.BIN) {
      // display bin: toys, candy or vinyl records depending on the shop
      const v = variant(tx, ty);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0 + 2, y0 + 4, TILE - 1, 11);
      ctx.fillStyle = v === 3 ? '#3a2414' : v === 2 ? '#e8e8f0' : '#c83a3a'; ctx.fillRect(x0 + 1, y0 + 2, 14, 11);
      ctx.fillStyle = v === 3 ? '#5a3a20' : v === 2 ? '#c8c8d8' : '#e85a5a'; ctx.fillRect(x0 + 1, y0 + 2, 14, 1);
      if (v === 3) { // records standing in a crate
        for (let i = 2; i < 14; i += 2) { ctx.fillStyle = rand() < 0.5 ? '#141414' : ['#c83a3a', '#e8c83a', '#3a8ac8', '#e8e8e8'][Math.floor(rand() * 4)]; ctx.fillRect(x0 + i, y0 + 4, 1, 8); }
      } else {
        const stuff = v === 2 ? ['#ff3df2', '#ffe45a', '#7dff6a', '#5ad1ff', '#ff5a5a', '#ffffff', '#b56cff'] : ['#ffe45a', '#3a8ac8', '#7dff6a', '#e88a3a', '#b56cff', '#c8c8d0'];
        for (let i = 0; i < (v === 2 ? 22 : 9); i++) { ctx.fillStyle = stuff[Math.floor(rand() * stuff.length)]; px(ctx, x0 + 2 + rand() * 11, y0 + 4 + rand() * 7, v === 2 ? 1 : 2, v === 2 ? 1 : 2); }
      }
    } else if (t === T.SHELF) {
      // gondola shelf, mostly looted
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0 + 2, y0 + 4, TILE, 10);
      ctx.fillStyle = '#5a5a64'; ctx.fillRect(x0, y0 + 2, TILE, 10);
      ctx.fillStyle = '#6e6e7a'; ctx.fillRect(x0, y0 + 2, TILE, 1);
      ctx.fillStyle = '#3a3a44'; ctx.fillRect(x0, y0 + 7, TILE, 1);
      const goods = ['#c83a3a', '#3a8ac8', '#e8c83a', '#7ac83a', '#e88a3a', '#c8c8d0', '#8a3ac8'];
      for (let i = 0; i < 6; i++) if (rand() < 0.55) { ctx.fillStyle = goods[Math.floor(rand() * goods.length)]; ctx.fillRect(x0 + 1 + i * 2.5, y0 + (rand() < 0.5 ? 3 : 8), 2, 3); }
    } else if (t === T.TABLE) {
      // food court table with chairs, some knocked over
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(x0 + 10, y0 + 10, 6, 0, Math.PI * 2); ctx.fill();
      const chair = ['#c84a2a', '#e8a82a', '#2a8ac8'][Math.floor(rand() * 3)];
      ctx.fillStyle = chair;
      for (const [cx, cy] of [[1, 6], [12, 6], [6, 1], [6, 12]]) if (rand() < 0.8) ctx.fillRect(x0 + cx, y0 + cy, 3, 3);
      ctx.fillStyle = '#6a6a74'; ctx.beginPath(); ctx.arc(x0 + 8, y0 + 8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a8a96'; px(ctx, x0 + 5, y0 + 5, 3, 1);
      if (rand() < 0.4) { ctx.fillStyle = '#d8d0c0'; px(ctx, x0 + 8, y0 + 7, 2, 2); } // abandoned cup
    } else if (t === T.COUNTER) {
      // food court counters take their stall's colours (1 McDonald's, 2 Wendy's, 3 pizza, 4 tacos)
      const COUNTER_COLORS = { 0: ['#4a3a34', '#7a6a5a'], 1: ['#a81a12', '#ffd23a'], 2: ['#e8e4dc', '#c81a1a'], 3: ['#1a5a2a', '#e8e8e8'], 4: ['#c8601a', '#ffd23a'] };
      const [body, top] = COUNTER_COLORS[variant(tx, ty)] ?? COUNTER_COLORS[0];
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0, y0 + 9, TILE, 5);
      ctx.fillStyle = body; ctx.fillRect(x0, y0 + 3, TILE, 8);
      ctx.fillStyle = top; ctx.fillRect(x0, y0 + 3, TILE, 2);
      if (variant(tx, ty) === 1 && rand() < 0.4) { ctx.fillStyle = '#c81a12'; ctx.fillRect(x0 + 9, y0 + 5, 3, 4); ctx.fillStyle = '#ffd23a'; ctx.fillRect(x0 + 9, y0 + 4, 3, 1); } // fries
      if (variant(tx, ty) === 2 && rand() < 0.4) { ctx.fillStyle = '#e8c070'; ctx.fillRect(x0 + 3, y0 + 6, 4, 3); ctx.fillStyle = '#5a2a1a'; ctx.fillRect(x0 + 3, y0 + 7, 4, 1); } // burger
      if (rand() < 0.3) { ctx.fillStyle = '#2a2a30'; ctx.fillRect(x0 + 5, y0 + 4, 5, 4); ctx.fillStyle = '#6aff9a'; px(ctx, x0 + 6, y0 + 5, 2, 1); } // register
    } else if (t === T.PLANTER) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0 + 3, y0 + 4, 13, 12);
      ctx.fillStyle = '#4a4a52'; ctx.fillRect(x0 + 1, y0 + 2, 14, 12);
      ctx.fillStyle = '#5c5c66'; ctx.fillRect(x0 + 1, y0 + 2, 14, 1);
      ctx.fillStyle = '#2a1e16'; ctx.fillRect(x0 + 3, y0 + 4, 10, 8);
      ctx.fillStyle = ['#5a4a22', '#6a5a2a', '#4a3a1a'][Math.floor(rand() * 3)]; // dead palm fronds
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) for (let d = 1; d < 7; d++) px(ctx, x0 + 8 + Math.cos(a + d * 0.08) * d, y0 + 7 + Math.sin(a + d * 0.08) * d * 0.8);
    }
  }

  // moonlit glass from the broken skylight over the atrium fountain
  for (const d of map.decor) if (d.type === 'skylight') {
    ctx.fillStyle = 'rgba(190,220,255,0.6)';
    for (let i = 0; i < 70; i++) { const a = rand() * Math.PI * 2, r = 40 + rand() * 50; if (tile(Math.floor((d.x + Math.cos(a) * r) / TILE), Math.floor((d.y + Math.sin(a) * r * 0.8) / TILE)) === T.MALLFLOOR) px(ctx, d.x + Math.cos(a) * r, d.y + Math.sin(a) * r * 0.8); }
  }

  // corn rows: tall, dry autumn stalks that overhang their tile
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (tile(tx, ty) !== T.CORN) continue;
    const x0 = tx * TILE, y0 = ty * TILE;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x0 + 2, y0 + 2, TILE, TILE);
    for (let i = 0; i < 9; i++) {
      const sx = x0 + 1 + rand() * 14, sy = y0 + rand() * 14;
      ctx.fillStyle = ['#3a3a16', '#4a4a1a', '#5a5420'][Math.floor(rand() * 3)];
      ctx.fillRect(Math.round(sx), Math.round(sy), 2, 3);
      // leaves fan out from each stalk
      ctx.fillStyle = ['#6a6224', '#7a6e2a', '#8a7a2e', '#5a6a22'][Math.floor(rand() * 4)];
      px(ctx, sx - 2, sy + 1, 2, 1); px(ctx, sx + 2, sy, 2, 1); px(ctx, sx - 1, sy - 1); px(ctx, sx + 1, sy + 2, 2, 1);
      if (rand() < 0.4) { ctx.fillStyle = '#c8a840'; px(ctx, sx, sy - 1); } // tassel
      if (rand() < 0.12) { ctx.fillStyle = '#d8b84a'; px(ctx, sx + 1, sy + 1, 1, 2); } // ear of corn
    }
  }

  // houses
  for (const h of map.houses) drawHouse(ctx, h, rand);

  // trees last so canopies overlap neighbours
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (tile(tx, ty) !== T.TREE) continue;
    drawTree(ctx, tx * TILE + 8, ty * TILE + 8, rand, nearCemetery(map, tx, ty));
  }
  return cv;
}

function nearCemetery(map, tx, ty) {
  const c = map.cemetery;
  return !!c && tx >= c.x0 && tx <= c.x1 && ty >= c.y0 && ty <= c.y1;
}

function drawHouse(ctx, h, rand) {
  if (h.kind === 'barn') return drawBarn(ctx, h);
  if (h.kind === 'silo') return drawSilo(ctx, h);
  if (h.kind === 'car') return drawCar(ctx, h, rand);
  const { x, y, w } = h;
  const hh = h.h;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x + 4, y + 4, w, hh);
  // front wall strip (3/4 view) on the side facing the street
  const wallH = 7;
  const front = h.facing === 's';
  const roofY = front ? y : y + wallH;
  const roofH = hh - wallH;
  const wallY = front ? y + roofH : y;
  ctx.fillStyle = '#3a3036'; ctx.fillRect(x, wallY, w, wallH);
  ctx.fillStyle = '#2c242a';
  for (let i = 0; i < w; i += 4) ctx.fillRect(x + i, wallY, 1, wallH);
  // windows + door
  const doorX = x + w / 2 - 3;
  ctx.fillStyle = '#1e1410'; ctx.fillRect(doorX, wallY + 1, 6, wallH - 1);
  ctx.fillStyle = '#c8902a'; px(ctx, doorX + 4, wallY + 4);
  for (const wx of [x + 8, x + 20, x + w - 28, x + w - 16]) {
    ctx.fillStyle = '#120c10'; ctx.fillRect(wx - 1, wallY + 1, 8, 5);
    ctx.fillStyle = h.lit ? '#ffb84a' : '#1a2230'; ctx.fillRect(wx, wallY + 2, 6, 3);
    ctx.fillStyle = h.lit ? '#ffe0a0' : '#243048'; px(ctx, wx, wallY + 2, 2, 1);
    ctx.fillStyle = '#120c10'; ctx.fillRect(wx + 3, wallY + 2, 1, 3);
  }
  // roof with shingles and a ridge
  const roof = h.roof;
  ctx.fillStyle = shade(roof, -0.1); ctx.fillRect(x, roofY, w, roofH);
  const mid = roofY + Math.floor(roofH / 2);
  for (let ry = roofY; ry < roofY + roofH; ry += 3) {
    const upper = ry < mid;
    ctx.fillStyle = shade(roof, upper ? 0.15 : -0.2);
    ctx.fillRect(x, ry, w, 2);
    ctx.fillStyle = shade(roof, upper ? -0.05 : -0.4);
    const off = (ry / 3) % 2 ? 0 : 3;
    for (let sx = x + off; sx < x + w; sx += 6) ctx.fillRect(sx, ry, 1, 2);
  }
  ctx.fillStyle = shade(roof, 0.35); ctx.fillRect(x, mid - 1, w, 2);
  ctx.fillStyle = shade(roof, -0.5);
  ctx.fillRect(x, roofY, w, 1); ctx.fillRect(x, roofY + roofH - 1, w, 1);
  ctx.fillRect(x, roofY, 1, roofH); ctx.fillRect(x + w - 1, roofY, 1, roofH);
  // chimney
  const cx = x + 10 + Math.floor(rand() * (w - 24));
  const cy = mid - (rand() < 0.5 ? 9 : -3);
  ctx.fillStyle = '#4a2a24'; ctx.fillRect(cx, cy, 7, 7);
  ctx.fillStyle = '#6a3a30'; ctx.fillRect(cx, cy, 7, 1);
  ctx.fillStyle = '#100808'; ctx.fillRect(cx + 1, cy + 1, 5, 4);
  // occasional ghost-sheet / web decoration on the roof
  if (rand() < 0.35) {
    ctx.fillStyle = 'rgba(220,220,230,0.45)';
    const wx = rand() < 0.5 ? x + 1 : x + w - 9, wy = roofY + 1;
    for (let i = 0; i < 8; i++) { px(ctx, wx + i, wy + i * 0.6); px(ctx, wx + 7 - i * 0.2, wy + i); px(ctx, wx + i, wy + 1); }
  }
}

function drawBarn(ctx, h) {
  const { x, y, w } = h, hh = h.h;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + 5, y + 5, w, hh);
  const wallH = 12, roofH = hh - wallH, wallY = y + roofH;
  // red board wall with white trim
  ctx.fillStyle = '#6a1a16'; ctx.fillRect(x, wallY, w, wallH);
  ctx.fillStyle = '#4a100e';
  for (let i = 0; i < w; i += 3) ctx.fillRect(x + i, wallY, 1, wallH);
  ctx.fillStyle = '#d8d0c0'; ctx.fillRect(x, wallY, w, 1); ctx.fillRect(x, wallY + wallH - 1, w, 1);
  // big double doors with the classic white X, open a crack with light spilling out
  const dw = 30, dx = x + w / 2 - dw / 2;
  ctx.fillStyle = '#5a1412'; ctx.fillRect(dx, wallY + 1, dw, wallH - 1);
  ctx.fillStyle = '#d8d0c0';
  ctx.fillRect(dx, wallY + 1, dw, 1); ctx.fillRect(dx, wallY + 1, 1, wallH - 1); ctx.fillRect(dx + dw - 1, wallY + 1, 1, wallH - 1); ctx.fillRect(dx + dw / 2, wallY + 1, 1, wallH - 1);
  for (let i = 0; i < wallH - 2; i++) {
    const k = i / (wallH - 2) * (dw / 2 - 2);
    px(ctx, dx + 1 + k, wallY + 2 + i); px(ctx, dx + dw / 2 - 1 - k, wallY + 2 + i);
    px(ctx, dx + dw / 2 + 1 + k, wallY + 2 + i); px(ctx, dx + dw - 2 - k, wallY + 2 + i);
  }
  ctx.fillStyle = '#ffb84a'; ctx.fillRect(dx + dw / 2 - 1, wallY + 2, 2, wallH - 3);
  // corrugated metal gambrel roof
  ctx.fillStyle = '#2e2e36'; ctx.fillRect(x - 2, y, w + 4, roofH);
  for (let i = -2; i < w + 2; i += 3) { ctx.fillStyle = (i / 3) % 2 ? '#3a3a44' : '#34343e'; ctx.fillRect(x + i, y, 2, roofH); }
  const q = Math.floor(roofH / 4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x - 2, y, w + 4, q);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - 2, y + roofH - q, w + 4, q);
  ctx.fillStyle = '#5a5a66'; ctx.fillRect(x - 2, y + Math.floor(roofH / 2) - 1, w + 4, 2);
  // rust streaks and a weathervane
  ctx.fillStyle = '#5a3a24';
  for (let i = 0; i < 10; i++) ctx.fillRect(x + 6 + ((i * 37) % (w - 12)), y + 3 + ((i * 13) % (roofH - 6)), 1, 3);
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x + w / 2, y + roofH / 2 - 8, 1, 7); ctx.fillRect(x + w / 2 - 4, y + roofH / 2 - 7, 9, 1);
}

// Abandoned car in a parking stall (vertical cars nose-down, horizontal ones nose-right).
function drawCar(ctx, h, rand) {
  ctx.save();
  ctx.translate(h.x + h.w / 2, h.y + h.h / 2);
  if (!h.vertical) ctx.rotate(-Math.PI / 2);
  const L = 28, Wd = 13; // length along y, width along x
  const body = h.burnt ? '#1c1a1a' : h.roof;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(-Wd / 2 + 2, -L / 2 + 2, Wd, L);
  ctx.fillStyle = body; ctx.fillRect(-Wd / 2, -L / 2 + 1, Wd, L - 2); ctx.fillRect(-Wd / 2 + 1, -L / 2, Wd - 2, L);
  ctx.fillStyle = h.burnt ? '#2a2422' : shade(h.roof, 0.2); ctx.fillRect(-Wd / 2 + 2, -6, Wd - 4, 12); // roof
  ctx.fillStyle = h.burnt ? '#0a0808' : '#1a2230'; ctx.fillRect(-Wd / 2 + 2, -10, Wd - 4, 4); ctx.fillRect(-Wd / 2 + 2, 6, Wd - 4, 3); // windows
  if (!h.burnt) {
    ctx.fillStyle = '#3a4a60'; ctx.fillRect(-Wd / 2 + 3, -10, 2, 1);
    ctx.fillStyle = '#d8d0a0'; ctx.fillRect(-Wd / 2 + 1, L / 2 - 1, 3, 1); ctx.fillRect(Wd / 2 - 4, L / 2 - 1, 3, 1); // headlights
    ctx.fillStyle = '#8a1a1a'; ctx.fillRect(-Wd / 2 + 1, -L / 2, 3, 1); ctx.fillRect(Wd / 2 - 4, -L / 2, 3, 1);
    if (rand() < 0.4) { ctx.fillStyle = 'rgba(220,235,255,0.5)'; ctx.fillRect(-2, -9, 1, 2); ctx.fillRect(0, -8, 1, 1); } // cracked windshield
  } else {
    ctx.fillStyle = '#4a2a1a';
    for (let i = 0; i < 8; i++) ctx.fillRect(-Wd / 2 + rand() * Wd, -L / 2 + rand() * L, 2, 1); // rust
  }
  ctx.restore();
}

function drawSilo(ctx, h) {
  const cx = h.x + h.w / 2, cy = h.y + h.h / 2, r = h.w / 2 - 1;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(cx + 5, cy + 5, r, 0, Math.PI * 2); ctx.fill();
  const rings = ['#4a4a54', '#5a5a64', '#6a6a74', '#7a7a84', '#8a8a94'];
  rings.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(cx - i * 0.8, cy - i * 0.8, r * (1 - i * 0.18), 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = '#3a3a44';
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) px(ctx, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
  ctx.fillStyle = '#2a2a30'; ctx.fillRect(cx - 2, cy - 2, 4, 4);
}

function drawTree(ctx, cx, cy, rand, dead) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(cx + 3, cy + 4, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
  if (dead) {
    ctx.fillStyle = '#2a1e18';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    for (let b = 0; b < 6; b++) {
      const a = rand() * Math.PI * 2;
      let bx = cx, by = cy;
      for (let i = 0; i < 9; i++) { bx += Math.cos(a + (rand() - 0.5)); by += Math.sin(a + (rand() - 0.5)); px(ctx, bx, by); }
    }
    return;
  }
  const r = 9 + rand() * 3;
  const palettes = [
    ['#3a1a0e', '#6a2a10', '#9a4416', '#c8661e'],
    ['#2a1a12', '#5a2a18', '#8a3418', '#b04a1c'],
    ['#1a2a16', '#2a3a1a', '#4a4a1a', '#7a6a20'],
  ];
  const pal = palettes[Math.floor(rand() * palettes.length)];
  ctx.fillStyle = pal[0];
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
    const lx = cx + Math.cos(a) * d, ly = cy + Math.sin(a) * d;
    const lit = (lx - cx) + (ly - cy) < 0 ? 1 : 0; // light from top-left
    ctx.fillStyle = pal[1 + Math.min(2, Math.floor(rand() * 2) + lit)];
    px(ctx, lx, ly, 2, 2);
  }
}

// ---------- per-frame sprites ----------

export function drawPumpkin(ctx, x, y, v, flick) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x - 4, y + 2, 9, 2);
  ctx.fillStyle = '#b8500e'; ctx.fillRect(x - 4, y - 3, 9, 6); ctx.fillRect(x - 3, y - 4, 7, 8);
  ctx.fillStyle = '#e07018'; ctx.fillRect(x - 2, y - 4, 1, 8); ctx.fillRect(x + 2, y - 4, 1, 8);
  ctx.fillStyle = '#3a5a18'; ctx.fillRect(x, y - 6, 1, 2);
  const glow = `rgba(255,${200 + Math.floor(flick * 40)},90,1)`;
  ctx.fillStyle = glow;
  if (v === 0) { px(ctx, x - 2, y - 2); px(ctx, x + 2, y - 2); ctx.fillRect(x - 2, y + 1, 5, 1); }
  else if (v === 1) { px(ctx, x - 2, y - 2, 2, 1); px(ctx, x + 1, y - 2, 2, 1); px(ctx, x - 1, y + 1); px(ctx, x + 1, y + 1); px(ctx, x, y + 2); }
  else { px(ctx, x - 2, y - 1); px(ctx, x + 2, y - 1); ctx.fillRect(x - 3, y + 1, 7, 1); px(ctx, x - 2, y + 2); px(ctx, x + 2, y + 2); }
}

export function drawLamp(ctx, x, y) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x - 1, y + 1, 4, 2);
  ctx.fillStyle = '#1c1c22'; ctx.fillRect(x - 1, y - 2, 3, 4);
  ctx.fillStyle = '#ffe6a8'; ctx.fillRect(x - 1, y - 1, 3, 2);
}

export function drawCandle(ctx, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#d8d0b8'; ctx.fillRect(x, y - 2, 2, 3);
  ctx.fillStyle = Math.sin(t * 13 + x) > 0 ? '#ffd36a' : '#ff9a3a'; px(ctx, x, y - 3, 2, 1);
}

export function drawCrypt(ctx, x, y) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 16, y - 8, 36, 26);
  ctx.fillStyle = '#4a4a54'; ctx.fillRect(x - 18, y - 12, 36, 24);
  ctx.fillStyle = '#5c5c68'; ctx.fillRect(x - 18, y - 12, 36, 3);
  ctx.fillStyle = '#3a3a44';
  for (let i = -18; i < 18; i += 6) ctx.fillRect(x + i, y - 9, 1, 21);
  ctx.fillStyle = '#121216'; ctx.fillRect(x - 5, y + 2, 10, 10);
  ctx.fillStyle = '#6aff9a'; px(ctx, x - 2, y + 6); px(ctx, x + 2, y + 6);
  ctx.fillStyle = '#6a6a78'; ctx.fillRect(x - 2, y - 18, 4, 7); ctx.fillRect(x - 5, y - 16, 10, 2);
}

export function drawScarecrow(ctx, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#4a3420'; ctx.fillRect(x - 1, y - 8, 2, 14); ctx.fillRect(x - 8, y - 4, 16, 2);
  ctx.fillStyle = '#6a3a5a'; ctx.fillRect(x - 4, y - 5, 8, 6);
  ctx.fillStyle = '#d07a1a'; ctx.fillRect(x - 3, y - 11, 6, 5);
  ctx.fillStyle = '#ffe07a'; px(ctx, x - 2, y - 10); px(ctx, x + 1, y - 10); ctx.fillRect(x - 2, y - 8, 4, 1);
  ctx.fillStyle = '#2a2018'; ctx.fillRect(x - 5, y - 13, 10, 2); ctx.fillRect(x - 2, y - 16, 4, 3);
  ctx.fillStyle = '#c8a040';
  const s = Math.sin(t * 2) > 0 ? 1 : 0;
  px(ctx, x - 9, y - 4 + s); px(ctx, x + 8, y - 4 - s);
}

export function drawFire(ctx, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  const flames = ['#ff3a0a', '#ff7a1e', '#ffb03a', '#ffe07a'];
  for (let i = 0; i < 4; i++) {
    const h = 4 + Math.abs(Math.sin(t * (7 + i * 2) + i * 2)) * (8 - i * 1.5);
    const w = 7 - i * 1.5;
    ctx.fillStyle = flames[i];
    ctx.fillRect(Math.round(x - w / 2 + Math.sin(t * 5 + i) * 0.8), Math.round(y - h + 2), Math.round(w), Math.round(h));
  }
}

// Points on the fire that should bloom.
export function fireEmitters(x, y, t) {
  return [[x - 2, y - 5 - Math.abs(Math.sin(t * 9)) * 3, 4, 6, '#ffb03a', 1], [x - 1, y - 9, 2, 3, '#ffe07a', 0.8]];
}

// Tiny 3x5 pixel font for signs. Each glyph is 5 rows of 3 bits (4 = left pixel, 1 = right).
const FONT = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2],
  K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7], "'": [2, 2, 0, 0, 0], ' ': [0, 0, 0, 0, 0], '&': [2, 5, 2, 5, 3],
};
export const textWidth = s => s.length * 4 - 1;
export function drawText(ctx, s, x, y, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < s.length; i++) {
    const g = FONT[s[i].toUpperCase()] || FONT[' '];
    for (let r = 0; r < 5; r++) for (let b = 0; b < 3; b++) if (g[r] & (4 >> b)) ctx.fillRect(Math.round(x) + i * 4 + b, Math.round(y) + r, 1, 1);
  }
}

// Dying fluorescents and neon: mostly on, with sudden stuttering blackouts.
export function stutter(t, seed) {
  return Math.sin(t * 23 + seed) * Math.sin(t * 3.7 + seed * 1.3) > 0.55;
}

// Neon shop sign: a glowing tube outline with squiggly "lettering". Returns false while it's flickered off.
export function drawNeon(ctx, d, t, emitters) {
  const off = d.flicker === 2 && stutter(t, d.x * 0.13);
  if (d.text) { // shop name spelled out in neon tubing
    const tw = textWidth(d.text), x = Math.round(d.x - tw / 2), y = Math.round(d.y - 3);
    ctx.fillStyle = '#121016'; ctx.fillRect(x - 3, y - 2, tw + 6, 9);
    if (off) { drawText(ctx, d.text, x, y, '#2a2830'); return false; }
    ctx.fillStyle = d.color; ctx.globalAlpha = 0.5;
    ctx.fillRect(x - 2, y - 2, tw + 4, 1); ctx.fillRect(x - 2, y + 6, tw + 4, 1);
    ctx.globalAlpha = 1;
    drawText(ctx, d.text, x, y, d.color);
    emitters.push([x, y, tw, 5, d.color, 0.7]);
    return true;
  }
  const w = d.w * 6, x = Math.round(d.x - w / 2), y = Math.round(d.y - 3);
  ctx.fillStyle = '#121016'; ctx.fillRect(x - 1, y - 1, w + 2, 8);
  if (off) { ctx.fillStyle = '#2a2830'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + 5, w, 1); return false; }
  ctx.fillStyle = d.color;
  ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + 5, w, 1); ctx.fillRect(x, y, 1, 6); ctx.fillRect(x + w - 1, y, 1, 6);
  for (let i = 3; i < w - 3; i += 3) { ctx.fillRect(x + i, y + 2 + ((i * 7 + d.x) % 2), 2, 1); ctx.fillRect(x + i, y + 3, 1, 1); }
  emitters.push([x, y, w, 1, d.color, 0.9], [x, y + 5, w, 1, d.color, 0.9], [x + 2, y + 2, w - 4, 2, d.color, 0.6]);
  return true;
}

// Food court stall signs. Brand 1 McDonald's, 2 Wendy's, 3 pizza, 4 tacos.
export function drawStall(ctx, d, t, emitters) {
  const x = Math.round(d.x), y = Math.round(d.y) - 13;
  const signs = {
    1: { bg: '#c81a12', fg: '#ffd23a', text: "MCDONALD'S" },
    2: { bg: '#f0ece4', fg: '#d81a1a', text: "WENDY'S" },
    3: { bg: '#1a6a2a', fg: '#ffffff', text: 'PIZZA' },
    4: { bg: '#e8781a', fg: '#2a1408', text: 'TACOS' },
  };
  const s = signs[d.brand];
  const tw = textWidth(s.text), icon = d.brand <= 2 ? 10 : 0, w = tw + icon + 6, x0 = x - Math.round(w / 2);
  ctx.fillStyle = '#0a0808'; ctx.fillRect(x0 - 1, y - 1, w + 2, 11);
  ctx.fillStyle = s.bg; ctx.fillRect(x0, y, w, 9);
  if (d.brand === 1) { // golden arches
    ctx.fillStyle = '#ffd23a';
    ctx.fillRect(x0 + 2, y + 3, 1, 5); ctx.fillRect(x0 + 5, y + 3, 1, 5); ctx.fillRect(x0 + 8, y + 3, 1, 5);
    ctx.fillRect(x0 + 3, y + 2, 2, 1); ctx.fillRect(x0 + 6, y + 2, 2, 1);
  } else if (d.brand === 2) { // red-haired girl with pigtails
    ctx.fillStyle = '#d8461a'; ctx.fillRect(x0 + 2, y + 2, 6, 3); ctx.fillRect(x0 + 1, y + 4, 2, 2); ctx.fillRect(x0 + 7, y + 4, 2, 2);
    ctx.fillStyle = '#f4c8a0'; ctx.fillRect(x0 + 3, y + 4, 4, 3);
    ctx.fillStyle = '#2a6ac8'; ctx.fillRect(x0 + 3, y + 7, 4, 1);
  }
  drawText(ctx, s.text, x0 + 3 + icon, y + 2, s.fg);
  emitters.push([x0, y, w, 9, s.bg, 0.35]);
}

// Little pets wandering around a play pen (puppies, kittens and bunnies).
export function drawPen(ctx, d, t) {
  const x0 = Math.round(d.x) - 15, y0 = Math.round(d.y) - 15;
  d.kinds.forEach((kind, i) => {
    const phase = t * (0.6 + i * 0.25) + d.seed + i * 2.1;
    const ax = x0 + 8 + Math.round((Math.sin(phase) + 1) * 7), ay = y0 + 9 + Math.round((Math.cos(phase * 0.7) + 1) * 6) + i;
    const hop = kind === 2 && Math.sin(t * 9 + i) > 0.6 ? 1 : 0;
    const face = Math.cos(phase) > 0 ? 1 : -1;
    const fur = ['#a8743a', '#e8a84a', '#f0f0f0'][kind];
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(ax - 2, ay + 2, 5, 1);
    ctx.fillStyle = fur; ctx.fillRect(ax - 2, ay - hop, 4, 2); ctx.fillRect(ax + (face > 0 ? 1 : -2), ay - 2 - hop, 2, 2); // body + head
    if (kind === 0) { ctx.fillStyle = '#6a4220'; px(ctx, ax + (face > 0 ? 2 : -2), ay - 2 - hop); }   // floppy ear
    if (kind === 1) { px(ctx, ax + (face > 0 ? 1 : -2), ay - 3 - hop); px(ctx, ax + (face > 0 ? 2 : -1), ay - 3 - hop); } // cat ears
    if (kind === 2) { px(ctx, ax + (face > 0 ? 1 : -1), ay - 4 - hop, 1, 2); }                      // bunny ears
    ctx.fillStyle = '#1a1a1a'; px(ctx, ax + (face > 0 ? 2 : -2), ay - 1 - hop);                    // eye
    if (Math.sin(t * 2 + i * 3) > 0.9) { ctx.fillStyle = '#ff7aa8'; px(ctx, ax + face * 3, ay - 4); } // a little heart
  });
}

// Hamster running in its cage, or a bird hopping on its perch.
export function drawCritter(ctx, d, t) {
  const x = Math.round(d.x), y = Math.round(d.y);
  if (d.kind === 0) {
    const k = Math.sin(t * 3 + d.seed);
    ctx.fillStyle = '#d8a060'; ctx.fillRect(x - 2 + Math.round(k * 3), y + 2, 3, 2);
    ctx.fillStyle = '#1a1a1a'; px(ctx, x + Math.round(k * 3) + (Math.cos(t * 3 + d.seed) > 0 ? 0 : -2), y + 2);
  } else {
    const hop = Math.sin(t * 6 + d.seed) > 0.7 ? 1 : 0;
    ctx.fillStyle = ['#4ac8e8', '#7dff6a'][Math.floor(d.seed) % 2]; ctx.fillRect(x - 1, y - 1 - hop, 3, 2);
    ctx.fillStyle = '#ffd23a'; px(ctx, x + 2, y - 1 - hop);
  }
}

// Fixed-size round rug for the bookstore reading nook.
export function drawRug(ctx, x, y) {
  ctx.fillStyle = '#5a1a2a'; ctx.beginPath(); ctx.ellipse(Math.round(x), Math.round(y), 22, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(Math.round(x), Math.round(y), 18, 7, 0, 0, Math.PI * 2); ctx.stroke();
}

// Emergency exit door propped open (the bar across it and the door swung outward).
export function drawDoor(ctx, d) {
  const x = Math.round(d.x), y = Math.round(d.y);
  ctx.fillStyle = '#c8261a'; ctx.fillRect(x - 8, y - 8, 1, 16); ctx.fillRect(x + 7, y - 8, 1, 16); // red frame
  ctx.fillStyle = '#6a6a74'; ctx.fillRect(x - 8, y - d.inward * 8 - (d.inward > 0 ? 3 : 0), 10, 3);  // the door, swung out
  ctx.fillStyle = '#d8d8e0'; ctx.fillRect(x - 6, y - d.inward * 7 - 2, 6, 1);                        // push bar
}

// Arcade cabinet screen still running its attract mode.
export function drawScreen(ctx, d, t, emitters) {
  const x = Math.round(d.x) - 5, y = Math.round(d.y) - 4;
  if (stutter(t * 0.6, d.x * 0.3 + d.y)) { ctx.fillStyle = '#0a0a12'; ctx.fillRect(x, y, 10, 6); return; }
  ctx.fillStyle = '#05050a'; ctx.fillRect(x, y, 10, 6);
  ctx.fillStyle = d.color;
  const f = Math.floor(t * 6 + d.x);
  ctx.fillRect(x + (f % 8), y + 1, 2, 1);                // a sprite bouncing around
  ctx.fillRect(x + 1, y + 4, 8, 1);                       // the "floor"
  ctx.fillRect(x + ((f * 3) % 9), y + 2 + (f % 2), 1, 1); // blinking pellet
  emitters.push([x, y, 10, 6, d.color, 0.35]);
}

// TV wall: static and the odd blue "NO SIGNAL" screen.
export function drawTV(ctx, d, t, emitters) {
  const x = Math.round(d.x) - 6, y = Math.round(d.y) - 5;
  const mode = Math.floor(t * 0.4 + d.x * 0.07) % 3;
  if (mode === 0) { ctx.fillStyle = '#0a0e14'; ctx.fillRect(x, y, 12, 7); return; }
  if (mode === 1) {
    ctx.fillStyle = '#1a3a8a'; ctx.fillRect(x, y, 12, 7);
    ctx.fillStyle = '#c8d8ff'; ctx.fillRect(x + 3, y + 3, 6, 1);
    emitters.push([x, y, 12, 7, '#3a6aff', 0.4]);
    return;
  }
  for (let i = 0; i < 18; i++) { ctx.fillStyle = Math.random() < 0.5 ? '#d8d8e0' : '#5a5a66'; ctx.fillRect(x + Math.floor(Math.random() * 12), y + Math.floor(Math.random() * 7), 1, 1); }
  emitters.push([x, y, 12, 7, '#c8d8ff', 0.3]);
}

// Fish tank: a couple of fish still swimming back and forth, glowing faintly blue.
export function drawTank(ctx, d, t, emitters) {
  const x = Math.round(d.x) - 7, y = Math.round(d.y) - 5;
  for (let i = 0; i < 2; i++) {
    const k = (Math.sin(t * (0.8 + i * 0.5) + d.seed + i * 2) + 1) / 2;
    const fx = x + 1 + Math.round(k * 11), fy = y + 1 + i * 3 + Math.round(Math.sin(t * 2 + i) * 0.6);
    ctx.fillStyle = i ? '#ff8a2a' : '#ffe45a';
    ctx.fillRect(fx, fy, 2, 1); px(ctx, fx + (Math.cos(t * (0.8 + i * 0.5) + d.seed + i * 2) > 0 ? -1 : 2), fy);
  }
  if (Math.sin(t * 3 + d.seed) > 0.7) { ctx.fillStyle = 'rgba(200,230,255,0.7)'; px(ctx, x + 3 + (Math.floor(d.seed) % 8), y + 1 + Math.floor((t * 4) % 5)); } // bubble
  emitters.push([x, y, 14, 8, '#3a8aff', 0.25]);
}

export function drawGuitar(ctx, d) {
  const x = Math.round(d.x), y = Math.round(d.y), s = d.side;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 2, y + 2, 5, 2);
  ctx.fillStyle = d.color; ctx.fillRect(x - 2, y - 1, 5, 4); ctx.fillRect(x - 1, y - 2, 3, 1);
  ctx.fillStyle = '#1a1a1a'; px(ctx, x, y);
  ctx.fillStyle = '#5a3a20'; ctx.fillRect(x - 3 * s - (s < 0 ? 0 : 0), y - 5, 1, 4); // neck leaning on the wall
  ctx.fillRect(x - 3 * s, y - 6, 2, 1);
}

export function drawTeddy(ctx, x, y) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 3, y + 2, 7, 2);
  ctx.fillStyle = '#8a5a2a'; ctx.fillRect(x - 2, y - 1, 5, 4); ctx.fillRect(x - 2, y - 4, 5, 3);
  px(ctx, x - 3, y - 5, 2, 2); px(ctx, x + 2, y - 5, 2, 2);
  ctx.fillStyle = '#c89a6a'; px(ctx, x - 1, y - 2, 3, 1);
  ctx.fillStyle = '#1a1a1a'; px(ctx, x - 1, y - 3); px(ctx, x + 1, y - 3);
  ctx.fillStyle = '#7a0a12'; px(ctx, x + 1, y, 2, 1); // it's been through a lot
}

export function drawDrums(ctx, x, y) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 6, y + 3, 14, 3);
  for (const [dx, dy, r] of [[0, 0, 4], [-5, -3, 2.5], [5, -3, 2.5], [-6, 2, 2], [7, 1, 3]]) {
    ctx.fillStyle = '#c8c8d0'; ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = r > 3 ? '#8a1a2a' : '#d8c048'; ctx.beginPath(); ctx.arc(x + dx, y + dy, r - 1, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawChair(ctx, x, y) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 4, y + 2, 9, 3);
  ctx.fillStyle = '#5a2a2a'; ctx.fillRect(x - 4, y - 3, 9, 6);
  ctx.fillStyle = '#7a3a34'; ctx.fillRect(x - 3, y - 2, 7, 3);
  ctx.fillStyle = '#4a1a1a'; ctx.fillRect(x - 4, y - 4, 9, 2);
}

export function drawMannequin(ctx, x, y, v) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x - 3, y + 3, 7, 2);
  if (v === 2) { // knocked over
    ctx.fillStyle = '#c8bca8'; ctx.fillRect(x - 6, y, 10, 3); ctx.fillRect(x + 4, y - 1, 3, 4);
    ctx.fillStyle = '#a89c88'; ctx.fillRect(x - 6, y + 2, 10, 1);
    return;
  }
  ctx.fillStyle = '#3a3a40'; ctx.fillRect(x - 1, y + 2, 3, 2); // stand
  ctx.fillStyle = v === 0 ? '#c8bca8' : '#a8a098';
  ctx.fillRect(x - 3, y - 4, 7, 6); ctx.fillRect(x - 1, y - 7, 3, 3);
  ctx.fillStyle = v === 0 ? '#6a2a4a' : '#2a4a6a'; ctx.fillRect(x - 3, y - 3, 7, 4); // leftover outfit
}

export function drawKiosk(ctx, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#2a2a34'; ctx.fillRect(x - 7, y - 6, 14, 3);
  ctx.fillStyle = Math.sin(t * 2 + x) > 0 ? '#3df2ff' : '#2ab8c8'; ctx.fillRect(x - 3, y - 5, 6, 1); // phone-case kiosk sign
}

export function drawCart(ctx, x, y, a) {
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-4, -2, 10, 7);
  ctx.strokeStyle = '#8a8a96'; ctx.lineWidth = 1; ctx.strokeRect(-4.5, -3.5, 8, 6);
  ctx.fillStyle = '#5a5a66'; ctx.fillRect(-4, -1, 7, 1); ctx.fillRect(-4, 1, 7, 1);
  ctx.fillStyle = '#c83a3a'; ctx.fillRect(4, -3, 2, 6); // handle
  ctx.restore();
}

export function drawExit(ctx, x, y) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#1a0a0a'; ctx.fillRect(x - 5, y - 3, 10, 5);
  ctx.fillStyle = '#ff3030'; ctx.fillRect(x - 4, y - 2, 1, 3); ctx.fillRect(x - 3, y - 2, 1, 1); ctx.fillRect(x - 3, y, 1, 1);
  ctx.fillRect(x - 1, y - 2, 1, 3); ctx.fillRect(x + 1, y - 2, 1, 3); ctx.fillRect(x + 3, y - 2, 2, 1); ctx.fillRect(x + 3, y - 1, 1, 2);
}

// Held weapon per weapon code (WEAPON_LIST order): [length, thickness, body color, tip color, side offsets]
const GUN_LOOK = [
  [9, 2, '#2a2a30', '#5a5a66'],  // handgun
  [11, 2, '#5a3a20', '#7a7a88'], // shotgun
  [10, 2, '#2a2a3a', '#ff3df2'], // laser
  [12, 2, '#1e1e24', '#fff07a'], // machine gun
  [12, 3, '#4a5a3a', '#ff7a2a'], // rocket launcher
  [15, 1, '#c8d4e0', '#ffffff'], // katana (drawn with a handle below)
  [8, 2, '#2a2a30', '#8a8a96', [-3, 3]], // double pistols
  [8, 2, '#1a1a20', '#ffe85a'],  // uzi
  [12, 2, '#5a3a1e', '#3a3a40'], // ak-47
  [13, 2, '#141418', '#d8f0ff'], // m16
  [10, 3, '#3a4a2a', '#9aff5a'], // grenade launcher
  [6, 2, '#16141a', '#ffb03a'],  // hand grenade (never held, placeholder)
  [13, 3, '#2a2a32', '#ffb03a'], // minigun (powerup)
];

// Fallback for anyone without a look yet (shouldn't happen, but never draw nothing).
const DEFAULT_LOOK = { skin: '#dcae84', hair: 'short', hairColor: '#3a2418', shirt: 'tee', shirtColor: '#ff8a2a', pants: '#2a4a7a', shoes: '#1a1a1a' };

// A player as a tiny person seen from above at a slight angle (about 9x14 px): shoes and legs,
// a shirt in their style, arms holding the gun toward the aim, and a head with their hairstyle.
// `look` comes from randomLook() in shared/config.js. weapon -1 draws them empty-handed (lobby avatars).
export function drawPlayer(ctx, x, y, a, look, state, t, moving, weapon = 0) {
  look = look || DEFAULT_LOOK;
  x = Math.round(x); y = Math.round(y);
  const ca = Math.cos(a), sa = Math.sin(a);
  const dir = ca >= 0 ? 1 : -1;      // facing right or left
  const away = sa < -0.55;           // aiming up the screen: we see the back of their head
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(x + 1, y + 3, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();

  if (state === 1) { drawDowned(ctx, x, y, look, t); return; }

  // gun (and the arm holding it) goes behind the body when aiming up, in front otherwise
  const drawGun = () => {
    if (weapon < 0) return;
    // arm from the shoulder toward the aim
    ctx.fillStyle = look.shirt === 'tank' ? look.skin : look.shirtColor;
    for (let i = 0; i <= 2; i++) px(ctx, x + ca * i, y - 4 + sa * i, 2, 2);
    ctx.fillStyle = look.skin; px(ctx, x + ca * 3, y - 4 + sa * 3, 2, 2);
    const [glen, gw, gbody, gtip, offsets = [0]] = GUN_LOOK[weapon] || GUN_LOOK[0];
    for (const off of offsets) {
      const ox = x - sa * off, oy = y - 4 + ca * off;
      ctx.fillStyle = gbody;
      for (let i = 3; i <= glen; i++) px(ctx, ox + ca * i, oy + sa * i, gw, gw);
      ctx.fillStyle = gtip; px(ctx, ox + ca * glen, oy + sa * glen, Math.max(1, gw - 1), Math.max(1, gw - 1));
    }
    if (weapon === 5) { // katana handle + guard
      ctx.fillStyle = '#2a1a3a'; for (let i = 2; i <= 5; i++) px(ctx, x + ca * i, y - 4 + sa * i, 2, 2);
      ctx.fillStyle = '#c8a040'; px(ctx, x + ca * 6 - sa, y - 4 + sa * 6 + ca, 2, 2);
    }
  };
  if (away) drawGun();

  // legs + shoes, stepping while walking
  const step = moving ? Math.round(Math.sin(t * 14) * 1.5) : 0;
  ctx.fillStyle = look.pants;
  ctx.fillRect(x - 2, y - 1, 2, 3 + step); ctx.fillRect(x + 1, y - 1, 2, 3 - step);
  ctx.fillStyle = look.shoes;
  ctx.fillRect(x - 2, y + 2 + step, 2, 1); ctx.fillRect(x + 1, y + 2 - step, 2, 1);

  drawTorso(ctx, x, y, look, dir);

  // head
  const hx = x - 2, hy = y - 10;
  ctx.fillStyle = look.skin; ctx.fillRect(hx, hy, 5, 5);
  ctx.fillStyle = shade(look.skin, -0.25); ctx.fillRect(hx, hy + 4, 5, 1); // jaw shadow
  if (!away) { // face: eyes look the way you aim
    ctx.fillStyle = '#1a1a1a';
    const ex = dir > 0 ? hx + 2 : hx + 1;
    px(ctx, ex, hy + 2); px(ctx, ex + 2, hy + 2);
  }
  drawHair(ctx, hx, hy, look, dir, away);

  if (!away) drawGun();
}

function drawTorso(ctx, x, y, look, dir) {
  const c = look.shirtColor, dark = shade(c, -0.35);
  const tx = x - 3, ty = y - 5; // 6x4 torso
  ctx.fillStyle = c; ctx.fillRect(tx, ty, 6, 4);
  switch (look.shirt) {
    case 'tee':
      ctx.fillStyle = look.skin; px(ctx, tx - 1, ty + 1, 1, 2); px(ctx, tx + 6, ty + 1, 1, 2); // bare forearms
      ctx.fillStyle = c; px(ctx, tx - 1, ty, 1, 1); px(ctx, tx + 6, ty, 1, 1);            // short sleeves
      break;
    case 'tank':
      ctx.fillStyle = look.skin; px(ctx, tx, ty, 1, 1); px(ctx, tx + 5, ty, 1, 1);         // bare shoulders
      px(ctx, tx - 1, ty, 1, 3); px(ctx, tx + 6, ty, 1, 3);
      break;
    case 'hoodie':
      ctx.fillStyle = c; px(ctx, tx - 1, ty, 1, 3); px(ctx, tx + 6, ty, 1, 3);             // long sleeves
      ctx.fillStyle = dark; ctx.fillRect(tx + 1, ty + 2, 4, 1);                            // front pocket
      ctx.fillStyle = '#e8e8e8'; px(ctx, tx + 2, ty, 1, 2); px(ctx, tx + 3, ty, 1, 2);      // drawstrings
      break;
    case 'jacket':
      ctx.fillStyle = c; px(ctx, tx - 1, ty, 1, 3); px(ctx, tx + 6, ty, 1, 3);
      ctx.fillStyle = shade(c, 0.6); ctx.fillRect(tx + 2, ty, 2, 4);                        // shirt under the open jacket
      ctx.fillStyle = dark; px(ctx, tx + 1, ty, 1, 4); px(ctx, tx + 4, ty, 1, 4);           // lapels
      break;
    case 'stripes':
      ctx.fillStyle = look.skin; px(ctx, tx - 1, ty + 1, 1, 2); px(ctx, tx + 6, ty + 1, 1, 2);
      ctx.fillStyle = '#f0ece4'; ctx.fillRect(tx, ty + 1, 6, 1); ctx.fillRect(tx, ty + 3, 6, 1);
      break;
    case 'flannel':
      ctx.fillStyle = c; px(ctx, tx - 1, ty, 1, 3); px(ctx, tx + 6, ty, 1, 3);
      ctx.fillStyle = dark; for (let i = 0; i < 6; i += 2) ctx.fillRect(tx + i, ty, 1, 4); ctx.fillRect(tx, ty + 2, 6, 1); // plaid
      break;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(tx, ty + 3, 6, 1); // belt line shadow
}

function drawHair(ctx, hx, hy, look, dir, away) {
  const h = look.hairColor, back = dir > 0 ? hx - 1 : hx + 5; // the side behind their face
  const shadeH = shade(h, -0.3);
  ctx.fillStyle = h;
  switch (look.hair) {
    case 'short':
      ctx.fillRect(hx, hy - 1, 5, 2); px(ctx, back + (dir > 0 ? 1 : -1), hy + 1, 1, 1);
      if (away) ctx.fillRect(hx, hy, 5, 4);
      break;
    case 'long':
      ctx.fillRect(hx, hy - 1, 5, 2); ctx.fillRect(hx - 1, hy, 1, 7); ctx.fillRect(hx + 5, hy, 1, 7);
      if (away) ctx.fillRect(hx, hy, 5, 7);
      ctx.fillStyle = shadeH; px(ctx, hx - 1, hy + 6); px(ctx, hx + 5, hy + 6);
      break;
    case 'ponytail':
      ctx.fillRect(hx, hy - 1, 5, 2);
      ctx.fillRect(back, hy + 1, 1, 2); ctx.fillRect(back + (dir > 0 ? -1 : 1), hy + 2, 1, 3); // the tail swings behind
      if (away) { ctx.fillRect(hx, hy, 5, 4); ctx.fillRect(hx + 2, hy + 4, 1, 3); }
      break;
    case 'curly':
      ctx.fillRect(hx - 1, hy - 2, 7, 3); ctx.fillRect(hx - 1, hy + 1, 1, 2); ctx.fillRect(hx + 5, hy + 1, 1, 2);
      ctx.fillStyle = shadeH; px(ctx, hx, hy - 2); px(ctx, hx + 2, hy - 2); px(ctx, hx + 4, hy - 2); px(ctx, hx - 1, hy);
      ctx.fillStyle = h; if (away) ctx.fillRect(hx - 1, hy, 7, 4);
      break;
    case 'mohawk':
      ctx.fillRect(hx + 1, hy - 3, 3, 3); ctx.fillStyle = shadeH; px(ctx, hx + 2, hy - 3);
      ctx.fillStyle = shade(look.skin, -0.15); px(ctx, hx, hy, 1, 1); px(ctx, hx + 4, hy, 1, 1); // shaved sides
      if (away) { ctx.fillStyle = h; ctx.fillRect(hx + 1, hy, 3, 4); }
      break;
    case 'buzz':
      ctx.fillStyle = shade(h, 0.1); ctx.fillRect(hx, hy, 5, 1);
      if (!away) { ctx.fillStyle = h; ctx.fillRect(hx, hy + 3, 5, 2); ctx.fillStyle = shade(look.skin, -0.1); px(ctx, hx + 1, hy + 3, 3, 1); } // beard + lip
      else { ctx.fillStyle = shadeH; ctx.fillRect(hx, hy, 5, 3); }
      break;
    case 'pigtails':
      ctx.fillRect(hx, hy - 1, 5, 2);
      ctx.fillRect(hx - 2, hy + 1, 2, 3); ctx.fillRect(hx + 5, hy + 1, 2, 3);
      ctx.fillStyle = '#ff5ab4'; px(ctx, hx - 1, hy + 1); px(ctx, hx + 5, hy + 1); // hair ties
      ctx.fillStyle = h; if (away) ctx.fillRect(hx, hy, 5, 4);
      break;
    case 'beanie': {
      const hat = shade(look.shirtColor, -0.25);
      ctx.fillRect(hx - 1, hy + 2, 1, 2); ctx.fillRect(hx + 5, hy + 2, 1, 2); // hair poking out
      ctx.fillStyle = hat; ctx.fillRect(hx - 1, hy - 2, 7, 4);
      ctx.fillStyle = shade(hat, 0.3); ctx.fillRect(hx - 1, hy + 1, 7, 1);       // folded cuff
      ctx.fillStyle = '#f0ece4'; px(ctx, hx + 2, hy - 3);                         // pom-pom
      break;
    }
    case 'cap': {
      const cap = shade(look.pants, 0.2);
      ctx.fillRect(back, hy + 1, 1, 2);                                          // hair under the cap
      ctx.fillStyle = cap; ctx.fillRect(hx - 1, hy - 1, 7, 2);
      if (!away) ctx.fillRect(dir > 0 ? hx + 4 : hx - 2, hy + 1, 3, 1);          // brim points where you face
      else ctx.fillRect(hx, hy + 1, 5, 2);
      ctx.fillStyle = shade(cap, 0.4); px(ctx, hx + 2, hy - 1);                   // button on top
      break;
    }
  }
}

// Downed: lying on their back, flashing, in their own clothes.
function drawDowned(ctx, x, y, look, t) {
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 8);
  ctx.fillStyle = look.pants; ctx.fillRect(x - 7, y - 2, 4, 2); ctx.fillRect(x - 7, y + 1, 4, 2);
  ctx.fillStyle = look.shoes; ctx.fillRect(x - 8, y - 2, 1, 2); ctx.fillRect(x - 8, y + 1, 1, 2);
  ctx.fillStyle = look.shirtColor; ctx.fillRect(x - 3, y - 2, 6, 5);
  ctx.fillStyle = look.skin; ctx.fillRect(x + 3, y - 2, 4, 5); px(ctx, x - 2, y - 4, 2, 2); px(ctx, x - 1, y + 3, 2, 2);
  ctx.fillStyle = look.hairColor; ctx.fillRect(x + 6, y - 2, 2, 5);
  ctx.fillStyle = '#1a1a1a'; px(ctx, x + 4, y - 1); px(ctx, x + 4, y + 1); // eyes shut-ish
  ctx.globalAlpha = 1;
}

// Little portrait for the lobby list: the character facing you, empty-handed.
export function drawAvatar(canvas, look) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  drawPlayer(g, canvas.width / 2, canvas.height - 4, Math.PI * 0.35, look, 0, 0, false, -1);
}

const ZSKIN = ['#6fae5a', '#a3c95a', '#4f7a46'];
const ZSHIRT = ['#4a3a5a', '#5a2a2a', '#2a3a4a', '#4a4a2a'];

export function drawZombie(ctx, x, y, a, type, id, t, hurt) {
  x = Math.round(x); y = Math.round(y);
  const s = type === 2 ? 1.5 : type === 1 ? 0.85 : 1;
  const ca = Math.cos(a), sa = Math.sin(a);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(x + 1, y + 3 * s, 5 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  const skin = hurt ? '#ffffff' : ZSKIN[type] || ZSKIN[0];
  const shirt = hurt ? '#ffffff' : ZSHIRT[id % ZSHIRT.length];
  // outstretched arms
  const sway = Math.sin(t * 6 + id) * 1.2;
  ctx.fillStyle = skin;
  for (let i = 3; i <= 8 * s; i++) {
    px(ctx, x + ca * i - sa * (3 * s + sway * 0.3), y - 1 + sa * i + ca * (3 * s + sway * 0.3), 2, 1);
    px(ctx, x + ca * i + sa * (3 * s - sway * 0.3), y - 1 + sa * i - ca * (3 * s - sway * 0.3), 2, 1);
  }
  ctx.fillStyle = shade(shirt, -0.3);
  ctx.beginPath(); ctx.arc(x, y - 1, 4.5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.arc(x - 0.5, y - 1.5, 3.5 * s, 0, Math.PI * 2); ctx.fill();
  // rips
  if (!hurt) { ctx.fillStyle = skin; px(ctx, x - 1, y - 1); px(ctx, x + 1, y); }
  // head
  ctx.fillStyle = skin;
  ctx.fillRect(x - 2 * s + ca * 2, y - 5 * s + sa * 1.5, 5 * s, 4 * s);
  ctx.fillStyle = shade(ZSKIN[type] || ZSKIN[0], -0.4);
  px(ctx, x - 2 * s + ca * 2, y - 5 * s + sa * 1.5, 5 * s, 1);
}

// A dead zombie sprawled on its back, knocked along `a` (the direction it was hit from).
// Painted straight onto the map canvas, so bodies pile up for the rest of the game.
export function drawCorpse(ctx, x, y, a, type, id) {
  const s = type === 2 ? 1.5 : type === 1 ? 0.85 : 1;
  const ca = Math.cos(a), sa = Math.sin(a);
  const skin = shade(ZSKIN[type] || ZSKIN[0], -0.35);
  const shirt = shade(ZSHIRT[id % ZSHIRT.length], -0.35);
  ctx.globalAlpha = 0.95;
  // limbs flung out
  ctx.fillStyle = skin;
  for (const [la, len] of [[2.2, 7], [-2.2, 7], [2.8, 6], [-2.8, 6]]) {
    const dir = a + la + Math.sin(id * 7 + la) * 0.3;
    for (let i = 2; i <= len * s; i++) px(ctx, x + Math.cos(dir) * i, y + Math.sin(dir) * i, 2, 1);
  }
  // torso
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.ellipse(Math.round(x), Math.round(y), 4.5 * s, 3.2 * s, a, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a0408'; px(ctx, x - sa, y + ca, 2, 2); // wound
  // head, thrown back past the shoulders
  ctx.fillStyle = skin;
  ctx.fillRect(Math.round(x + ca * 5 * s - 2), Math.round(y + sa * 5 * s - 2), Math.round(4 * s), Math.round(4 * s));
  ctx.fillStyle = '#1a0a0a'; px(ctx, x + ca * 5 * s - 1, y + sa * 5 * s - 1); px(ctx, x + ca * 5 * s + 1, y + sa * 5 * s - 1);
  ctx.globalAlpha = 1;
}

// Zombie eye positions (drawn into the glow layer so they bloom).
export function zombieEyes(x, y, a, type) {
  const s = type === 2 ? 1.5 : type === 1 ? 0.85 : 1;
  const ca = Math.cos(a), sa = Math.sin(a);
  const hx = x + ca * 3, hy = y - 4 * s + sa * 1.5;
  return [[hx - 1 - sa, hy + ca * 0.5], [hx + 1 - sa * 0, hy - ca * 0.5 + 0.5]];
}

// bs: 0 walk, 1 charge windup, 2 charging, 3 slam windup, 4 throw windup, 5 summon windup
export function drawBoss(ctx, x, y, a, t, bs, hurt, enraged = false) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + 10, 18, 7, 0, 0, Math.PI * 2); ctx.fill();
  const ca = Math.cos(a), sa = Math.sin(a);
  const shake = bs === 1 || bs === 3 || bs === 5 ? Math.sin(t * 60) * 1 : 0;
  x += shake;
  // arms / claws (raised overhead to throw or summon)
  ctx.fillStyle = hurt ? '#fff' : enraged ? '#6a1a2a' : '#4a2a5a';
  for (const side of [-1, 1]) {
    const reach = bs === 3 ? 4 : bs === 4 || bs === 5 ? 18 : 12;
    for (let i = 6; i <= 6 + reach; i++) {
      ctx.fillRect(Math.round(x + ca * i - sa * 12 * side), Math.round(y + sa * i + ca * 12 * side), 4, 4);
    }
    ctx.fillStyle = '#d8d0c0';
    ctx.fillRect(Math.round(x + ca * (8 + reach) - sa * 12 * side), Math.round(y + sa * (8 + reach) + ca * 12 * side), 3, 3);
    ctx.fillStyle = hurt ? '#fff' : enraged ? '#6a1a2a' : '#4a2a5a';
  }
  // body
  ctx.fillStyle = hurt ? '#fff' : enraged ? '#4a0a1a' : '#3a1a4a';
  ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hurt ? '#fff' : enraged ? '#7a1a2a' : '#5a2a6a';
  ctx.beginPath(); ctx.arc(x - 1, y - 2, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a1a1a';
  for (let i = 0; i < 5; i++) ctx.fillRect(x - 8 + i * 4, y + 2, 2, 5); // ribs
  // giant pumpkin head
  const hx = x + ca * 4, hy = y - 12 + sa * 2;
  ctx.fillStyle = hurt ? '#fff' : '#a83a0a';
  ctx.fillRect(hx - 10, hy - 7, 20, 13); ctx.fillRect(hx - 8, hy - 9, 16, 17);
  ctx.fillStyle = hurt ? '#fff' : '#d0561a';
  for (const ox of [-5, 0, 5]) ctx.fillRect(hx + ox, hy - 9, 2, 17);
  ctx.fillStyle = '#2a4a10'; ctx.fillRect(hx - 1, hy - 12, 3, 4);
  if (enraged) { // cracked shell leaking fire
    ctx.fillStyle = '#ffb030';
    px(ctx, hx - 8, hy - 6, 1, 4); px(ctx, hx - 7, hy - 2, 2, 1); px(ctx, hx + 7, hy - 7, 1, 3); px(ctx, hx + 6, hy - 4, 1, 3);
  }
  const rage = enraged || bs === 1 || bs === 2 || bs === 3 || bs === 4;
  ctx.fillStyle = bs === 5 ? '#6aff9a' : rage ? '#ff3030' : '#c8ff5a';
  ctx.fillRect(hx - 6, hy - 4, 4, 3); ctx.fillRect(hx + 3, hy - 4, 4, 3);
  ctx.fillRect(hx - 6, hy + 2, 13, 2);
  ctx.fillStyle = '#1a0a0a';
  for (let i = -5; i < 7; i += 3) ctx.fillRect(hx + i, hy + 2, 1, 1);
}

export function drawDrop(ctx, x, y, type, t, life) {
  if (life < 5 && Math.sin(t * 20) > 0) return; // blink before despawning
  const key = DROP_TYPES[type];
  const bob = Math.round(Math.sin(t * 4 + x) * 1.5);
  x = Math.round(x); y = Math.round(y) + bob;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x - 4, y + 5 - bob, 9, 2);
  if (key === 'health') { // health: candy-bucket style med kit
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(x - 4, y - 4, 9, 8);
    ctx.fillStyle = '#e02a3a'; ctx.fillRect(x - 1, y - 3, 3, 6); ctx.fillRect(x - 3, y - 1, 7, 2);
  } else if (key === 'shotgun') { // shotgun
    ctx.fillStyle = '#5a3a20'; ctx.fillRect(x - 6, y, 5, 3);
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(x - 2, y - 1, 9, 2);
    ctx.fillStyle = '#7a7a88'; ctx.fillRect(x - 2, y - 1, 9, 1);
  } else if (key === 'laser') { // laser
    ctx.fillStyle = '#2a2a3a'; ctx.fillRect(x - 5, y - 2, 10, 4);
    ctx.fillStyle = '#ff3df2'; ctx.fillRect(x - 3, y - 1, 8, 1); px(ctx, x + 5, y - 1);
    ctx.fillStyle = '#5affff'; px(ctx, x - 4, y + 1, 2, 1);
  } else if (key === 'machinegun') { // machine gun with a drum mag
    ctx.fillStyle = '#1e1e24'; ctx.fillRect(x - 6, y - 1, 13, 3);
    ctx.fillStyle = '#4a4a56'; ctx.fillRect(x - 6, y - 1, 13, 1);
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x - 7, y, 3, 3);
    ctx.fillStyle = '#5a5a28'; ctx.fillRect(x - 2, y + 2, 4, 3);
    ctx.fillStyle = '#fff07a'; px(ctx, x + 7, y);
  } else if (key === 'rocket') { // rocket launcher tube with a rocket peeking out
    ctx.fillStyle = '#3a4a2a'; ctx.fillRect(x - 7, y - 2, 13, 4);
    ctx.fillStyle = '#5a6a3a'; ctx.fillRect(x - 7, y - 2, 13, 1);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x - 2, y + 2, 2, 2);
    ctx.fillStyle = '#c84a2a'; ctx.fillRect(x + 6, y - 1, 2, 2);
  } else if (key === 'katana') { // katana: long blade, wrapped handle, gold guard
    ctx.fillStyle = '#2a1a3a'; ctx.fillRect(x - 7, y, 4, 2);
    ctx.fillStyle = '#c8a040'; ctx.fillRect(x - 3, y - 1, 1, 4);
    ctx.fillStyle = '#c8d4e0'; ctx.fillRect(x - 2, y, 10, 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y + 1, 9, 1); px(ctx, x + 8, y);
  } else if (key === 'dualpistols') { // double pistols, crossed
    for (const [ox, oy] of [[-3, -2], [1, 1]]) {
      ctx.fillStyle = '#2a2a30'; ctx.fillRect(x + ox - 2, y + oy, 6, 2);
      ctx.fillStyle = '#4a3a2a'; ctx.fillRect(x + ox - 2, y + oy + 2, 2, 2);
      ctx.fillStyle = '#8a8a96'; px(ctx, x + ox + 3, y + oy);
    }
  } else if (key === 'uzi') { // uzi: stubby with a long mag
    ctx.fillStyle = '#1a1a20'; ctx.fillRect(x - 4, y - 1, 8, 3);
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(x - 4, y - 1, 8, 1);
    ctx.fillStyle = '#1a1a20'; ctx.fillRect(x - 1, y + 2, 2, 4);
    ctx.fillStyle = '#ffe85a'; px(ctx, x + 4, y);
  } else if (key === 'ak47') { // ak-47: wood stock + curved mag
    ctx.fillStyle = '#6a3e1e'; ctx.fillRect(x - 8, y - 1, 4, 3); ctx.fillRect(x + 1, y - 1, 3, 2);
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(x - 4, y - 1, 5, 2); ctx.fillRect(x + 4, y - 1, 4, 1);
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(x - 2, y + 1, 2, 2); ctx.fillRect(x - 1, y + 3, 2, 2);
  } else if (key === 'm16') { // m16: black with a carry handle
    ctx.fillStyle = '#141418'; ctx.fillRect(x - 8, y - 1, 16, 2);
    ctx.fillStyle = '#2a2a32'; ctx.fillRect(x - 3, y - 3, 5, 1); px(ctx, x - 3, y - 2); px(ctx, x + 1, y - 2);
    ctx.fillStyle = '#141418'; ctx.fillRect(x - 1, y + 1, 2, 3);
    ctx.fillStyle = '#d8f0ff'; px(ctx, x + 8, y - 1);
  } else if (key === 'grenade') { // grenade launcher: fat drum and stubby barrel
    ctx.fillStyle = '#3a4a2a'; ctx.fillRect(x - 6, y - 1, 12, 3);
    ctx.fillStyle = '#2a3a1a'; ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.fillStyle = '#5a6a3a'; ctx.fillRect(x - 3, y - 3, 6, 1);
    ctx.fillStyle = '#9aff5a'; px(ctx, x, y);
  } else if (key === 'star') { // invincibility: spinning rainbow-edged star with eyes
    const spin = Math.sin(t * 6);
    const w = Math.max(1, Math.round(Math.abs(spin) * 4));
    ctx.fillStyle = ['#ff4a4a', '#ffb34a', '#7dff6a', '#5ad1ff', '#b56cff'][Math.floor(t * 10) % 5];
    ctx.fillRect(x - w - 1, y - 2, w * 2 + 3, 4);
    ctx.fillStyle = '#ffe45a';
    ctx.fillRect(x - w, y - 2, w * 2 + 1, 4); ctx.fillRect(x - Math.ceil(w / 2), y - 5, Math.ceil(w / 2) * 2 + 1, 3);
    ctx.fillRect(x - w - 1, y + 2, 2, 2); ctx.fillRect(x + w, y + 2, 2, 2);
    if (w > 2) { ctx.fillStyle = '#1a1a1a'; px(ctx, x - 1, y - 1, 1, 2); px(ctx, x + 1, y - 1, 1, 2); }
  } else if (key === 'ghost') { // invisibility: a little sheet ghost, flickering in and out
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 5);
    ctx.fillStyle = '#e8f4ff';
    ctx.fillRect(x - 3, y - 5, 7, 3); ctx.fillRect(x - 4, y - 3, 9, 6);
    for (let i = 0; i < 3; i++) px(ctx, x - 4 + i * 3 + (Math.floor(t * 4) % 2), y + 3, 2, 1);
    ctx.fillStyle = '#1a2a3a'; px(ctx, x - 2, y - 3, 1, 2); px(ctx, x + 1, y - 3, 1, 2);
    ctx.globalAlpha = 1;
  } else if (key === 'nuke') { // hazard-yellow barrel with the radiation trefoil
    ctx.fillStyle = '#2a2a1a'; ctx.fillRect(x - 4, y - 5, 9, 10);
    ctx.fillStyle = '#e8c82a'; ctx.fillRect(x - 3, y - 5, 7, 10);
    ctx.fillStyle = '#a88a1a'; ctx.fillRect(x - 3, y - 2, 7, 1); ctx.fillRect(x - 3, y + 2, 7, 1);
    ctx.fillStyle = '#1a1a10';
    px(ctx, x, y); px(ctx, x - 2, y - 2, 2, 1); px(ctx, x + 1, y - 2, 2, 1); px(ctx, x - 1, y + 1, 3, 1);
    ctx.fillStyle = Math.sin(t * 8) > 0 ? '#7dff6a' : '#3a8a2a'; px(ctx, x - 1, y - 5, 3, 1); // glowing goo on top
  } else if (key === 'minigun') { // minigun powerup: spinning six-barrel gun with an ammo belt
    ctx.fillStyle = '#2a2a32'; ctx.fillRect(x - 6, y - 2, 8, 5);
    ctx.fillStyle = '#5a5a66'; ctx.fillRect(x - 6, y - 2, 8, 1);
    const spin = Math.floor(t * 20) % 2;
    ctx.fillStyle = '#8a8a96'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 2, y - 2 + i * 2 + spin, 6, 1);
    ctx.fillStyle = '#c8a040'; for (let i = 0; i < 4; i++) px(ctx, x - 5 + i * 2, y + 3 + (i % 2)); // ammo belt
    ctx.fillStyle = '#ffb03a'; px(ctx, x + 8, y - 1, 1, 3);
  } else if (key === 'frag') { // hand grenade pickup: round black bomb, fuse ready to light
    ctx.fillStyle = '#16141a'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a4852'; ctx.fillRect(x - 2, y - 3, 2, 1);
    ctx.fillStyle = '#5a5a64'; ctx.fillRect(x, y - 5, 2, 2);
    ctx.fillStyle = '#8a7a5a'; ctx.fillRect(x + 1, y - 7, 1, 2);
  }
}
