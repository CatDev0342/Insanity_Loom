// What a command the assistant ran is called, in the Commands tab.
//
// The assistant reports a command by its whole text, which for a shell command is most of a line of setup before
// anything worth reading: `export PATH="$HOME/work/tools/node/bin:$PATH"; cd ~/work/Insanity_Loom && npx eslint .`.
// A panel of those is a wall of `export PATH` with the work hidden at the ends of the lines (the designer's
// screenshot, 2026-Sep-14). So the setup is put aside and the work is shown, with the whole text kept on hover.
//
// This rhymes with how VS Code's Problems and Output panels name things — a short label to read down, the full text
// a hover away — without borrowing anything of theirs (20.12).

/** How long a shown command may be before it is cut short. Long enough for a real command, short enough to scan. */
const LONGEST_SHOWN = 72;

/** The mark that says a command was cut short, at the end of what is shown. */
const CUT_SHORT = '…';

/**
 * A leading step that only gets ready to do the work: setting a variable, or going to a folder. Each is taken off
 * the front in turn, with the `;` or `&&` that follows it.
 */
const GETTING_READY = /^\s*(?:export\s+[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)|cd\s+(?:"[^"]*"|'[^']*'|\S+))\s*(?:;|&&)\s*/;

/** Whether two commands are the same piece of work, so that a run of them can be said once. */
export function sameCommand(one: string, another: string): boolean {
  return shortCommand(one) === shortCommand(another);
}

/** The work a command does, with the getting-ready put aside and the whole thing on one line. */
export function shortCommand(title: string): string {
  let rest = title.replace(/\s+/g, ' ').trim();
  // Each step taken off in turn: a command may set a variable and then change folder and then do the work.
  for (let taken = GETTING_READY.exec(rest); taken !== null; taken = GETTING_READY.exec(rest)) {
    const without = rest.slice(taken[0].length).trim();
    // A command that is *only* getting ready is worth saying as itself; there is nothing else in it to say.
    if (without === '') break;
    rest = without;
  }
  return rest.length <= LONGEST_SHOWN ? rest : `${rest.slice(0, LONGEST_SHOWN - CUT_SHORT.length).trimEnd()}${CUT_SHORT}`;
}

/** How a run of the same command is counted beside it: "× 3", or '' for the first of them. */
export function timesOver(times: number): string {
  return times > 1 ? `× ${times}` : '';
}
