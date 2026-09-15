// Takes away whatever the newest release still carries that this build did not publish.
//
// A release asset outlives the build that made it: publishing replaces what it publishes and leaves everything else
// exactly where it was. So the release went on offering five AppImages named for builds long gone, and a package of
// the program's own part that no build makes any more — which anything fetching from the release would keep taking,
// however often it was deleted at the other end (2026-Sep-15).
//
//   node scripts/tidy-the-release.mjs <owner/repository>
//
// It needs GH_TOKEN, which the workflow has. Nothing is taken away anywhere else: a release is the one place a
// build's own output is published, and this only ever removes from it.

const REPOSITORY = process.argv[2];
const RELEASE = 'newest';

/** What a green build publishes, and therefore all that the release should hold. */
const PUBLISHED = new Set(['Insanity_Loom-Windows.zip', 'Insanity_Loom-Linux.AppImage', 'newest.json']);

const token = process.env['GH_TOKEN'];
if (REPOSITORY === undefined || token === undefined || token === '') {
  console.error('Usage: node scripts/tidy-the-release.mjs <owner/repository>, with GH_TOKEN set.');
  process.exit(1);
}

const github = async (path, options = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, ...options.headers },
  });

const release = await github(`/repos/${REPOSITORY}/releases/tags/${RELEASE}`);
if (!release.ok) {
  // No release yet is not a failure: there is nothing to tidy.
  console.log(`No "${RELEASE}" release to tidy (${String(release.status)}).`);
  process.exit(0);
}
const said = await release.json();

let takenAway = 0;
for (const asset of said.assets ?? []) {
  if (PUBLISHED.has(asset.name)) continue;
  const gone = await github(`/repos/${REPOSITORY}/releases/assets/${String(asset.id)}`, { method: 'DELETE' });
  if (!gone.ok) {
    console.error(`"${asset.name}" could not be taken away (${String(gone.status)}).`);
    process.exit(1);
  }
  console.log(`Took away "${asset.name}", which no build publishes any more.`);
  takenAway += 1;
}
console.log(takenAway === 0 ? 'The release carries only what this build published.' : `Took away ${String(takenAway)} asset(s).`);
