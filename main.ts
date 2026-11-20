// Neon Vice — entry point for the make.fun gta6-cover-art-01 bounty.
// Node 22, standard library only.
//
// The product is the static web app under app/ (plain files, no build
// step, nothing fetched from a network). This program packages the app
// the way the grader expects: app/ and screenshots/ are copied into the
// output directory and dossier.json is written there by the vendored
// library in vendor/makefun-app.ts, kept byte-identical to the kit copy.
// The caps below mirror the gate's own limits, so an entry the scorer
// would refuse fails loudly here instead of silently at grading time.
//
//   mkdir -p out
//   MAKEFUN_OUTPUT_DIR=out node main.ts
//
// To use the app directly, open app/index.html in a browser, or run
// `node serve.ts` and visit the local address it prints.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const entryRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const GATE_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

mkdirSync(outputDir, { recursive: true });
cpSync(join(entryRoot, 'app'), join(outputDir, 'app'), { recursive: true });
const shotsDir = join(entryRoot, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });
}
writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, GATE_LIMITS));
