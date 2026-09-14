// Puts the newest green build in the shared folder, so the author never has to fetch it from a web page.
//
// The build is published as a release by the workflow (.github/workflows/ci.yml) when every check passes on both
// systems, which is what makes it fetchable without signing in. This takes it from there and drops it beside the
// author's own things.
//
//   node scripts/fetch-newest-build.mjs [where to put it]

import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const REPOSITORY = 'CatDev0342/Insanity_Loom';
const RELEASE = 'newest';
const WANTED = 'Insanity_Loom-Windows.zip';
const SHARED_FOLDER = process.argv[2] ?? '/staging';

const release = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${RELEASE}`, {
  headers: { accept: 'application/vnd.github+json' },
});
if (!release.ok) {
  console.error(`No newest build to fetch yet (the release says ${String(release.status)}).`);
  process.exit(1);
}
const said = await release.json();
const asset = (said.assets ?? []).find((one) => one.name === WANTED);
if (asset === undefined) {
  console.error(`The newest build holds no ${WANTED}.`);
  process.exit(1);
}

await mkdir(SHARED_FOLDER, { recursive: true });
// Written beside its destination and moved into place, so a half-fetched build is never there to be opened.
const landing = join(SHARED_FOLDER, `${WANTED}.fetching`);
const destination = join(SHARED_FOLDER, WANTED);
const download = await fetch(asset.browser_download_url);
if (!download.ok || download.body === null) {
  console.error(`The newest build could not be fetched (${String(download.status)}).`);
  process.exit(1);
}
await pipeline(Readable.fromWeb(download.body), createWriteStream(landing));
await rename(landing, destination);

const { size } = await stat(destination);
const megabytes = (size / (1024 * 1024)).toFixed(1);
console.log(`${destination} — ${megabytes} MB, built from ${String(said.target_commitish ?? '').slice(0, 7)}, published ${String(said.published_at ?? '')}`);
