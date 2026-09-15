// Puts the newest green build in the shared folder, so the author never has to fetch it from a web page.
//
// The build is published as a release by the workflow (.github/workflows/ci.yml) when every check passes on both
// systems, which is what makes it fetchable without signing in. This takes it from there and drops it beside the
// author's own things.
//
// Whatever the build published is put there. For now that is the whole program and nothing else: a package of the
// program's own part cannot work while app.asar is sealed to the executable, and the author has kept that seal on.
//
//   node scripts/fetch-newest-build.mjs [where to put it]

import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const REPOSITORY = 'CatDev0342/Insanity_Loom';
const RELEASE = 'newest';
/**
 * What is fetched. Only the whole program: there is no package of the program's own part, and there must not be
 * (electron-builder.yml). This list once held one, and because a release keeps an asset until something replaces it,
 * every fetch put a stale and unusable package back in the shared folder after the author had deleted it — twice
 * (2026-Sep-15). What is asked for here is what lands there, so it asks for nothing it does not want.
 */
const WANTED = ['Insanity_Loom-Windows.zip'];
const SHARED_FOLDER = process.argv[2] ?? '/staging';

const release = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${RELEASE}`, {
  headers: { accept: 'application/vnd.github+json' },
});
if (!release.ok) {
  console.error(`No newest build to fetch yet (the release says ${String(release.status)}).`);
  process.exit(1);
}
const said = await release.json();
await mkdir(SHARED_FOLDER, { recursive: true });

for (const wanted of WANTED) {
  const asset = (said.assets ?? []).find((one) => one.name === wanted);
  // A package the build did not publish is not an error: what is published is what there is.
  if (asset === undefined) continue;
  // Written beside its destination and moved into place, so a half-fetched build is never there to be opened.
  const landing = join(SHARED_FOLDER, `${wanted}.fetching`);
  const destination = join(SHARED_FOLDER, wanted);
  const download = await fetch(asset.browser_download_url);
  if (!download.ok || download.body === null) {
    console.error(`${wanted} could not be fetched (${String(download.status)}).`);
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(download.body), createWriteStream(landing));
  await rename(landing, destination);

  const { size } = await stat(destination);
  const megabytes = (size / (1024 * 1024)).toFixed(1);
  // What the release is called says which build it is; when the file itself was last written says how fresh it is.
  console.log(`${destination} — ${megabytes} MB — ${String(said.name ?? '')}, packaged ${String(asset.updated_at ?? '')}`);
}
