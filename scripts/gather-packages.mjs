// Gathers what a build publishes: the whole program, and the part of it that actually changed.
//
// Nearly all of a copy of Insanity_Loom is Electron — the executable, Chromium's libraries, its locales and data.
// That changes when Electron does, which is seldom. What changes every time is ours: the program's own code in
// app.asar, the dictionary shipped with it, and the notices. Measured on 2026-Sep-14: 3.7 MB of a 159 MB download.
//
// So two packages are published. **The whole program**, for a first copy or when Electron itself has moved on; and
// **the program's own part**, which a running copy can fetch and put in place by itself (src/main/updates.ts).
//
//   node scripts/gather-packages.mjs <the unpacked build> <where the packages go> <version> <electron version>

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [unpacked, into, version, electron] = process.argv.slice(2);
if (unpacked === undefined || into === undefined || version === undefined || electron === undefined) {
  console.error('node scripts/gather-packages.mjs <unpacked build> <where> <version> <electron version>');
  process.exit(1);
}

/** What belongs to the program itself rather than to Electron. Everything else is the runtime beneath it. */
export const OURS = ['resources/app.asar', 'resources/dictionaries', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt'];

async function sha256(path) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    createReadStream(path).on('data', (piece) => hash.update(piece)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

await mkdir(into, { recursive: true });

// What the running program reads to decide whether it can update itself, and what it should fetch.
const packages = {};
for (const [name, file] of Object.entries(JSON.parse(await readFile(join(into, 'packages.json'), 'utf8').catch(() => '{}')))) {
  packages[name] = file;
}
for (const name of ['Insanity_Loom-Windows.zip', 'Insanity_Loom-Windows-app.zip', 'Insanity_Loom-Linux.AppImage', 'Insanity_Loom-Linux-app.zip']) {
  const path = join(into, name);
  const there = await stat(path).catch(() => undefined);
  if (there === undefined) continue;
  packages[name] = { size: there.size, sha256: await sha256(path) };
}

await writeFile(
  join(into, 'newest.json'),
  `${JSON.stringify({ version, electron, packages }, null, 2)}\n`,
);
console.log(`newest.json — version ${version}, Electron ${electron}, ${Object.keys(packages).length} package(s)`);
