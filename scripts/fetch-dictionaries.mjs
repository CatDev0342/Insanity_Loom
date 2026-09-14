// Fetches the spelling dictionaries Insanity_Loom ships with, so that a copy of the program can check spelling
// without asking anyone for anything.
//
// Chromium keeps its dictionaries in its own compiled form (.bdic) and, left alone, fetches them from Google the
// first time a language is checked. That is the one request the program would make that the author never asked for
// (60.7.5), so the ones we ship are fetched here, at build time, and packaged beside the program.
//
//   node scripts/fetch-dictionaries.mjs [where to put them]
//
// The names carry Chromium's own version for the language; they change rarely, and are listed here so that what is
// shipped is a decision rather than whatever happened to be current.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where Chromium's own dictionaries come from. */
const FROM = 'https://redirector.gvt1.com/edgedl/chrome/dict/';

/** What is shipped. English to begin with; others are the author's to ask for (Edit ▸ Preferences). */
const SHIPPED = ['en-US-10-1'];

const folder = process.argv[2] ?? 'resources/dictionaries';
await mkdir(folder, { recursive: true });

for (const name of SHIPPED) {
  const answer = await fetch(`${FROM}${name}.bdic`);
  if (!answer.ok) {
    console.error(`The ${name} dictionary could not be fetched (${String(answer.status)}).`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await answer.arrayBuffer());
  // A dictionary is a few hundred kilobytes; anything much smaller is an error page wearing its name.
  if (bytes.byteLength < 50_000) {
    console.error(`What came back for ${name} is not a dictionary (${String(bytes.byteLength)} bytes).`);
    process.exit(1);
  }
  await writeFile(join(folder, `${name}.bdic`), bytes);
  console.log(`${name}.bdic — ${(bytes.byteLength / 1024).toFixed(0)} KB`);
}
