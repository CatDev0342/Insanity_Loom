// The Find in Files window: the advanced find window, standing in a window of its own beside the program.
//
// It is the same panel the program can show in a dialog (panels/hall-panel.ts); here it simply stands, so the author
// may leave it open, put it on another screen, and come back to its results as often as they like. Choosing a result
// asks the program's own window to go there, rather than closing anything.

import { HallPanel } from './panels/hall-panel';

const bridge = window.insanityLoom;

const inside = document.querySelector<HTMLElement>('#find-in-files');
if (inside === null) throw new Error('The Find in Files window is missing #find-in-files (src/renderer/find.html).');

// The panel is built around a dialog element; in a window of its own the dialog is simply the page's own box, never
// opened or closed as a dialog.
const box = document.createElement('dialog');
box.open = true;
box.className = 'find-window-panel';
inside.append(box);

const panel = new HallPanel(box, 'in its own window', () => void bridge.findWindow.close());
panel.takeResultsTo((chosen) => void bridge.findWindow.goTo(chosen));
panel.standIn((asked) => bridge.hall.search(asked));
