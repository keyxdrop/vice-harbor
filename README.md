# VICE HARBOR

[![make.fun bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/keyxdrop/vice-harbor/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/keyxdrop/vice-harbor/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime sandbox in the browser, built with three.js and
handed in for the make.fun bounty [gta6-01](https://make.fun/bounty/gta6-01).
One city, one fixer, no brakes: steal cars, run packages for Mara Voss, dodge
the Vice Harbor PD and build your name mission by mission.

## The game

- **A living city** — a sunlit coastal grid of pastel towers, palms, lamps and
  a working harbour with pier and boats, all generated deterministically.
- **Walk and drive** — third-person on foot, and any car on the street can be
  taken (F). Arcade driving with acceleration, braking, reverse, handbrake and
  crash physics.
- **Traffic and crowds** — AI cars work the road network, brake for obstacles
  and turn at intersections; pedestrians stroll the sidewalks and flee trouble.
- **Wanted system** — crimes raise your stars; police interceptors hunt you,
  ram you, and bust you if they pin you down. Break their line of sight to
  cool the heat. Get wasted or busted and you wake up at Harbor Clinic, lighter
  in the wallet.
- **Story missions** — meet fixer Mara Voss, then run a three-mission chain:
  *First Run* (package pickup and delivery), *Hot Wheels* (steal the magenta
  coupe), and *Harbor Heat* (pier pickup under a three-star chase) — dialogue,
  gold beacon objectives and cash rewards throughout.
- **Combat** — a rival crew holds the east-central crossing; take them on with
  hitscan gunplay, tracers, muzzle flash and damage feedback.
- **HUD and minimap** — health, cash, wanted stars, objective panel, dialogue,
  speedometer, bust meter, and a live minimap with traffic, police, rivals and
  the objective marker.
- **Start screen, pause, saves** — title with brief and controls, pause menu,
  and a localStorage save (cash + mission progress) with Continue.

Controls: WASD move/drive · Shift sprint · F enter/exit car · mouse orbit /
click or Space to shoot · Space handbrake in a car · E skip dialogue · P pause.

## Layout

- `main.ts` — the entry program: copies `game/` + `screenshots/` to the output
  directory and writes `dossier.json` via `vendor/makefun-game.ts`.
- `game/` — the static game (no build step, no network): `index.html`, ES
  modules under `game/src/`, three.js vendored under `game/vendor/`.
- `screenshots/` — four staged scenes, reproducible from `shots.json` queries
  (`?shot=drive|chase|mission|combat&seed=1`).

Run it locally: serve `game/` with any static server and open `index.html`.
Rehearse the hand-in: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`.

## License

MIT — see `LICENSE`. Vice Harbor is an original work: its city, characters and
name are its own.
