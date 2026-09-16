// What a command the assistant ran is called, in the Commands tab.
//
// The assistant reports a command by its whole text, which for a shell command is most of a line of setup before
// anything worth reading: `export PATH="$HOME/work/tools/node/bin:$PATH"; cd ~/work/Insanity_Loom && npx eslint .`.
// A panel of those is a wall of `export PATH` with the work hidden at the ends of the lines (the designer's
// screenshot, 2026-Sep-14). So the setup is put aside and the work is shown.
//
// Nothing is cut short (the designer, 2026-Sep-16). A command cut to fit the panel loses the very part that says
// which command it was — two reads of two different files both read "Read File" — and the panel then looks like the
// same line repeated. The line is shown whole and the panel scrolls sideways.

/**
 * A leading step that only gets ready to do the work: setting a variable, or going to a folder. Each is taken off
 * the front in turn, with the `;` or `&&` that follows it.
 */
const GETTING_READY = /^\s*(?:export\s+[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)|cd\s+(?:"[^"]*"|'[^']*'|\S+))\s*(?:;|&&)\s*/;

/** The work a command does, with the getting-ready put aside and the whole thing on one line. */
export function workOfACommand(title: string): string {
  let rest = title.replace(/\s+/g, ' ').trim();
  // Each step taken off in turn: a command may set a variable and then change folder and then do the work.
  for (let taken = GETTING_READY.exec(rest); taken !== null; taken = GETTING_READY.exec(rest)) {
    const without = rest.slice(taken[0].length).trim();
    // A command that is *only* getting ready is worth saying as itself; there is nothing else in it to say.
    if (without === '') break;
    rest = without;
  }
  return rest;
}
