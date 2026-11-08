// Menus, lobby, chat and the WebSocket connection. Hands off to GameClient when a match starts.
import { GameClient } from './game.js';
import { unlockAudio, toggleMute, sfx, getSfxVolume, setSfxVolume } from './audio.js';
import { music } from './music.js';
import { WEAPONS, PLAYER, WEAPON_LIST, MATCH_OPTIONS, FRAGS, RARITIES, rarityOf } from '/shared/config.js';
import { MAPS, generateMap } from '/shared/map.js';
import { renderMapBackground } from './art.js';

const $ = id => document.getElementById(id);

let ws = null;
let myId = null;
let room = null;
let game = null;
let chatOpen = false;

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => {
    const saved = loadName();
    if (saved) send({ t: 'name', name: saved });
  };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    music.handle({ stop: true });
    showError('Lost connection to the server. Reconnecting...');
    endGame();
    show('menu');
    setTimeout(connect, 2000);
  };
}

function send(msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

function loadName() { try { return localStorage.getItem('dsa-name'); } catch { return null; } }
function saveName(n) { try { localStorage.setItem('dsa-name', n); } catch { /* storage blocked */ } }

function show(screen) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === screen);
}

let errTimer;
function showError(text) {
  const el = $('error');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(errTimer);
  errTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function handle(m) {
  switch (m.t) {
    case 'welcome':
      myId = m.id;
      if (document.activeElement !== $('name-input')) $('name-input').value = m.name;
      break;
    case 'lobbies': renderLobbies(m.list); break;
    case 'joined': $('lobby-chat-log').innerHTML = ''; $('game-chat-log').innerHTML = ''; break;
    case 'room':
      room = m.room;
      renderRoom();
      if (!game && !$('gameover').classList.contains('active')) show('room');
      break;
    case 'left': room = null; show('menu'); break;
    case 'error': showError(m.text); break;
    case 'chat': addChat(m); break;
    case 'start': startGame(m.map, m.options); break;
    case 's': game?.onSnapshot(m); break;
    case 'music': music.handle(m); break;
    case 'gameover': showGameOver(m); break;
  }
}

// ---------- menu ----------

function renderLobbies(list) {
  const ul = $('lobby-list');
  ul.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No open lobbies. Make one!';
    ul.append(li);
    return;
  }
  for (const l of list) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${l.name} · ${l.map}  (${l.count}/${l.max})`;
    const st = document.createElement('span');
    st.className = `state ${l.state}`;
    st.textContent = l.state === 'playing' ? 'in game - join' : 'waiting';
    li.append(name, st);
    li.onclick = () => { commitName(); send({ t: 'join', code: l.code }); };
    ul.append(li);
  }
}

function commitName() {
  unlockAudio();
  const n = $('name-input').value.trim();
  if (n) { saveName(n); send({ t: 'name', name: n }); }
}

$('quick-btn').onclick = () => { commitName(); send({ t: 'quick' }); };
$('create-btn').onclick = () => { commitName(); send({ t: 'create', isPublic: !$('private-check').checked }); };
$('join-btn').onclick = () => {
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 4) return showError('Codes are 4 characters.');
  commitName(); send({ t: 'join', code });
};
$('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('join-btn').click(); });
$('name-input').addEventListener('change', commitName);
$('refresh-btn').onclick = () => send({ t: 'list' });

// ---------- room ----------

function renderRoom() {
  if (!room) return;
  $('room-name').textContent = room.name;
  $('room-code').textContent = room.code;
  renderMapOptions();
  renderMatchOptions();
  const ul = $('player-list');
  ul.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = p.color; dot.style.color = p.color;
    const nm = document.createElement('span');
    nm.textContent = p.name + (p.id === myId ? ' (you)' : '');
    li.append(dot, nm);
    if (p.id === room.hostId) {
      const h = document.createElement('span'); h.className = 'host'; h.textContent = 'HOST'; li.append(h);
    }
    ul.append(li);
  }
  for (let i = room.players.length; i < room.maxPlayers; i++) {
    const li = document.createElement('li'); li.className = 'slot'; li.textContent = 'empty grave...'; ul.append(li);
  }
  const isHost = room.hostId === myId;
  const enough = room.players.length >= room.minPlayers;
  $('start-btn').disabled = !isHost || !enough || room.state === 'playing';
  $('start-btn').style.display = isHost ? '' : 'none';
  $('room-status').textContent = room.state === 'playing' ? 'Game in progress...'
    : !enough ? `Waiting for players (${room.players.length}/${room.minPlayers} minimum). Share the code!`
    : isHost ? 'Ready when you are.' : 'Waiting for the host to start.';
}

// Map picker: the host chooses, everyone sees the selection. Previews are a dimmed overview of each map.
const mapCards = new Map();
function renderMapOptions() {
  const box = $('map-options');
  for (const [id, info] of Object.entries(MAPS)) {
    let card = mapCards.get(id);
    if (!card) {
      card = document.createElement('button');
      card.className = 'map-card';
      const preview = document.createElement('canvas');
      preview.width = 192; preview.height = 144;
      const name = document.createElement('div'); name.className = 'map-name'; name.textContent = info.name;
      const blurb = document.createElement('div'); blurb.className = 'map-blurb'; blurb.textContent = info.blurb;
      card.append(preview, name, blurb);
      card.onclick = () => send({ t: 'map', map: id });
      box.append(card);
      mapCards.set(id, card);
      // let the lobby paint first; rendering a full map takes a moment
      setTimeout(() => {
        const bg = renderMapBackground(generateMap(id));
        const g = preview.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.drawImage(bg, 0, 0, preview.width, preview.height);
        g.fillStyle = 'rgba(12,6,30,0.35)'; g.fillRect(0, 0, preview.width, preview.height);
      }, 50);
    }
    card.classList.toggle('selected', room.map === id);
    card.disabled = room.hostId !== myId || room.state === 'playing';
    card.title = card.disabled && room.map !== id ? 'Only the host can change the map' : '';
  }
}

// Custom match toggles (all off by default). The host flips them; everyone sees the current state.
const optionRows = new Map();
function renderMatchOptions() {
  const box = $('match-options');
  for (const [key, info] of Object.entries(MATCH_OPTIONS)) {
    let row = optionRows.get(key);
    if (!row) {
      row = document.createElement('button');
      row.className = 'toggle';
      row.innerHTML = '<span class="switch"><i></i></span><span class="toggle-text"><b></b><small></small></span>';
      row.querySelector('b').textContent = info.name;
      row.querySelector('small').textContent = info.blurb;
      row.onclick = () => send({ t: 'option', key, value: !room.options?.[key] });
      box.append(row);
      optionRows.set(key, row);
    }
    const on = !!room.options?.[key];
    row.classList.toggle('on', on);
    row.setAttribute('aria-pressed', on);
    row.disabled = room.hostId !== myId || room.state === 'playing';
  }
}

$('start-btn').onclick = () => { unlockAudio(); send({ t: 'start' }); };
$('leave-btn').onclick = () => send({ t: 'leave' });

// ---------- chat ----------

function addChat(m) {
  for (const logId of ['lobby-chat-log', 'game-chat-log']) {
    const log = $(logId);
    const div = document.createElement('div');
    div.className = 'msg' + (m.sys ? ' sys' : '');
    if (m.sys) div.textContent = m.text;
    else {
      const who = document.createElement('b');
      who.style.color = m.color; who.textContent = `${m.from}: `;
      div.append(who, document.createTextNode(m.text));
    }
    log.append(div);
    while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (logId === 'game-chat-log') setTimeout(() => div.classList.add('faded'), 8000);
  }
  if (!m.sys) sfx.chat();
}

$('lobby-chat-form').onsubmit = e => {
  e.preventDefault();
  const input = $('lobby-chat-input');
  if (input.value.trim()) send({ t: 'chat', text: input.value });
  input.value = '';
};

function openGameChat() {
  chatOpen = true;
  $('game-chat-form').classList.remove('hidden');
  document.querySelector('.game-chat').classList.add('open');
  $('game-chat-input').focus();
}
function closeGameChat() {
  chatOpen = false;
  $('game-chat-input').value = '';
  $('game-chat-input').blur();
  $('game-chat-form').classList.add('hidden');
  document.querySelector('.game-chat').classList.remove('open');
}
$('game-chat-form').onsubmit = e => {
  e.preventDefault();
  const v = $('game-chat-input').value;
  if (v.trim()) send({ t: 'chat', text: v });
  closeGameChat();
};
addEventListener('keydown', e => {
  if (!game) return;
  if (e.key === 'Enter' && !chatOpen) { e.preventDefault(); openGameChat(); }
  else if (e.key === 'Escape' && chatOpen) closeGameChat();
});

// ---------- music + volume ----------

// Only shown during a match; the song is shared by everyone in it.
let lastSongSeq = 0;
function renderMusic() {
  const t = music.track;
  $('music').classList.toggle('hidden', !music.active);
  if (t && t.seq !== lastSongSeq) {
    if (lastSongSeq && game) showToast(`Now playing: ${t.title}`, '#b56cff');
    lastSongSeq = t.seq;
  }
  $('music').classList.toggle('playing', music.playing);
  $('music-artist').textContent = t?.artist || 'Now playing';
  $('music-title').textContent = t?.title || '-';
  $('music-title').title = t ? `${t.artist ? t.artist + ' - ' : ''}${t.title}` : '';
}

$('music-play').onclick = () => { music.toggle(); renderMusic(); };
$('music-next').onclick = () => music.skip();
$('music-vol').value = Math.round(music.volume * 100);
$('sfx-vol').value = Math.round(getSfxVolume() * 100);
$('music-vol').oninput = e => music.setVolume(e.target.value / 100);
$('sfx-vol').oninput = e => setSfxVolume(e.target.value / 100);
// don't leave a slider focused, or arrow keys would keep nudging it mid-game
for (const id of ['music-vol', 'sfx-vol', 'music-play', 'music-next']) $(id).addEventListener('pointerup', e => e.currentTarget.blur());

// Browsers block sound until the first click or key press.
const kickAudio = () => { unlockAudio(); music.kick(); };
addEventListener('pointerdown', kickAudio);
addEventListener('keydown', kickAudio);

// M mutes everything, N skips the song (not while typing in a text box)
addEventListener('keydown', e => {
  if (chatOpen || e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  const k = e.key.toLowerCase();
  if (k === 'm') {
    const muted = toggleMute();
    music.setMuted(muted);
    showToast(muted ? 'Sound off' : 'Sound on', '#9a8aa8');
  } else if (k === 'n' && music.active) {
    music.skip();
  }
});

music.init(send, renderMusic);

// ---------- game ----------

let bannerTimer;
let lastHudKey = '';
const hud = {
  banner(text, color, sub, dur) {
    $('banner-text').textContent = text;
    $('banner-text').style.color = color;
    $('banner-sub').textContent = sub;
    $('banner').classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => $('banner').classList.remove('show'), dur * 1000);
  },
  toast: (text, color) => showToast(text, color),
  scoreboard(on) {
    $('scoreboard').classList.toggle('hidden', !on);
  },
  update(s, me, boss, stamina, exhausted) {
    $('hud-stamina').style.width = `${stamina * 100}%`;
    $('stamina').classList.toggle('exhausted', exhausted);
    $('hud-round').textContent = s.round;
    $('hud-left').textContent = s.phase === 'intermission'
      ? `Next round in ${Math.ceil(s.timer)}`
      : `${s.left} zombie${s.left === 1 ? '' : 's'} left`;
    const p = s.players.get(me);
    if (p) {
      // weapon name in its rarity colour (the Minigun powerup takes over while it lasts)
      const key = p.minigun > 0 ? 'minigun' : WEAPON_LIST[p.weapon];
      const rarity = rarityOf(key);
      $('hud-weapon').textContent = WEAPONS[key].name;
      $('hud-weapon').style.color = rarity ? RARITIES[rarity].color : WEAPONS[key].color;
      $('hud-weapon').className = `weapon${rarity === 'rainbow' || rarity === 'cosmic' ? ' ' + rarity : ''}`;
      $('hud-ammo').textContent = p.minigun > 0 || p.ammo < 0 ? '∞' : p.ammo;
      $('hud-hp').style.width = `${(p.hp / PLAYER.maxHp) * 100}%`;
      $('hud-hp-text').textContent = p.hp;
      $('status').textContent = p.state === 1 ? `DOWNED - ${p.bleed}s until you bleed out` : p.state === 2 ? 'OUT - SPECTATING UNTIL NEXT ROUND' : '';
      // grenades carried (Q to throw)
      const fragKey = `${p.frags}`;
      if ($('hud-frags').dataset.n !== fragKey) {
        $('hud-frags').dataset.n = fragKey;
        $('hud-frags').innerHTML = `<span>Q</span>${Array.from({ length: FRAGS.max }, (_, i) => `<i class="${i < p.frags ? 'full' : ''}"></i>`).join('')}`;
      }
      // active powerup timers
      const power = $('hud-power');
      const parts = [];
      if (p.star > 0) parts.push(`<div class="star">INVINCIBLE ${Math.ceil(p.star)}s</div>`);
      if (p.ghost > 0) parts.push(`<div style="color:#9ad8ff">INVISIBLE ${Math.ceil(p.ghost)}s</div>`);
      if (p.minigun > 0) parts.push(`<div style="color:#ff8a2a">MINIGUN ${Math.ceil(p.minigun)}s</div>`);
      const html = parts.join('');
      if (power.innerHTML !== html) power.innerHTML = html;
      power.classList.toggle('hidden', !parts.length);
    }
    $('boss-bar').classList.toggle('hidden', !boss);
    if (boss) $('boss-fill').style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
    renderDownAlert(s, p, me);

    const list = [...s.players.values()];
    const key = list.map(q => [q.id, q.hp, q.state, q.score, q.kills, q.name].join(':')).join('|');
    if (key === lastHudKey) return;
    lastHudKey = key;
    const team = $('team');
    team.innerHTML = '';
    for (const q of list) {
      const li = document.createElement('li');
      li.className = q.state === 1 ? 'down' : q.state === 2 ? 'dead' : '';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = q.color; dot.style.color = q.color;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = q.name + (q.id === me ? ' (you)' : '');
      const mini = document.createElement('span'); mini.className = 'mini';
      const fill = document.createElement('div'); fill.style.width = `${q.hp}%`; fill.style.background = q.hp > 50 ? '#7dff6a' : q.hp > 25 ? '#ffd34a' : '#ff4a4a';
      mini.append(fill);
      li.append(dot, nm, mini);
      team.append(li);
    }
    const sb = $('scoreboard');
    sb.innerHTML = '<h2>SCOREBOARD</h2>';
    sb.append(statsTable(list.sort((a, b) => b.score - a.score).map(q => ({ ...q, downs: undefined }))));
  },
};

// Pulsing banner for every downed teammate: which way they are, how far, and time left to revive.
const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
let lastAlertKey = '';
function renderDownAlert(s, mine, me) {
  const downed = [...s.players.values()].filter(q => q.state === 1 && q.id !== me);
  const box = $('down-alert');
  const rows = downed.map(q => {
    if (!mine) return { q, arrow: '!', dist: '' };
    const a = Math.atan2(q.y - mine.y, q.x - mine.x);
    const arrow = ARROWS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
    return { q, arrow, dist: `${Math.round(Math.hypot(q.x - mine.x, q.y - mine.y) / 16)}m` };
  });
  const key = rows.map(r => `${r.q.id}${r.arrow}${r.dist}${r.q.bleed}`).join('|');
  if (key === lastAlertKey) return;
  lastAlertKey = key;
  box.classList.toggle('hidden', !rows.length);
  box.innerHTML = '';
  for (const { q, arrow, dist } of rows) {
    const div = document.createElement('div');
    const arr = document.createElement('span'); arr.className = 'arrow'; arr.textContent = arrow;
    const name = document.createElement('span'); name.textContent = `${q.name} IS DOWN - REVIVE!`; name.style.textShadow = `0 0 6px ${q.color}`;
    const info = document.createElement('small'); info.textContent = `${dist} · ${q.bleed}s`;
    div.append(arr, name, info);
    box.append(div);
  }
}

function statsTable(rows) {
  const table = document.createElement('table');
  table.className = 'stats';
  const hasDowns = rows.some(r => r.downs !== undefined);
  table.innerHTML = `<tr><th>Player</th><th>Score</th><th>Kills</th>${hasDowns ? '<th>Downs</th><th>Revives</th>' : ''}</tr>`;
  for (const r of rows) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = r.name; name.style.color = r.color;
    tr.append(name);
    for (const v of hasDowns ? [r.score, r.kills, r.downs, r.revives] : [r.score, r.kills]) {
      const td = document.createElement('td'); td.textContent = v; tr.append(td);
    }
    table.append(tr);
  }
  return table;
}

function showToast(text, color) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text; el.style.color = color;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 3000);
}

function startGame(mapId, options = {}) {
  endGame();
  unlockAudio();
  show('none');
  document.body.classList.add('playing');
  lastHudKey = '';
  game = new GameClient({ canvas: $('game'), send, myId, isTyping: () => chatOpen, hud, mapId, options });
  game.start();
}

function endGame() {
  if (game) game.stop();
  game = null;
  if (chatOpen) closeGameChat();
  document.body.classList.remove('playing');
  $('scoreboard').classList.add('hidden');
}

function showGameOver(m) {
  setTimeout(() => {
    endGame();
    $('over-round').textContent = `You survived until round ${m.round}.`;
    const table = $('over-table');
    table.replaceWith(Object.assign(statsTable(m.stats), { id: 'over-table' }));
    show('gameover');
  }, 1500);
}

$('over-btn').onclick = () => { show(room ? 'room' : 'menu'); renderRoom(); };

// Handy for poking at the running game from the dev console.
window.dsa = { get game() { return game; } };

connect();
