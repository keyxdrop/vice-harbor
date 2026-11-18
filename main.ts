// Vice Harbor — make.fun gta6-01 entry program (Node 22, standard library only).
//
// The game itself is the static site in game/ (index.html plus ES modules and a
// vendored three.js — a desktop browser runs it fully offline). This program is
// the hand-in: it copies game/ and screenshots/ into the output directory and
// writes dossier.json there with make.fun's vendored dossier builder, using the
// scorer's own caps so an entry the scorer would refuse fails here first.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts     (local rehearsal)
//   node main.ts                                            (grader: /output)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const entryDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(entryDir, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
const shotsDir = join(entryDir, 'screenshots');
if (existsSync(shotsDir)) cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
