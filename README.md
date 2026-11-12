# VANTA PROTOCOL

A cinematic first-person shooter for the web, built for [CrazyGames](https://www.crazygames.com) with the CrazyGames SDK v3 integrated.

Kestrel Station's autonomous security grid has gone rogue. Fight through a six-mission campaign — from the perimeter yard at golden hour to a boss fight under a total eclipse — then test yourself in endless **Onslaught** mode.

Everything is generated at runtime: textures, models, sound effects and music. There are no asset files, so the whole game is about 1 MB.

## Features

- **Campaign** — 6 missions with varied objectives (eliminate, hold-the-zone uplinks, destroy cores, survive-and-extract, boss), 3-star ratings, three difficulties
- **Onslaught** — endless scaling waves with elite variants and resupply drops
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
| Pause | `P` / `Esc` |

## Running locally

The game is plain static files with no build step. Serve the folder with any static web server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Opening `index.html` directly from disk will not work, because browsers block ES modules on `file://`.

## Publishing on CrazyGames

1. Zip the contents of this folder (`index.html`, `css/`, `js/`).
2. Upload the zip in the [CrazyGames Developer Portal](https://developer.crazygames.com) as an HTML5 game.
3. Use the portal's QA tool to verify the SDK events below.

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
js/config.js      weapons, enemies, missions, balance data
js/lib/           three.js r187 (MIT), bundled into one file
```

### QA URL parameters

`?m=1`…`6` starts a mission directly, `?onslaught=1` starts Onslaught, `?god=1` disables damage, `?q=low|medium|high|ultra` forces a quality preset, `?credits=N` sets credits.

## Credits

Rendering uses [three.js](https://threejs.org) (MIT license, see `js/lib/THREE-LICENSE.txt`). All other code, art and audio are original and procedurally generated.
