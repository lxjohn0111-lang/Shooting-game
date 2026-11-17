# VANTA PROTOCOL

A cinematic first-person shooter for the web, built for [CrazyGames](https://www.crazygames.com) with the CrazyGames SDK v3 integrated.

Kestrel Station's autonomous security grid has gone rogue. Fight through a six-mission campaign — from the perimeter yard at golden hour to a boss fight under a total eclipse — then take it online in **ranked multiplayer**: Deathmatch and Domination on randomly generated maps.

Everything is generated at runtime: textures, models, sound effects and music. There are no asset files, so the whole game is about 1 MB.

## Features

- **Campaign** — 6 missions with varied objectives (eliminate, hold-the-zone uplinks, destroy cores, survive-and-extract, boss), 3-star ratings, three difficulties
- **Ranked multiplayer** — real-time online matches on a random map every time
  - **Deathmatch**: 8-player free-for-all, first to 25 eliminations
  - **Domination**: 5 v 5, capture and hold points A, B and C, first to 250
  - matchmaking searches for up to 30 seconds, then fills every empty seat with AI operatives; players can also drop into a running match and take over an AI seat
  - rating (MMR) with 7 tiers and 3 divisions each, placement matches, match history
- **7 weapons** — pistol, assault rifle, SMG, shotgun, scoped marksman rifle, grenade launcher, charge railgun; each with upgrades
- **6 enemy types** — Wasp drones, Sentinel troopers, Skitter suicide crawlers, Lancer snipers, shielded Bulwark heavies, and the COLOSSUS siege walker boss with destructible heat cores
- **Movement & abilities** — sprint, crouch, slide, jump, ADS, melee, frag grenades, Neural Focus (slow motion)
- **Progression** — credits, weapon purchases, upgrade tracks, operator augments, ranks; cloud-saved through the SDK
- **Rendering** — HDR pipeline with PBR materials, GPU-baked procedural textures, soft sun shadows, SSAO, bloom, god rays, ACES tonemapping, volumetric light shafts, rain, lightning, six lighting presets
- **Audio** — fully synthesized 3D sound effects, reverb, and adaptive music that follows combat intensity
- **Platforms** — desktop (mouse + keyboard) and mobile (touch controls), four quality presets plus automatic dynamic resolution

## Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look / Fire / Aim | Mouse / `LMB` / `RMB` |
| Sprint | `Shift` |
| Jump | `Space` |
| Crouch (slide while sprinting) | `C` |
| Reload | `R` |
| Switch weapon | `1`–`7`, mouse wheel, `X` (previous) |
| Frag grenade | `G` |
| Melee | `F` |
| Neural Focus | `Q` |
| Interact | `E` |
| Scoreboard (multiplayer) | `Tab` |
| Pause | `P` / `Esc` |

## Running locally

The game is plain static files with no build step. Serve the folder with any static web server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Opening `index.html` directly from disk will not work, because browsers block ES modules on `file://`.

## Multiplayer

### How it works

There is no game server logic. Every player publishes about 20 small state updates per second: their own position and a short ring of recent events (hits they dealt, their own death, grenades). One player in each match is the **host**: it also publishes the match state — phase, clock, roster, scores, capture points — and simulates the AI operatives.

- Each player is authoritative for their own movement and health. A shooter reports a hit; the victim applies it and reports its own death; the host tallies kills.
- If the host leaves or hides its tab, the remaining player with the lowest id takes over from the last match state, so the match continues.
- Two players who start searching at the same moment are merged into one lobby.
- Leaving a running ranked match counts as a loss.

Rating is Elo-based: wins against stronger lobbies pay more, placement matches move faster, and a win never costs rating.

### Transports

`js/net/transport.js` picks the first one available:

1. **claude.ai artifact room** — when the game runs as a claude.ai artifact, viewers who have it open play together through the platform's real-time room. Nothing to deploy.
2. **WebSocket relay** (`server/relay.js`) — for CrazyGames or any other host.
3. **Offline** — no network: you still get a full match, with every other seat filled by AI.

### Deploying the relay for CrazyGames

The relay is a ~150-line Node.js server that only forwards presence between players in named rooms.

```bash
cd server
npm install
PORT=8080 npm start          # health check: GET /health
```

Deploy it to any Node host that supports WebSockets (Render, Fly.io, Railway, a VPS…), then put its secure URL in `js/config.js`:

```js
export const MP_SERVER_URL = 'wss://your-relay.example.com';
```

For local testing the relay can also serve the game: `PORT=8765 STATIC=.. node server/relay.js`, then open `http://localhost:8765/?mpserver=ws://localhost:8765` in two browser windows.

## Publishing on CrazyGames

1. Deploy the multiplayer relay and set `MP_SERVER_URL` (see above).
2. Zip the game files (`index.html`, `css/`, `js/`) — not the `server/` folder.
3. Upload the zip in the [CrazyGames Developer Portal](https://developer.crazygames.com) as an HTML5 game.
4. Use the portal's QA tool to verify the SDK events below.

### SDK integration (`js/sdk.js`)

| SDK feature | Where it is used |
| --- | --- |
| `SDK.init()` | On boot, before loading |
| `game.loadingStart()` / `loadingStop()` | Around texture baking and level build |
| `game.gameplayStart()` / `gameplayStop()` | Mission start/resume and pause/death/results/menu |
| `game.happytime()` | Mission complete and boss kill |
| `ad.requestAd('midgame')` | Between missions and on retry |
| `ad.requestAd('rewarded')` | Revive after death, double credits on the results screen |
| `data.getItem()` / `setItem()` | Save data (falls back to `localStorage`) |
| `game.settings.muteAudio` + settings listener | Platform mute |
| `user.systemInfo` | Mobile detection |

Audio is muted and gameplay is paused while ads play. Every SDK call is guarded, so the game also runs standalone when the SDK is unavailable — in that case rewarded actions are simply granted.

## Project layout

```
index.html        page, HUD and menu markup
css/style.css     UI styling
js/main.js        bootstrap
js/game.js        state machine, mission director, objectives, pickups, scoring
js/gfx.js         renderer, HDR post-processing, sky, lighting presets
js/textures.js    GPU procedural PBR texture baker, sprite atlases
js/materials.js   material library and shader patches
js/level.js       procedural level kit, collision, navigation
js/models.js      mesh builder and weapon view-models
js/player.js      movement, camera feel, weapons, view-model animation
js/enemies.js     enemy models, AI, boss
js/projectiles.js bolts, grenades, missiles, explosions
js/fx.js          particles, decals, casings, debris, weather
js/audio.js       synthesized sound effects and adaptive music
js/ui.js          HUD and menus
js/sdk.js         CrazyGames SDK wrapper
js/save.js        persistence
js/net/transport.js  multiplayer transports (artifact room, WebSocket relay, offline)
js/mp/session.js  matchmaking, match host logic, events, scoring, ranked results
js/mp/bots.js     AI operatives that fill empty seats
js/mp/avatar.js   remote players as seen locally (interpolated, animated)
js/mp/ranked.js   rating, tiers, callsigns
server/relay.js   WebSocket relay for multiplayer outside claude.ai
js/config.js      weapons, enemies, missions, balance data
js/lib/           three.js r187 (MIT), bundled into one file
```

### QA URL parameters

`?m=1`…`6` starts a mission directly, `?mp=dm|dom` starts a multiplayer search (`&mpserver=ws://…` relay, `&mpwait=N` search seconds, `&mptime=N` match length, `&mplimit=N` score limit, `&mpname=` callsign), `?god=1` disables damage, `?q=low|medium|high|ultra` forces a quality preset, `?credits=N` sets credits.

## Credits

Rendering uses [three.js](https://threejs.org) (MIT license, see `js/lib/THREE-LICENSE.txt`). All other code, art and audio are original and procedurally generated.
