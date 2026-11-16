# emberline-fps

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Sheldon460/emberline-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Sheldon460/emberline-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**Emberline** — an original dusk-foundry tactical FPS on three.js. 5v5 round-based
play in the Emberworks Yard: two bomb sites (A furnace hall, B crane dock), three
lanes, a bomb to plant and defuse, a per-round economy with a buy menu, five
weapons plus frag and smoke grenades, and bots that patrol routes, hold positions
and react to sight and sound. First to 5 rounds takes the match.

Gunplay rewards stopping to aim: raycast hits against head/torso/legs, headshot
bonus, recoil and spread that punish firing on the move, crouch and ADS to
tighten the cone, acceleration and map collision throughout.

No build step, no network at runtime: static files under `game/`, three.js 0.187.0
vendored, WebAudio-synthesised sound effects.

## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

Click to lock the pointer. WASD move, Shift sprint, C crouch, right mouse ADS,
R reload, B buy menu, G frag grenade, H smoke grenade, E plant the charge, M mute.

## Layout

- `game/index.html` — import map, HUD DOM + CSS
- `game/src/main.js` — boot, fixed 60 Hz sim loop, combat raycasts, `?shot=` runner
- `game/src/state.js` — the single game state store
- `game/src/map.js` — Emberworks Yard geometry, colliders, waypoint graph
- `game/src/player.js` — FPS movement, look, reload, planting
- `game/src/bots.js` — bot AI: routes, vision, hearing, plant/defuse
- `game/src/rounds.js` — round lifecycle, economy, buy menu
- `game/src/weapons.js` — weapon defs, spread/recoil, grenade physics
- `game/src/hud.js` — HUD, minimap, killfeed, buy menu, banners
- `game/src/audio.js` — WebAudio synth SFX
- `game/src/input.js` — keyboard / mouse / pointer lock
- `game/src/utils.js` — seeded RNG, ray/AABB/sphere helpers
- `main.ts` — the entry program: copies `game/` + `screenshots/` to `/output`
  and writes `dossier.json`

---

<sub>Entered on [make.fun](https://make.fun/?ref=rxp0nfcx&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
