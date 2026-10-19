# FRONTLINE

**One arena. Two fighters. No second chances.**
A cinematic 3D tactical 1v1 shooter that runs in the browser, with a scroll-driven presentation site, offline practice against a tactical AI, and real online multiplayer through a Node.js server-authoritative game service.

**Made by Usairam Hassan.**

---

## Quick start

```bash
npm install
npm run dev          # client on http://localhost:5173 (proxies /ws and /api to :8787)
npm run server       # game server on :8787 (needed only for online play)
```

Production (one process serves the built client and the realtime server):

```bash
npm start            # = vite build && node server/index.js   → http://localhost:8787
PORT=9000 npm start  # custom port
```

- `/` opens the cinematic site. `/#play` jumps straight to the game menu. `/#play/armory`, `/#play/store` and similar links open individual screens.
- Practice against bots needs no server and keeps working offline once the page has loaded. The match code is prefetched and the fonts are bundled.

## Controls

| Action | Keys |
| --- | --- |
| Move / sprint / crouch / jump | `WASD` / `Shift` / `C` or `Ctrl` / `Space` |
| Fire / aim down sights | Left mouse / right mouse |
| Reload / switch weapon | `R` / `1`, `2` or mouse wheel |
| Operator ability | `Q` (or `E`) |
| Inspect weapon / pause | `T` / `Esc` |

On touch devices you get an on-screen stick, look-drag and action buttons automatically.

## What's in the box

| Area | Implementation |
| --- | --- |
| **Rendering** | Three.js with ACES tone mapping, PCF soft shadows, MSAA HDR composer, bloom, bokeh depth of field (menus), and a custom grade pass (vignette, grain, chromatic fringe, split-tone). Each map's reflections come from a PMREM environment captured from that map. Static props are merged into a few draw calls; the menu runs about 640 calls per frame, a match about 200. |
| **Art** | Everything is procedural: tileable PBR textures generated on canvas (albedo, normal, roughness/metal maps for concrete, wet asphalt, brick, sand, snow, ice, corrugated steel, MOLLE webbing and more), operators built from lathe-profiled limbs with two-bone IK hands, and fictional weapons with moving bolts, slides, pumps, cylinders and magazines. |
| **Atmosphere** | GPU particle rain, splashes, snow, dust and smoke, volumetric light shafts and cones, additive light pools, neon signage, flickering lights. |
| **Audio** | All sound is synthesised live with Web Audio: layered gunshots per weapon, HRTF-positioned enemy fire and footsteps, surface-aware foley, mechanical reloads, ability sounds, generated convolution reverb, ambience beds for each map, and an adaptive score. |
| **Gameplay** | First-person kinematic controller with step-up and stairs, ADS, recoil with recovery, spread and bloom, headshots, damage falloff, per-shell and bolt/pump cycling, weapon switching, round-based 1v1 (first to 3/4/5), round timer, kill feed, win/loss. |
| **Bot AI** | Perception limited by field of view and a line-of-sight raycast that respects walls. It hears gunfire and sprinting, reacts to damage, plans paths with grid A* and smoothing, seeks cover hidden from the player, peeks, strafes, flanks (HARD), reloads in cover, leads targets, and uses abilities. Difficulty changes only perception and decision quality, never damage. |
| **Operators** | VOLT (free), PHANTOM, BULWARK, MEDIC. Every operator has 100 HP. Abilities run on cooldowns that carry over at half value between rounds, and the server enforces them online. |
| **Weapons** | 7 fictional weapons across 5 categories, each with its own handling, recoil, fire rate, reload and sound. 7 finishes per weapon. The armory selection is the weapon you carry into matches. |
| **Maps** | Neon District, Desert Outpost, Arctic Facility, Abandoned Industrial Zone. Each has its own layout, lighting, weather, cover, tactical routes, spawns, nav grid and a 3D preview. All four are defined once in `src/shared/maps/`, and both the client and the server use that definition. |
| **Progression** | Credits come from match completion, wins, rounds, eliminations, headshots, flawless rounds, accuracy, daily challenges (3 per day) and one-time objectives. You spend them on operators, weapons, finishes, outfits and banners, and every purchase is confirmed and then animated. There are no real-money purchases. |
| **Site** | GSAP ScrollTrigger story with pinned sections. The scroll drives the real game sets: the Neon standoff, a crane over the battlefield, the armory and operator studios with live demos, a tour of the actual maps, and a hand-off of the Neon set into the playable menu. It ends with a credits section. It also works with ordinary scrolling, anchor links and reduced motion. |

## Online multiplayer

`server/index.js` is a real WebSocket service. It is not a simulation.

- **Matchmaking and rooms.** It runs a quick-match queue and private rooms with 4-letter codes.
- **Lobby.** The lobby shows both players, loadouts (validated against server-owned unlocks), map voting, ready-up and a 5-second countdown.
- **Authoritative match** (`server/match.js`):
  - The server owns health, ammo, reloads, weapon switches, cooldowns, barriers, rounds, the timer and the score.
  - Client movement is checked against a speed budget and collision. If it fails, the server sends a correction.
  - Every shot is re-traced on the server against the shared collision world. Hits use lag compensation: the target is rewound up to 250 ms using position history.
  - Opponents are interpolated 100 ms behind live for smooth rendering.
- **Connections.** If a player disconnects, the opponent is told. The player has 15 seconds to reconnect and resume (same token). After that the match ends as a forfeit win.
- **Server-held profiles.** On the first online connection the local profile is imported once (trust-on-first-use, sanitised, credits capped). After that the server is the only party that changes credits or unlocks:
  - Purchases are validated server-side.
  - Online rewards are computed from stats the server observed.
  - Practice rewards for linked profiles are client-reported, so they are rate-limited and capped per day.
  - Profiles persist in `server/data/profiles.json`.

**Requirements for internet play.** Deploy `npm start` to any host that supports WebSockets (Fly.io, Render, Railway, a VPS behind nginx with `Upgrade` headers), served over HTTPS so the client uses `wss://`. The client connects to the same origin's `/ws` by default. To use another host, set a URL under Settings → Profile → Server URL. For more than a single node, swap the JSON profile store for a database. Accounts are anonymous device tokens. Add OAuth or email login if players need cross-device identity.

## Tests

```bash
node tests/botsim.mjs normal 90      # headless bot-vs-bot on all 4 maps (nav, LOS, fire, rounds)
FRONTLINE_TEST_SPAWNS=1 npm run server & npm run dev &
node tests/online-e2e.mjs            # two real Chromium clients play an online match end to end
node tests/abilities-store-e2e.mjs   # store purchase/persistence + Bulwark, Phantom, Medic abilities in a live match
```

`FRONTLINE_TEST_SPAWNS=1` puts both players on a clear sightline so the online test can check server-side hits deterministically. Never set it in production.

## Project layout

```
src/
  shared/        weapons, operators, rules/rewards, collision, map layouts (client + server)
  engine/        renderer/composer, procedural textures & materials, audio, input
  models/        procedural operators (IK), weapons (moving parts), ability FX, mesh merging
  world/         map builder, prop library, atmosphere (rain/snow/smoke/shafts)
  game/          match loop, viewmodel, effects, bot AI, nav grid, abilities, online session, net
  stages/        menu set, studio (operators/armory), map preview
  site/          scroll-story stage + GSAP choreography
  ui/            app shell/router, HUD, pause, screens (menu, play, lobby, operators, armory, maps, store, settings, results, credits)
  state/         settings & progression (local persistence, server mirroring)
server/          HTTP + WebSocket server, matchmaking/rooms, authoritative match, profiles
tests/           bot simulation, online end-to-end
```

## Honest notes

- **Models and sound.** All art and audio are generated in code. There are no licensed or external model files, and no recorded audio. The look comes from lighting, materials and post-processing. Replacing the procedural operators with skinned, motion-captured models would be the biggest single visual upgrade.
- **Physics.** Collision is a custom deterministic axis-aligned kinematic system, shared verbatim by the client, the bots and the server. That sharing is why server validation and the bots' line-of-sight checks match what players see. No rigid-body engine is used.
- **Online trust.** Movement is client-predicted and server-validated rather than fully server-simulated, which is common for browser shooters. The server always receives the opponent's position, so a modified client could build a wallhack. A future step would cull the opponent's position from snapshots when there is no line of sight.

---

FRONTLINE · All operators, weapons and locations are fictional · **Made by Usairam Hassan**
