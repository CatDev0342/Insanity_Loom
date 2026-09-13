// Checks the license of every package Insanity_Loom ships, and writes THIRD_PARTY_NOTICES.txt from them.
//
// WHY. Insanity_Loom is Apache-2.0 so that anyone may do anything with it, closed-source products included. A single
// shipped package under the GPL or AGPL would take that away, and shipping anyone's code without their copyright
// notice breaks the license it came under. So the build refuses any package whose license is not on the list below,
// and every notice is collected automatically — nothing depends on remembering.
//
// Only packages that ship are checked: production dependencies. Build tools (devDependencies) never leave this
// machine. Electron and Chromium, which do ship, carry their own notices; electron-builder places them beside the
// executable (LICENSE.electron.txt, LICENSES.chromium.html).

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Licenses that let anyone use, change and sell the code, closed-source included, asking only for its notice.
const PERMITTED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
]);

const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

// A package's license text is the first file in its folder whose name starts with one of these.
const LICENSE_FILE_PREFIXES = ['license', 'licence', 'copying', 'notice'];

// Exit code for a failed check: anything but 0 stops the build.
const EXIT_CODE_REFUSED = 1;

/** The license a package declares, as an SPDX expression, or undefined when it declares none. */
function declaredLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type ?? entry).join(' OR ');
  return undefined;
}

/**
 * Whether an SPDX expression permits use: "A OR B" needs one permitted choice; "A AND B" needs every part permitted.
 * Anything not understood is refused rather than guessed at.
 */
function isPermitted(expression) {
  const choices = expression.replace(/[()]/g, ' ').split(/\s+OR\s+/i);
  return choices.some((choice) =>
    choice
      .split(/\s+AND\s+/i)
      .map((part) => part.trim())
      .every((part) => PERMITTED_LICENSES.has(part)),
  );
}

function licenseText(packageFolder) {
  const file = readdirSync(packageFolder).find((name) =>
    LICENSE_FILE_PREFIXES.some((prefix) => name.toLowerCase().startsWith(prefix)),
  );
  return file === undefined ? undefined : readFileSync(join(packageFolder, file), 'utf8').trim();
}

// npm lists every production dependency, however deeply nested, with its own package.json contents and folder. The
// list includes Insanity_Loom itself (the package at the root, whose location is empty), which is not third-party.
const ROOT_LOCATION = '';
const shipped = JSON.parse(
  execFileSync('npm', ['query', '.prod'], { encoding: 'utf8', shell: process.platform === 'win32' }),
).filter((item) => item.location !== ROOT_LOCATION);

const refused = [];
const notices = [];
for (const item of shipped.sort((a, b) => a.name.localeCompare(b.name))) {
  const license = declaredLicense(item);
  if (license === undefined || !isPermitted(license)) {
    refused.push(`${item.name}@${item.version} — ${license ?? 'no license declared'}`);
    continue;
  }
  const text = licenseText(item.path);
  if (text === undefined) {
    refused.push(`${item.name}@${item.version} — ${license}, but no license file to reproduce its notice from`);
    continue;
  }
  notices.push(`${item.name} ${item.version} — ${license}\n\n${text}`);
}

if (refused.length > 0) {
  console.error('These packages cannot ship with Insanity_Loom:\n');
  for (const line of refused) console.error(`  ${line}`);
  console.error(`\nPermitted licenses: ${[...PERMITTED_LICENSES].join(', ')}.`);
  process.exit(EXIT_CODE_REFUSED);
}

const header =
  'Insanity_Loom includes the following third-party software, each under its own license.\n' +
  'Electron and Chromium are listed separately, in LICENSE.electron.txt and LICENSES.chromium.html beside this file.\n';
// Notices are separated by a rule as wide as a classic 80-column text file, so it reads cleanly in any viewer.
const DIVIDER_WIDTH = 80;
const divider = `\n\n${'='.repeat(DIVIDER_WIDTH)}\n\n`;
writeFileSync(NOTICES_FILE, [header, ...notices].join(divider) + '\n');
console.log(`Licenses permitted: ${shipped.length} shipped package(s). Notices written to ${NOTICES_FILE}.`);
