# Dead Suburb Arcade: notes for Claude

A top-down, pixel-art Halloween co-op zombie shooter for 2–6 friends, inspired by Black Ops' Dead Ops Arcade. Players connect in the browser; a small Node server runs the lobbies, chat, shared music and the whole game simulation. The README covers how the game plays. This file covers how the code fits together and what to watch out for when changing it.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000. On Windows PowerShell, `npm` may be blocked by the script execution policy. Use `npm.cmd start` or `node server/index.js` instead.

Dev flags (combine as needed):

- `--solo`: one player can start a game (normally 2 are needed)
- `--round=N`: games start on round N (e.g. `--round=5` for the first boss, `--round=10` for the full boss)
- `--weapon=KEY`: everyone starts holding that weapon (any key in `WEAPONS`)
- `--powerups`: drops one of each powerup, three grenades and a laser next to the spawn
- `PORT=3001`: a different port, so you can test without stopping a game people are playing

Example: `node server/index.js --solo --round=10 --powerups`.

There's no build step and no bundler. The browser loads plain ES modules straight from `public/` and `shared/`.

## Layout

```
server/index.js    HTTP static server (with Range support for audio) + WebSocket lobbies, matchmaking, chat,
                   lobby options, dev flags. Creates a Game and a music Station per match.
server/game.js     The authoritative simulation for one match: rounds, spawning, zombies (flow-field pathing),
                   the boss, bullets/explosions, drops, powerups, revives, regen. Sends snapshots at 20 Hz.
server/music.js    Shared music: picks the song and its start time; clients follow it.
shared/config.js   ALL tuning: player, weapons, rarities, drop rates, powerups, zombies, round curve, boss.
shared/map.js      Deterministic map generators (suburb, farm, mall), tile types, collision, light blocking.
public/index.html  Menus, lobby, HUD, chat, music player (all plain DOM).
public/js/main.js  WebSocket client, menus/lobby/HUD/chat, starts GameClient when a match starts.
public/js/game.js  GameClient: input, own-player prediction, interpolation, and the whole renderer
                   (darkness, coloured lights, bloom, flashlight ray-casting, drops, particles, overlays).
public/js/art.js   Every sprite and tile, drawn procedurally with fillRect (there are no image files),
                   plus a 3x5 pixel font for signs.
public/js/gore.js  Blood splats, gibs, mist, screen splatter.
public/js/audio.js Synthesized sound effects (WebAudio), no audio files.
public/js/music.js Background music player that follows the server's station.
public/music/      Songs (not in git; see .gitignore). Any audio file dropped here plays during matches.
```

`shared/` is imported by both the server (Node ESM, `"type": "module"`) and the browser (served at `/shared/`). Keep it free of Node-only and browser-only APIs.

## How the networking works

- **Server-authoritative:** the server decides hits, kills, damage, drops and pickups. Clients send `input` (their position + aim, about 30/s), `shoot` (angles), `throw` (Q grenade) and lobby/chat messages.
- **Movement is client-predicted:** the server accepts the client's position but clamps it to a max speed and runs it through the same `moveCircle` collision. `p.tp` bumps when the server teleports a player (e.g. respawn), so the client knows to snap.
- **Snapshots** are compact arrays, not objects (see `snapshot()` in server/game.js and `onSnapshot()` in public/js/game.js). **If you add a field, add it at the end of the array on both sides** and keep the index comments in sync. Current player row ends with `..., star, ghost, frags, minigun`.
- **Events** (`ev` in each snapshot) drive one-off effects: `shot`, `hit`, `kill`, `boom`, `pickup`, `nuke`, `down`, `revive`, `round`, `clear`, `slam`, `throw`, etc. Visual-only bullets are simulated on each client from `shot`/`throw` events; the server's bullets are the real ones.
- **The client renders about 100 ms in the past** (`INTERP_DELAY`), interpolating between snapshots. Your own player is drawn at the predicted position.

## Codes that must stay in sync

- **Weapon codes** are indexes into `WEAPON_LIST` (shared/config.js). Only append to the end; reordering breaks `GUN_LOOK` in art.js (held-gun sprites, indexed by code) and the `switch` in `audio.js sfx.shot`.
- **Drop codes** are indexes into `DROP_TYPES` = health, then droppable weapons, then powerups. They're computed, so client and server always agree. The **drop sprite code in art.js (`drawDrop`) switches on the key name**, not the number, so adding weapons or powerups doesn't shift anything. Keep it that way.
- Weapons with `tier: -1` (`frag`, `minigun`) are never in the boss or loot gun pools. `droppable: false` keeps `minigun` out of `DROP_TYPES` (the powerup with the same key is what drops).
- **Tile types** are the `T` object in shared/map.js. Add new ones at the end. If a tile should block movement, add it to `SOLID`. If it's a store fixture drawn on top of a floor, add it to `FIXTURES`. If it should block flashlights, add it to `OPAQUE`.
- Map decor that sits **on** a solid tile (screens, TVs, tanks, pens, stalls...) must be listed in `ON_FIXTURE`, or it gets filtered out.

## Game systems worth knowing

- **Rounds:** `zombieCountForRound` (curve with a growth cap, scaled by player count). Zombies **phase in**: at most `maxAliveZombies(players)` are up at once; the rest queue. Every 5th round is a boss round.
- **Boss** (`bossBrain` in server/game.js, `BOSS` in config): the round 5 boss only charges and slams. From `BOSS.advancedFrom` (round 10) he also lobs pumpkin bombs, summons minions, and enrages below half HP.
- **Drops** (`killZombie`): a per-kill chance that rises with the level (`dropChance`). 70% of loot is a hand grenade (`FRAGS.dropShare`); the rest is health or a gun picked by weight. Gun weights grow +1 per level after the gun unlocks, up to a per-gun cap (`GUN_DROPS`). Powerups roll separately (`POWERUP_CHANCE`).
- **Rarity** (`RARITIES`, `GUN_DROPS[...].rarity`) only affects visuals: drop glow/ring/arrow colour, HUD weapon colour, pickup messages. `rainbow` and `cosmic` are animated in `dropColor()` (game.js).
- **Powerups:** `star` (invincible, touching zombies kills them), `ghost` (zombies ignore you, contact still hurts), `nuke` (kills the 50 nearest non-boss zombies), `minigun` (overrides your gun with an unlimited minigun). Timers are on the player object and sent in snapshots.
- **Lobby options** (`MATCH_OPTIONS`): `noEyes` (client-only: no glowing zombie eyes) and `friendlyFire` (server: bullets, swings and blasts hurt teammates, never the shooter). Options are copied into the Game at start and sent to clients in the `start` message.
- **Character looks** (`LOOKS`, `randomLook` in config): the server gives each client a `look` when they join a lobby (and on a `reroll` message), never reusing a skin tone or hairstyle already in the room. Keep both pools bigger than `MAX_PLAYERS`. Looks travel in the lobby's `room` message, not in snapshots; GameClient reads them through `getLook(id)`. `art.drawPlayer` draws the person from a look, and `art.drawAvatar` draws the lobby portrait.
- **Shared music:** the station only exists while a match is running. Clients report `musicEnded`, and a `seq` number makes stale or duplicate reports harmless. Local pause just mutes, so the player stays in sync.

## Rendering notes (public/js/game.js)

- Internal resolution is low (about 240 px tall, scaled up with `image-rendering: pixelated`). Coordinates in world space are pixels; tiles are 16 px.
- **Layers, in order:** pre-rendered map background (`art.renderMapBackground`, done once per match) → decal layer (blood/corpses) → world sprites → darkness/lighting → bloom → overlays (markers, HUD-ish bits drawn on canvas).
- **Lighting:** a dark layer with lights cut out (`destination-out`) plus coloured additive pools. `flicker: 1` is a gentle wobble, `flicker: 2` is a dying fluorescent that blacks out (`art.stutter`).
- **Flashlights** are ray-cast each frame (`beamPolygon`) against `blocksLight`, so they stop at walls but pass through glass.
- **Gore** paints onto a separate decal canvas that's clipped to walkable floor every second (`floorMask`) and slowly faded, so walls stay readable. Don't paint gore onto `bgCtx`.
- **Bloom:** anything bright gets pushed to the `emitters` list; it's drawn crisp and then blurred additively.

## Maps (shared/map.js)

Maps are generated from a fixed seed, so the server and every client build the identical map. Never use `Math.random()` in a generator. Use the seeded `rand()` passed around inside it. To add a map: write `generateX()`, return the same shape as the others (`w, h, tiles, houses, decor, lights, spawns, playerSpawn`, optional `floor`/`variant`/`cemetery`), and register it in `MAPS` and `generateMap`. The lobby picker and previews pick it up automatically.

The mall uses two extra per-tile arrays: `floor` (what floor shows under a fixture) and `variant` (which look a fixture uses: bin contents, counter brand, instrument type...).

## Testing changes

There's no test suite. What worked well:

- **Headless simulations:** import `Game` from server/game.js in a small Node script, add players with `addPlayer({ id, name, color })`, set `g.round` / `g.timer`, and call `g.tick()` in a loop (stub `g.stop = () => {}`). This is great for checking drop rates, boss behaviour, round sizes, and that zombies can always reach players.
- **Map connectivity:** after changing a generator, flood-fill from `playerSpawn` over non-solid tiles and check that every walkable tile and every spawn is reachable. Pockets trap zombies and stall rounds.
- **Browser check:** run with `--solo` plus whatever flags you need, open it, and play. `window.dsa.game` is the live GameClient, handy for poking at state from the dev console.

## Conventions

- Plain modern JavaScript (ES modules), no TypeScript, no frameworks, no dependencies besides `ws`.
- All balance numbers live in shared/config.js with a short comment saying what they do. Prefer adding a config value over hard-coding a number in game logic.
- Comments explain *why* or describe what something looks like; keep them short like the existing ones.
- The README is the player-facing description of the game. Update it when gameplay changes.
