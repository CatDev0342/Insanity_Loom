// Fetching a newer Insanity_Loom, and putting it in place.
//
// What is fetched is the program's own part — app.asar, the dictionary, the notices — which is a few megabytes
// against the whole program's hundred and fifty (scripts/gather-packages.mjs). It is checked against the length and
// the fingerprint the build published before it is allowed anywhere near the program, and it is put *beside* what is
// running, never over it: a running program holds its own files open, and a half-written one would be a program that
// will not start.
//
// Putting it in place is the hard half, and the first attempt was wrong. "At the next start, before anything is
// loaded from it" cannot work: **the program's own code lives in app.asar**, so by the time any line of this file
// runs, the very file being replaced is already open, and Windows will not let go of it. The copy failed, the update
// was thrown away, and the program carried on as it was without a word (the designer, 2026-Sep-14).
//
// So it is put in place by something that is not this program: a short helper that waits for this process to be gone,
// moves the files over, and starts the program again. Nothing else can do it, because everything else is us.

import { app } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** Where the helper writes what it did, so a failure can be explained rather than guessed at. */
export const HELPER_LOG = 'put-in-place.log';

/** What the helper is told: whose ending to wait for, what to move where, and what to start afterwards. */
export interface HelperOrders {
  readonly pid: number;
  readonly opened: string;
  readonly programFolder: string;
  readonly exe: string;
  readonly log: string;
}

/**
 * The helper.
 *
 * It waits for the program to be gone before it touches anything — a file still open is a file that cannot be
 * replaced, and that was the whole of the first attempt's failure. Then the files go over, and the program starts
 * again. Everything it does is written down as it happens: if it cannot do it, the program must be able to say so
 * afterwards rather than start up looking unchanged and saying nothing.
 *
 * It is written in **JavaScript, and run by the program's own executable** as a plain Node program
 * (`ELECTRON_RUN_AS_NODE`), rather than as a PowerShell script. A script file is the one thing a locked-down Windows
 * will refuse to run without a word — execution policy, or a signature it does not have — and refusing without a
 * word is exactly what happened (the designer, 2026-Sep-14). The executable it runs is the one already trusted
 * enough to be running, and the part being put in place holds no executable, so nothing it needs is replaced
 * underneath it.
 */
export function helperScript(orders: HelperOrders): string {
  const said = (value: string): string => JSON.stringify(value);
  return `// Put an Insanity_Loom update in place, once the program holding those files has gone.
const { cpSync, appendFileSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');

const log = ${said(orders.log)};
const say = (what) => {
  try {
    appendFileSync(log, what + '\\n', 'utf8');
  } catch {
    // A helper that cannot write its log still has an update to put in place.
  }
};
writeFileSync(log, 'Started.\\n', 'utf8');

const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

const waitFor = async (pid) => {
  const until = Date.now() + ${String(SECONDS_TO_WAIT_FOR_THE_PROGRAM)} * 1000;
  while (Date.now() < until) {
    if (gone(pid)) return true;
    await new Promise((settle) => setTimeout(settle, 200));
  }
  return false;
};

void (async () => {
  if (await waitFor(${String(orders.pid)})) say('The program has closed.');
  else say('The program did not close in time; the update is not being put in place.');
  // Even once the process is gone, Windows can hold its files for a moment longer.
  await new Promise((settle) => setTimeout(settle, ${String(SETTLING_MILLISECONDS)}));
  try {
    cpSync(${said(orders.opened)}, ${said(orders.programFolder)}, { recursive: true, force: true });
    say('Put in place.');
  } catch (cause) {
    say('The update could not be put in place: ' + (cause && cause.message ? cause.message : String(cause)));
  }
  spawn(${said(orders.exe)}, [], { detached: true, stdio: 'ignore' }).unref();
})();
`;
}

/** Waits for the helper to say it has started. */
async function waitForTheHelper(log: string): Promise<boolean> {
  for (let tried = 0; tried < TRIES_FOR_THE_HELPER_TO_START; tried++) {
    if (existsSync(log)) return true;
    await new Promise((settle) => setTimeout(settle, BETWEEN_TRIES_MS));
  }
  return existsSync(log);
}

/** How long the helper is given to say it has started: a second in all, which is a long time for starting. */
const TRIES_FOR_THE_HELPER_TO_START = 20;
const BETWEEN_TRIES_MS = 50;

/** How long the helper waits for the program to be gone, and how long it lets Windows settle afterwards. */
const SECONDS_TO_WAIT_FOR_THE_PROGRAM = 60;
const SETTLING_MILLISECONDS = 500;

/**
 * Opens the waiting update, sets the helper going, and says whether it did. The caller quits straight afterwards:
 * the helper is waiting for exactly that, and will start the program again once the files are its own.
 */
export async function handOverToTheHelper(
  here: UpdateSurroundings,
  unzip: (packagePath: string, into: string) => void,
  setGoing: (scriptPath: string) => void,
  exe: string,
): Promise<UpdateStanding> {
  const waiting = updateWaiting(here.dataFolder);
  if (waiting === undefined) return { kind: 'went wrong', why: 'There is no update waiting to be put in place.' };
  const folder = join(here.dataFolder, WAITING);
  const opened = join(folder, 'opened');
  try {
    rmSync(opened, { recursive: true, force: true });
    mkdirSync(opened, { recursive: true });
    unzip(waiting.package, opened);
    const scriptPath = join(folder, 'put-in-place.ps1');
    writeFileSync(
      scriptPath,
      helperScript({ pid: process.pid, opened, programFolder: here.programFolder, exe, log: join(folder, HELPER_LOG) }),
      'utf8',
    );
    const log = join(folder, HELPER_LOG);
    rmSync(log, { force: true });
    setGoing(scriptPath);
    // The helper says it has started before this program agrees to quit for it. Quitting for a helper that never
    // ran leaves the author with a closed program, an update that did not happen, and nothing said about either —
    // which is what happened (the designer, 2026-Sep-14).
    if (!(await waitForTheHelper(log))) {
      return { kind: 'went wrong', why: 'The part of Insanity_Loom that puts an update in place would not start. Nothing has been changed.' };
    }
    return { kind: 'waiting for a restart', version: waiting.version };
  } catch (cause) {
    rmSync(folder, { recursive: true, force: true });
    return { kind: 'went wrong', why: `The update could not be made ready: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

/**
 * How an update that was handed over went, read at the next start. An update that did not take **must be said**: the
 * first attempt failed silently, and a program that starts up looking exactly as it did is the worst possible answer
 * to "did that work?".
 */
export function howTheUpdateWent(here: UpdateSurroundings): UpdateStanding | undefined {
  const waiting = updateWaiting(here.dataFolder);
  const folder = join(here.dataFolder, WAITING);
  if (waiting === undefined) {
    // Nothing waiting, but a log left behind means a helper ran and did not get as far as leaving an update to find.
    if (!existsSync(join(folder, HELPER_LOG))) return undefined;
    const why = readFileSync(join(folder, HELPER_LOG), 'utf8').trim();
    rmSync(folder, { recursive: true, force: true });
    return why.includes('Put in place.') ? undefined : { kind: 'went wrong', why };
  }
  const took = !isNewer(waiting.version, here.version);
  const log = join(folder, HELPER_LOG);
  const why = existsSync(log) ? readFileSync(log, 'utf8').trim() : 'The helper left no word of what happened.';
  rmSync(folder, { recursive: true, force: true });
  return took
    ? { kind: 'the newest', version: here.version }
    : { kind: 'went wrong', why: `Insanity_Loom ${waiting.version} was fetched but did not go into place. ${why}` };
}

/** What was found about the last update at the start, kept until the page asks for it. */
let foundAtStart: UpdateStanding | undefined;

/** Read at the start, before there is a window to say it in. */
export function noteHowTheUpdateWent(here: UpdateSurroundings): void {
  foundAtStart = howTheUpdateWent(here);
}

/** Said once, to the page, and then forgotten: it is news, not a standing state. */
export function takeHowTheUpdateWent(): UpdateStanding | undefined {
  const found = foundAtStart;
  foundAtStart = undefined;
  return found;
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

/**
 * Sets the helper going, detached and outliving this program — which is the point of it. It is run by the program's
 * own executable as a plain Node program, so nothing stands between it and running: no shell, no script host, no
 * execution policy, no signature.
 */
export function setTheHelperGoing(scriptPath: string): void {
  const helper = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  helper.unref();
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

