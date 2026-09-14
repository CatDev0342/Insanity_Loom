// Every command the page may ask the layer underneath to carry out, by name. The layer underneath refuses any name
// not on this list, so the page can never ask for more than was planned.

export const COMMANDS = [
  'app.quit',
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.pasteAsText',
  'edit.selectAll',
  'view.zoomIn',
  'view.zoomOut',
  'view.zoomReset',
  'view.toggleFullScreen',
  'help.about',
] as const;

export type CommandId = (typeof COMMANDS)[number];

export function isCommandId(value: unknown): value is CommandId {
  return typeof value === 'string' && (COMMANDS as readonly string[]).includes(value);
}

/** The channel commands travel on, from the bridge to the layer underneath. */
export const RUN_COMMAND_CHANNEL = 'insanity-loom:run-command';
