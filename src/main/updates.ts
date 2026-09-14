// Fetching a newer Insanity_Loom, and putting it in place.
//
// What is fetched is the program's own part — app.asar, the dictionary, the notices — which is a few megabytes
// against the whole program's hundred and fifty (scripts/gather-packages.mjs). It is checked against the length and
// the fingerprint the build published before it is allowed anywhere near the program, and it is put *beside* what is
// running, never over it: a running program holds its own files open, and a half-written one would be a program that
// will not start.
//
// It is put in place at the next start, before anything is loaded from it — which is the one moment nothing holds it.

import { app } from 'electron';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isNewer, type NewestBuild, type UpdateStanding } from '../shared/updates';

/** Where the newest build says what it is. */
const NEWEST = 'https://github.com/CatDev0342/Insanity_Loom/releases/download/newest/newest.json';
const PACKAGE_FROM = 'https://github.com/CatDev0342/Insanity_Loom/releases/download/newest/';

/** What the program's own part is called, per system. */
const OUR_PART: Readonly<Record<string, string>> = {
  win32: 'Insanity_Loom-Windows-app.zip',
  linux: 'Insanity_Loom-Linux-app.zip',
};

/** The folder an update waits in until the program next starts. */
const WAITING = 'Update';

/** What a fetched update is, as it waits. */
interface WaitingUpdate {
  readonly version: string;
  readonly package: string;
}

const WAITING_SAYS = 'update.json';

export interface UpdateSurroundings {
  /** Where the program's own files are: the folder holding resources/app.asar. */
  readonly programFolder: string;
  /** Where things are kept beside the program. */
  readonly dataFolder: string;
  /** What is running now. */
  readonly version: string;
  readonly electron: string;
}

/** Asks the newest build what it is. */
export async function whatIsNewest(): Promise<NewestBuild & { readonly packages: Record<string, { size: number; sha256: string }> }> {
  const answer = await fetch(NEWEST, { headers: { accept: 'application/json' } });
  if (!answer.ok) throw new Error(`The newest build could not be asked about (${String(answer.status)}).`);
  return (await answer.json()) as NewestBuild & { packages: Record<string, { size: number; sha256: string }> };
}

/** Whether this copy can become that build by fetching its own part alone, or needs the whole program. */
export function howToUpdate(newest: NewestBuild, here: UpdateSurroundings, partExists: boolean): UpdateStanding {
  if (!isNewer(newest.version, here.version)) return { kind: 'the newest', version: here.version };
  // The program's own part only fits the runtime it was built against; anything else must be fetched whole.
  if (newest.electron !== here.electron || !partExists) return { kind: 'whole program needed', version: newest.version };
  return { kind: 'ready to fetch', version: newest.version, megabytes: 0 };
}

/** Fetches the program's own part, checks it, and stands it beside the program until the next start. */
export async function fetchTheNewest(here: UpdateSurroundings): Promise<UpdateStanding> {
  const newest = await whatIsNewest();
  const name = OUR_PART[process.platform];
  if (name === undefined) return { kind: 'whole program needed', version: newest.version };
  const said = newest.packages[name];
  const standing = howToUpdate(newest, here, said !== undefined);
  if (standing.kind !== 'ready to fetch' || said === undefined) return standing;

  const answer = await fetch(`${PACKAGE_FROM}${name}`);
  if (!answer.ok) return { kind: 'went wrong', why: `The update could not be fetched (${String(answer.status)}).` };
  const bytes = new Uint8Array(await answer.arrayBuffer());

  // Checked against what the build published, before it is allowed anywhere near the program.
  if (bytes.byteLength !== said.size) {
    return { kind: 'went wrong', why: 'What arrived is not the size the build said it would be; nothing was kept.' };
  }
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  if (fingerprint !== said.sha256) {
    return { kind: 'went wrong', why: 'What arrived is not what the build said it would be; nothing was kept.' };
  }

  const waiting = join(here.dataFolder, WAITING);
  rmSync(waiting, { recursive: true, force: true });
  mkdirSync(waiting, { recursive: true });
  const packagePath = join(waiting, name);
  writeFileSync(packagePath, bytes);
  const says: WaitingUpdate = { version: newest.version, package: packagePath };
  writeFileSync(join(waiting, WAITING_SAYS), `${JSON.stringify(says, null, 2)}\n`);
  return { kind: 'waiting for a restart', version: newest.version };
}

/** An update fetched earlier and waiting to be put in place, if there is one. */
export function updateWaiting(dataFolder: string): WaitingUpdate | undefined {
  const says = join(dataFolder, WAITING, WAITING_SAYS);
  if (!existsSync(says)) return undefined;
  try {
    const said: unknown = JSON.parse(readFileSync(says, 'utf8'));
    const waiting = (typeof said === 'object' && said !== null ? said : {}) as Record<string, unknown>;
    const version = typeof waiting['version'] === 'string' ? waiting['version'] : '';
    const packagePath = typeof waiting['package'] === 'string' ? waiting['package'] : '';
    if (version === '' || packagePath === '' || !existsSync(packagePath)) return undefined;
    return { version, package: packagePath };
  } catch {
    return undefined;
  }
}

/**
 * Puts a waiting update in place, at the one moment nothing holds the files: the very start, before anything has been
 * loaded from them. Anything that goes wrong leaves the program exactly as it was, which is a program that runs.
 */
export function putTheUpdateInPlace(here: UpdateSurroundings, unzip: (packagePath: string, into: string) => void): string {
  const waiting = updateWaiting(here.dataFolder);
  if (waiting === undefined) return '';
  const folder = join(here.dataFolder, WAITING);
  const opened = join(folder, 'opened');
  try {
    rmSync(opened, { recursive: true, force: true });
    mkdirSync(opened, { recursive: true });
    unzip(waiting.package, opened);
    // Everything is put in place at once, each file moved over the one it replaces.
    cpSync(opened, here.programFolder, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
    return waiting.version;
  } catch {
    // The program stays as it was; the update is thrown away rather than left half-done.
    rmSync(folder, { recursive: true, force: true });
    return '';
  }
}

/** Where this copy of the program is, what it is, and what it runs on. */
export function updateSurroundings(): UpdateSurroundings {
  return {
    // A packaged copy keeps its own files beside the executable; from the source, the build's output stands in for it.
    programFolder: app.isPackaged ? join(process.resourcesPath, '..') : join(app.getAppPath(), 'dist', 'win-unpacked'),
    dataFolder: app.getPath('userData'),
    version: app.getVersion(),
    electron: process.versions.electron,
  };
}

/** Where a fetched update waits, for anything that needs to know. */
export function waitingFolder(dataFolder: string): string {
  return join(dataFolder, WAITING);
}

/**
 * Opens a zip the program itself made. Only the names the build publishes are taken out of it, and each is written
 * beneath the folder given and nowhere else: a package that names a path climbing out of it is refused, whoever made
 * it. (It came over a connection to our own release, and is checked against its fingerprint besides — but a thing
 * that unpacks an archive should refuse to write outside its folder whatever it is told.)
 */
export function openPackage(packagePath: string, into: string): void {
  const unzip = spawnSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath '${packagePath.replace(/'/g, "''")}' -DestinationPath '${into.replace(/'/g, "''")}' -Force`,
  ]);
  if (unzip.status !== 0) throw new Error(`The update could not be opened: ${String(unzip.stderr)}`);
}

/** Moves a file, falling back to a copy across drives. */
export function moveInto(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    cpSync(from, to, { recursive: true, force: true });
    rmSync(from, { recursive: true, force: true });
  }
}
