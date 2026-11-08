# Dead Arcade
names a work in progress

Top-down, pixel-art co-op zombie shooter for 2–6 friends, inspired by Black Ops' Dead Ops Arcade.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000. Friends on the same network open `http://<your-LAN-IP>:3000`.
To play over the internet, forward port 3000 on your router or use a tunnel (e.g. ngrok, Cloudflare Tunnel) and share that URL.

Dev options:

- `npm run solo` lets one player start a game (normally 2 are required)
- `node server/index.js --solo --round=5` starts new games on round 5 (the boss)
- `--weapon=katana` (any key from `WEAPONS` in shared/config.js) gives everyone that weapon at the start
- `--powerups` drops one of each powerup and 3 grenades next to the spawn when a game starts
- `PORT=4000` changes the port

## Controls

N next song · WASD move · Shift sprint (uses stamina) · mouse aim · left click shoot · Q throw grenade · Enter chat · Tab scoreboard · M mute

## Music

The songs themselves aren't in this repo. Drop your own audio files into `public/music/` on the machine that hosts the game.

Every audio file in [public/music](public/music) (mp3, ogg, wav, m4a, opus, flac) is shuffled as background music. Name files `Artist - Title.mp3` and the player shows them that way. Music only plays during a match. The server picks the song, and everyone in the match hears the same song in sync. New files join the shuffle when the list next reshuffles.

The player at the bottom of the screen has:

- **Skip** (or press N): changes the song for everyone, and announces it in chat.
- **On/off button:** only silences it for you; it keeps time, so it's still in sync when you turn it back on.
- **Music and SFX volume sliders:** each browser remembers its own settings.

## Custom match options

The host can switch these on in the lobby. They're off by default.

- **Disable zombie eyes:** zombie eyes stop glowing, so you only see zombies in your flashlight or other light.
- **Friendly fire:** bullets, katana swings and explosions hurt teammates. They never hurt the person who fired.

## Maps

The host picks the map in the lobby:

- **Suburb Street:** houses, porch pumpkins, streetlights and a cemetery.
- **Corn Farm:** three cornfields with one-tile furrows (corn blocks movement and bullets), a red barn, a silo, hay bales, a pond, a pumpkin patch and a bonfire in the farmyard. Zombies also crawl out of the corn rows.
- **Dead Mall:**
  - **Inside:** an abandoned mall with a department store (clothing racks, mannequins, a makeup counter), six themed shops and a food court. The atrium has a murky fountain under a broken skylight.
  - **Shops:** each has a neon sign with its name, its own floor, fixtures and light, and a stockroom in the back that zombies come out of.
    - **Pets:** an aquarium wall that glows blue, play pens with puppies, kittens and bunnies, and hamster and bird cages.
    - **Books:** books on every wall, long stacks, a reading nook with a rug and chairs, and a new-releases table.
    - **Music:** an instrument shop with guitars on the walls and on stands, pianos, an amp wall and drum kits.
    - **Arcade, Tech (TVs) and Candy:** the other three shops.
  - **Food court:** McDonald's, Wendy's, Pizza and Tacos stalls, each with its own sign and counter colors.
  - **Emergency exits:** every stockroom, the department store and the food court kitchens have back doors to the parking lot, marked with EXIT signs. Zombies come in through them too.
  - **Lighting:** flickering and burnt-out fluorescents, neon signs that stutter off, and red exit signs.
  - **Outside:** four entrances lead out to a parking lot full of abandoned and burnt-out cars.

Maps are generated in [shared/map.js](shared/map.js). Add one to `MAPS` and `generateMap` to make another.

## How it plays

- **Rounds:** 5, 7, 17, 32, 47, 62, 77... zombies for one player. Each round adds 5 more than the last increase, up to at most 15 more per round. Every extra player adds 25% more zombies (round 11 with 5 players is 214). There are only 4 seconds between rounds.
- **Phasing in:** only so many zombies can be up at once (30 solo, up to 70 with 6 players). The rest wait their turn and rise as you kill the ones on the field.
- **Health regen:** after 6 seconds without getting hit, you slowly heal at half a point per second.
- **Every 5th round:** no horde, just the Gourd King boss.
  - **HP:** the 25 / 35 / 45... curve is doubled, then +75% for each extra player (round 5: 50 solo, 88 with 2 players, 238 with 6).
  - **Round 5 boss:** only charges and ground-slams.
  - **From round 10:** he also lobs flaming pumpkin bombs (a red circle marks where each one lands) and raises minions from the ground.
  - **Enrage (round 10 on):** below half HP he moves faster, attacks more often, slams wider and throws 5 bombs instead of 3.
  - **Finding him:** an icon at the screen edge points to him when he's off screen. The dots show how far away he is.
- **Gore:** hits spray blood in the direction of the shot. Kills leave corpses and blood pools and send gibs flying. Explosions blow zombies apart, and close kills splash blood on your screen. Blood only stays on walkable floor (never on walls) and fades away over about a minute and a half.
- **Drops:** every dropped item lights up the ground around it, with a pulsing ring and a bouncing arrow in its color so it's easy to spot in the dark.
- **Weapons:** when a pickup weapon runs dry (ammo, or katana swings) you go back to the handgun (infinite ammo).
  - From the start: Katana (melee, hits everything in an arc), Double Pistols, Shotgun, Laser (pierces through zombies)
  - Unlocked by the round 5 boss: Uzi, AK-47, M16, Machine Gun
  - Unlocked by the round 10 boss: Rocket Launcher, Grenade Launcher (bouncing grenades)
- **Boss drops:** each boss drops health plus one random weapon from the tier it unlocks. After that, regular zombies can drop that tier too. Bosses after round 10 drop any unlocked weapon.
- **Hand grenades (Q):**
  - **Throwing:** a round bomb that you lob toward your cursor. It lands about where you aim, bounces off walls and blows up after about a second, or right away if it hits a zombie.
  - **Carrying:** you can hold 3, shown as pips by your ammo. If you're full, extra grenades stay on the ground for teammates.
  - **Drops:** regular zombies only (never the boss). When a zombie drops loot, 70% of the time it's a grenade.
- **Drops:** 9% of kills drop something on round 1, rising 0.25% per level up to 15%. 70% of that loot is a grenade; the rest is health (weight 30) or a gun picked by weight.
- **Gun rarity:** dropped guns glow in their rarity color, and your HUD shows the weapon name in that color.

  | Rarity | Color | Guns | Starting weight → cap |
  |---|---|---|---|
  | Common | green | Double Pistols, Katana | 50 → 75 |
  | Rare | blue | Shotgun | 50 → 70 |
  | Epic | purple | Uzi, Machine Gun | 40 → 60 |
  | Legendary | red | AK-47, M16 | 40 → 55 |
  | Mythic | gold | Grenade Launcher | 30 → 45 |
  | Prismatic | rainbow | Rocket Launcher | 30 → 40 |
  | Cosmic | shifting purple/cyan, sparkles | Laser | 5 → 12 |

  Each gun's weight grows by 1 per level, starting from the round it unlocks, until it hits its cap. Gold, rainbow and cosmic drops also send up a pillar of light, and the team gets a message when someone picks one up.
- **Launcher ammo:** Rocket Launcher has 18 rockets, Grenade Launcher has 26.
- **Powerups:** about 2 per 100 kills, rolled separately from regular drops.
  - **Invincibility (10s):** nothing can hurt you, and any zombie you touch dies (the boss takes a chunk of damage instead). You also move faster and flash rainbow colors.
  - **Invisibility (12s):** zombies ignore you and won't chase you, but bumping into one still hurts.
  - **Nuke:** kills the 50 zombies closest to whoever grabs it (not the boss).
  - **Minigun (12s):** a minigun with unlimited ammo replaces your gun until the timer runs out, then you get your gun back with its ammo untouched.
- **Flashlights:** stop at walls, houses, trees, corn and tall shelves, but shine through glass, water, fences and low fixtures.
- **Round clear:** "Catch your breath" (1% of the time it says "Take a Drink").
- **Downed:** at 0 HP you go down. Stand next to a downed teammate for 2.5s to revive them. If nobody does within 20s, they're out until the next round. If everyone is down, it's game over.
  - **Teammate alerts:** everyone else hears an alarm, sees a banner and a red screen flash, and gets a pulsing alert. The alert shows which way the downed player is, how far, and how long until they bleed out.

All tuning (speeds, damage, drop rates, round curve) lives in [shared/config.js](shared/config.js).

## Layout

- `server/index.js`: static file server and the WebSocket lobby, matchmaking and chat
- `server/game.js`: the authoritative simulation (rounds, zombies with flow-field pathing, boss, bullets, drops)
- `server/music.js`: the shared music station for each match
- `shared/`: config and the deterministic suburb map, used by both server and client
- `public/js/game.js`: client prediction, interpolation, and the renderer (darkness, colored lights, bloom, fog)
- `public/js/art.js`: procedural pixel art (no image assets)
- `public/js/gore.js`: blood, gibs and splatter
- `public/js/audio.js`: synthesized sound effects
- `public/js/music.js`: the music player that follows the server's station
