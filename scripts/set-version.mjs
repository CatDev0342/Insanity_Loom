// Gives a build its number, so a copy of Insanity_Loom can say exactly which one it is.
//
// The number is 0.0.<the build's own number>, which the build machine hands us; Help ▸ About shows it. A build made
// by hand keeps whatever is in package.json, because it is not one of the numbered ones.
//
//   node scripts/set-version.mjs <number>

import { readFileSync, writeFileSync } from 'node:fs';

const number = process.argv[2];
if (number === undefined || !/^\d+$/.test(number)) {
  console.error('Which build is this? Give its number: node scripts/set-version.mjs 42');
  process.exit(1);
}

const file = 'package.json';
const said = JSON.parse(readFileSync(file, 'utf8'));
said.version = `0.0.${number}`;
writeFileSync(file, `${JSON.stringify(said, null, 2)}\n`);
console.log(`This build is ${said.version}.`);
