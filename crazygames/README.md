# VANTA PROTOCOL — CrazyGames upload package

Everything the CrazyGames developer portal asks for, ready to upload.

| File | What it is | Where it goes in the portal |
| --- | --- | --- |
| `vanta-protocol-crazygames.zip` | The game build (HTML5). `index.html` is at the root of the zip. 352 KB, 27 files. | Game files / build upload |
| `game/` | The same build, unzipped, for testing locally before you upload | — |
| `covers/cover-landscape-1920x1080.png` | Landscape cover, 16:9 | Covers → Landscape |
| `covers/cover-portrait-800x1200.png` | Portrait cover, 2:3 | Covers → Portrait |
| `covers/cover-square-800x800.png` | Square cover, 1:1 | Covers → Square |
| `video/preview-1920x1080.mp4` | 15-second gameplay preview, 1920×1080, 30 fps, H.264, no audio | Preview video |

The covers follow the CrazyGames cover rules: no borders, and the game title is the only text on them.

To rebuild the zip after changing the game, run `./tools/build-crazygames.sh` from the repository root. It refreshes `game/` and the zip; covers and the video are left alone.

## Before you upload

1. **Test the build locally.** From the repository root, run `PORT=8765 STATIC=.. node server/relay.js` (after `cd server && npm install`), then open `http://localhost:8765/crazygames/game/index.html`. The CrazyGames SDK only fully works inside the portal's preview, so locally the game runs with its offline fallbacks.
2. **Decide about multiplayer.** The build ships with `MP_SERVER_URL` empty in `js/config.js`. Without a relay server, the Multiplayer menu still works, but every match is you against AI, and the screen says so ("OFFLINE · NO MULTIPLAYER SERVER"). For real online matches on CrazyGames, deploy `server/relay.js` (see the main README, "Deploying the relay"), set `MP_SERVER_URL` to its `wss://` address, and run the build script again. Only tag the game as multiplayer on CrazyGames once the relay is live.
3. **Use the portal's preview / QA tool** after uploading and check that the SDK events below fire.

## Progress saving (CrazyGames Data module)

All progress is one JSON document saved under the key `vanta_protocol_save_v1` through `window.CrazyGames.SDK.data`:
campaign missions and stars, credits, XP, owned weapons, upgrades and augments, the multiplayer rating, match history and callsign, and the player's settings.

- **Logged-in players**: the save lives on their CrazyGames account, so it follows them across devices.
- **Guests**: the Data module keeps it locally.
- **Logging in mid-session**: when the player logs in, the game switches to that account's progress. If the account has no save yet, the guest progress is written to it instead, so nothing is lost. A switch never happens during a mission or match; it waits for the next menu.
- **Older saves**: a save that a previous build wrote straight to `localStorage` is moved into the Data module once, and the old copy is removed.
- When the SDK is present the game never writes to `localStorage` itself. Outside CrazyGames (local testing, other hosts) it falls back to `localStorage`.
- The SDK must be initialized before the save is read. The game does this on its loading screen.

## SDK integration checklist

| Requirement | Implementation |
| --- | --- |
| SDK v3 script | `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js">` in `index.html` |
| `SDK.init()` | First thing on boot, before the save is read |
| `game.loadingStart()` / `loadingStop()` | Around texture baking and the first level build |
| `game.gameplayStart()` / `gameplayStop()` | Missions and matches start / pause, death, results, menus |
| `game.happytime()` | Mission complete, boss destroyed, multiplayer win |
| Midgame ads | Between missions and on retry |
| Rewarded ads | Revive after death, double credits after a mission |
| Audio during ads | Muted while an ad plays, and gameplay is stopped |
| `game.settings.muteAudio` | Respected at start and when changed |
| `data` module | All progress (see above) |
| `user.systemInfo` | Picks touch controls and the low graphics preset on phones and tablets |
| Dev/QA cheats | URL switches such as `?god=1` are ignored when the SDK reports the `crazygames` environment |

## Store listing (copy and paste)

**Title:** VANTA PROTOCOL

**Short description:**
Fight rogue war machines in a cinematic first-person shooter, then take your skills into ranked Deathmatch and Domination.

**Description:**
Kestrel Station's security grid has gone rogue, and its machines answer to a single directive: VANTA. Fight through a six-mission campaign, from a sunset container yard to a storm-lashed refinery, a burning foundry and a final showdown with a siege walker under a total eclipse.

- Seven weapons with upgrades: pistol, assault rifle, SMG, pump shotgun, scoped marksman rifle, rotary grenade launcher and a charged railgun
- Six enemy types with distinct tactics, weak points and dramatic destruction
- Slide, sprint, aim down sights, throw frags and slow time with Neural Focus
- Ranked multiplayer: free-for-all Deathmatch and 5 v 5 Domination on a new randomly generated map every match, with rating tiers from Iron to Vanta Elite
- Earn credits to unlock weapons, upgrades and operator augments
- Cinematic lighting, weather and procedural audio

**Controls:**
- WASD: move
- Mouse: look
- Left click: fire
- Right click: aim down sights
- Shift: sprint
- Space: jump
- C: crouch (slide while sprinting)
- R: reload
- 1–7 / mouse wheel: switch weapon
- X: previous weapon
- G: grenade
- F: melee
- Q: Neural Focus (campaign)
- E: interact
- Tab: scoreboard (multiplayer)
- P / Esc: pause

**Suggested tags:** shooter, fps, first person shooter, 3d, robots, sci-fi, multiplayer (only with the relay deployed), campaign

**Category:** Shooting

## Things to decide in the portal

- **Mobile:** the game has touch controls and drops to its low graphics preset on phones, but it was built and tested for desktop first. Submit as desktop-only unless you have played it on a phone and are happy with it.
- **Orientation:** landscape.
- **Multiplayer:** only once `MP_SERVER_URL` points at a running relay.
