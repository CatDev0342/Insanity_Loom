// Puts the newest green build in the shared folder, so the author never has to fetch it from a web page.
//
// The build is published as a release by the workflow (.github/workflows/ci.yml) when every check passes on both
// systems, which is what makes it fetchable without signing in. This takes it from there and drops it beside the
// author's own things.
//
// **Both packages are put there, always.** The whole program is for a first copy or a new runtime; the program's own
// part is a handful of files, and replacing a handful by hand beats replacing seventy-six of them (the designer,
// 2026-Sep-14). Whichever way the author updates — the updater, or their own two hands — the small one is the one
// they want, and it is no use to them sitting on a web page.
//
//   node scripts/fetch-newest-build.mjs [where to put it]

import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const REPOSITORY = 'CatDev0342/Insanity_Loom';
const RELEASE = 'newest';
/** The whole program, and the program's own part. Both are fetched; the part is the one to reach for. */
const WANTED = ['Insanity_Loom-Windows.zip', 'Insanity_Loom-Windows-app.zip'];
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
  if (asset === undefined) {
    console.error(`The newest build holds no ${wanted}.`);
    process.exit(1);
  }
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
