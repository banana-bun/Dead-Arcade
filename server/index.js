// HTTP static server + WebSocket lobby/matchmaking/chat. Game simulation lives in game.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MIN_PLAYERS, MAX_PLAYERS, PLAYER_COLORS, TICK_RATE, SNAPSHOT_RATE, WEAPONS, MATCH_OPTIONS, randomLook } from '../shared/config.js';
import { MAPS } from '../shared/map.js';
import { Game } from './game.js';
import { Station } from './music.js';

const PORT = Number(process.env.PORT) || 3000;
const SOLO = process.argv.includes('--solo');
const minPlayers = SOLO ? 1 : MIN_PLAYERS;
// Dev helper: --round=5 makes new games start at that round (e.g. to test the boss).
const START_ROUND = Number(process.argv.find(a => a.startsWith('--round='))?.split('=')[1]) || 1;
// Dev helper: --weapon=rocket gives everyone that gun at the start.
const START_WEAPON = process.argv.find(a => a.startsWith('--weapon='))?.split('=')[1];
// Dev helper: --powerups drops one of each powerup next to the spawn at the start of a game.
const POWERUP_TEST = process.argv.includes('--powerups');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIRS = { '/shared/': path.join(root, 'shared'), '/': path.join(root, 'public') };
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.flac': 'audio/flac',
};
const MUSIC_DIR = path.join(root, 'public', 'music');

// Streams a file, honouring Range requests so audio can seek and start quickly.
function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const isAudio = type.startsWith('audio/');
    const headers = { 'Content-Type': type, 'Cache-Control': isAudio ? 'public, max-age=86400' : 'no-cache', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      start = Math.max(0, start); end = Math.min(end, st.size - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  const prefix = url.startsWith('/shared/') ? '/shared/' : '/';
  const base = STATIC_DIRS[prefix];
  const file = path.normalize(path.join(base, url.slice(prefix.length)));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  sendFile(req, res, file);
});

const wss = new WebSocketServer({ server });
const clients = new Map(); // id -> client
const rooms = new Map();   // code -> room
let nextId = 1;

function send(c, msg) {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const c of room.players.values()) if (c.ws.readyState === 1) c.ws.send(data);
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(code));
  return code;
}

function cleanText(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function roomInfo(room) {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    isPublic: room.isPublic,
    map: room.map,
    options: room.options,
    state: room.game ? 'playing' : 'lobby',
    minPlayers,
    maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()].map(c => ({ id: c.id, name: c.name, color: c.color, look: c.look })),
  };
}

function lobbyList() {
  return [...rooms.values()]
    .filter(r => r.isPublic)
    .map(r => ({ code: r.code, name: r.name, map: MAPS[r.map].name, count: r.players.size, max: MAX_PLAYERS, state: r.game ? 'playing' : 'lobby' }));
}

function pushLobbyList() {
  const list = lobbyList();
  for (const c of clients.values()) if (!c.room) send(c, { t: 'lobbies', list });
}

function sysChat(room, text) {
  broadcast(room, { t: 'chat', sys: true, text });
}

function pickColor(room) {
  const used = new Set([...room.players.values()].map(c => c.color));
  return PLAYER_COLORS.find(col => !used.has(col)) || PLAYER_COLORS[0];
}

function createRoom(host, isPublic) {
  const room = {
    code: makeCode(), name: `${host.name}'s House`, hostId: host.id, isPublic, map: 'suburb',
    options: Object.fromEntries(Object.keys(MATCH_OPTIONS).map(k => [k, false])), // custom match toggles, off by default
    players: new Map(), game: null,
  };
  rooms.set(room.code, room);
  joinRoom(host, room);
  return room;
}

function joinRoom(c, room) {
  if (room.players.size >= MAX_PLAYERS) return send(c, { t: 'error', text: 'That lobby is full.' });
  if (c.room) leaveRoom(c);
  c.color = pickColor(room);
  // a fresh, unique character for this lobby (no shared skin tone or hairstyle)
  c.look = randomLook([...room.players.values()].map(o => o.look), c.color);
  room.players.set(c.id, c);
  c.room = room;
  send(c, { t: 'joined', code: room.code });
  broadcast(room, { t: 'room', room: roomInfo(room) });
  sysChat(room, `${c.name} joined the party.`);
  if (room.game) {
    room.game.addPlayer(c);
    send(c, { t: 'start', you: c.id, round: room.game.round, map: room.game.mapId, options: room.game.options });
    if (room.music) send(c, room.music.state()); // join the song already playing
  }
  pushLobbyList();
}

function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  room.players.delete(c.id);
  c.room = null;
  room.game?.removePlayer(c.id);
  send(c, { t: 'music', stop: true });
  if (room.players.size === 0) {
    room.game?.stop();
    room.music = null;
    rooms.delete(room.code);
  } else {
    if (room.hostId === c.id) room.hostId = room.players.keys().next().value;
    broadcast(room, { t: 'room', room: roomInfo(room) });
    sysChat(room, `${c.name} left.`);
  }
  pushLobbyList();
}

function startGame(room) {
  const game = new Game({
    onSnapshot: msg => broadcast(room, msg),
    onGameOver: result => {
      room.game = null;
      room.music = null;
      broadcast(room, { t: 'music', stop: true });
      broadcast(room, { t: 'gameover', ...result });
      broadcast(room, { t: 'room', room: roomInfo(room) });
      sysChat(room, `The suburb fell on round ${result.round}.`);
      pushLobbyList();
    },
    tickRate: TICK_RATE,
    snapshotRate: SNAPSHOT_RATE,
    mapId: room.map,
    options: { ...room.options },
  });
  room.game = game;
  game.round = START_ROUND - 1;
  // Starting later (dev flag) still unlocks guns from bosses you skipped.
  for (const w of Object.values(WEAPONS)) if (w.tier < START_ROUND) game.unlockedTiers.add(w.tier);
  for (const c of room.players.values()) game.addPlayer(c);
  if (WEAPONS[START_WEAPON]) for (const p of game.players.values()) { p.weapon = START_WEAPON; p.ammo = WEAPONS[START_WEAPON].ammo * 5; }
  if (POWERUP_TEST) ['star', 'ghost', 'nuke', 'minigun', 'frag', 'frag', 'frag', 'laser'].forEach((type, i) => game.spawnDrop(type, game.map.playerSpawn.x - 45 + (i % 4) * 30, game.map.playerSpawn.y + 22 + Math.floor(i / 4) * 20));
  for (const c of room.players.values()) send(c, { t: 'start', you: c.id, round: 0, map: room.map, options: game.options });
  broadcast(room, { t: 'room', room: roomInfo(room) });
  sysChat(room, 'The dead are rising...');
  // music only plays during a match, and everyone in it hears the same song
  room.music = new Station(MUSIC_DIR, msg => { if (room.music) broadcast(room, msg); });
  room.music.next();
  game.start();
  pushLobbyList();
}

wss.on('connection', ws => {
  const c = { id: nextId++, ws, name: `Ghoul${Math.floor(Math.random() * 900 + 100)}`, room: null, color: PLAYER_COLORS[0], chatTimes: [] };
  clients.set(c.id, c);
  send(c, { t: 'welcome', id: c.id, name: c.name });
  send(c, { t: 'lobbies', list: lobbyList() });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'name': {
        const n = cleanText(m.name, 16);
        if (n) c.name = n;
        send(c, { t: 'welcome', id: c.id, name: c.name });
        if (c.room) broadcast(c.room, { t: 'room', room: roomInfo(c.room) });
        break;
      }
      case 'list': send(c, { t: 'lobbies', list: lobbyList() }); break;
      case 'create': createRoom(c, m.isPublic !== false); break;
      case 'join': {
        const room = rooms.get(cleanText(m.code, 4).toUpperCase());
        if (!room) send(c, { t: 'error', text: 'No lobby with that code.' });
        else joinRoom(c, room);
        break;
      }
      case 'quick': {
        const open = [...rooms.values()].filter(r => r.isPublic && r.players.size < MAX_PLAYERS)
          .sort((a, b) => (a.game ? 1 : 0) - (b.game ? 1 : 0) || b.players.size - a.players.size);
        if (open.length) joinRoom(c, open[0]); else createRoom(c, true);
        break;
      }
      case 'leave': leaveRoom(c); send(c, { t: 'left' }); send(c, { t: 'lobbies', list: lobbyList() }); break;
      case 'start': {
        const room = c.room;
        if (!room || room.hostId !== c.id || room.game) break;
        if (room.players.size < minPlayers) { send(c, { t: 'error', text: `Need at least ${minPlayers} players.` }); break; }
        startGame(room);
        break;
      }
      case 'map': {
        const room = c.room;
        if (!room || room.hostId !== c.id || room.game || !Object.hasOwn(MAPS, m.map) || room.map === m.map) break;
        room.map = m.map;
        broadcast(room, { t: 'room', room: roomInfo(room) });
        sysChat(room, `Map set to ${MAPS[m.map].name}.`);
        pushLobbyList();
        break;
      }
      case 'chat': {
        if (!c.room) break;
        const text = cleanText(m.text, 160);
        if (!text) break;
        const now = Date.now();
        c.chatTimes = c.chatTimes.filter(t => now - t < 5000);
        if (c.chatTimes.length >= 6) { send(c, { t: 'chat', sys: true, text: 'Slow down, you are spamming.' }); break; }
        c.chatTimes.push(now);
        broadcast(c.room, { t: 'chat', from: c.name, color: c.color, text });
        break;
      }
      case 'reroll': { // new random look, still unique in the lobby (not mid-match)
        const room = c.room;
        if (!room || room.game) break;
        // counting your own current look as taken guarantees a visibly new skin tone and hairstyle
        c.look = randomLook([...room.players.values()].map(o => o.look), c.color);
        broadcast(room, { t: 'room', room: roomInfo(room) });
        break;
      }
      case 'option': {
        const room = c.room;
        if (!room || room.hostId !== c.id || room.game || !Object.hasOwn(MATCH_OPTIONS, m.key)) break;
        const value = !!m.value;
        if (room.options[m.key] === value) break;
        room.options[m.key] = value;
        broadcast(room, { t: 'room', room: roomInfo(room) });
        sysChat(room, `${MATCH_OPTIONS[m.key].name}: ${value ? 'ON' : 'OFF'}`);
        break;
      }
      case 'musicEnded': c.room?.music?.ended(m.seq); break;
      case 'musicSkip': {
        const room = c.room;
        if (room?.music?.skip(m.seq)) sysChat(room, `${c.name} skipped to ${room.music.current?.title ?? 'the next song'}.`);
        break;
      }
      case 'input': c.room?.game?.handleInput(c.id, m); break;
      case 'shoot': c.room?.game?.handleShoot(c.id, m); break;
      case 'throw': c.room?.game?.handleThrow(c.id, m); break;
    }
  });

  ws.on('close', () => {
    leaveRoom(c);
    clients.delete(c.id);
  });
});

server.listen(PORT, () => {
  console.log(`Dead Suburb Arcade running on http://localhost:${PORT}${SOLO ? '  (solo mode: 1 player can start)' : ''}`);
});
