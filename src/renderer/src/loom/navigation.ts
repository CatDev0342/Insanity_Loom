// The panel on the left: where the author is in the whisper, and where they can go from it.
//
// Three lists, in the order a reader wants them: the whisper's own shape (its headings and its turns), the whispers
// this one points at, and the whispers that point here. Everything in them is a place to go — choosing one takes the
// author there, in this whisper or another.
//
// It is drawn from the whisper itself each time it changes, so it can never disagree with what is on the page.

import { readWhisperLink, type WhisperPointingHere } from '../../../shared/whispers';
import type { WhisperEditor } from '../document/whisper-editor';

export interface NavigationElements {
  readonly navigationInside: HTMLElement;
}

/** How long after the last change the panel is drawn again, in milliseconds; writing must not be held up for it. */
const DRAWN_AFTER_MS = 400;

/** What the panel holds, worked out from the whisper. */
export interface Whereabouts {
  readonly headings: readonly { readonly identity: string; readonly text: string; readonly level: number }[];
  readonly turns: readonly { readonly sectionId: string; readonly turn: string; readonly shown: string }[];
  readonly pointsAt: readonly { readonly address: string; readonly name: string; readonly text: string }[];
}

/** Reads the whisper for everything the panel shows. A pure look at the document, so it can be tested without a page. */
export function whereabouts(editor: WhisperEditor): Whereabouts {
  const headings: { identity: string; text: string; level: number }[] = [];
  const turns: { sectionId: string; turn: string; shown: string }[] = [];
  const pointsAt = new Map<string, { address: string; name: string; text: string }>();
  const doc = editor.editor.state.doc;
  doc.descendants((node) => {
    if (node.type.name === 'heading') {
      const identity = node.attrs['id'];
      if (typeof identity === 'string' && identity !== '') {
        headings.push({ identity, text: node.textContent, level: Number(node.attrs['level'] ?? 1) });
      }
      return false;
    }
    if (node.type.name === 'horizontalRule') {
      const sectionId = node.attrs['sectionId'];
      if (typeof sectionId === 'string') {
        turns.push({
          sectionId,
          turn: typeof node.attrs['turn'] === 'string' ? node.attrs['turn'] : String(turns.length + 1),
          shown: typeof node.attrs['shown'] === 'string' ? node.attrs['shown'] : '',
        });
      }
      return false;
    }
    if (node.isText) {
      const link = node.marks.find((mark) => mark.type.name === 'link');
      const address = link?.attrs['href'];
      if (typeof address === 'string' && address !== '' && !pointsAt.has(address)) {
        const whisper = readWhisperLink(address);
        pointsAt.set(address, {
          address,
          name: whisper === undefined ? address : whisper.name.replace(/\.xhtml$/i, '') || 'this whisper',
          text: node.text ?? address,
        });
      }
      return false;
    }
    return true;
  });
  return { headings, turns, pointsAt: [...pointsAt.values()] };
}

export interface NavigationActions {
  /** Take the author to a heading in the whisper they are in. */
  readonly goToHeading: (identity: string) => void;
  /** Take the author to a turn of the conversation. */
  readonly goToTurn: (sectionId: string) => void;
  /** Follow a link, wherever it goes. */
  readonly follow: (address: string) => void;
  /** Open another whisper by its file name. */
  readonly open: (name: string) => void;
}

export class Navigation {
  private drawingSoon = 0;
  private pointingHere: readonly WhisperPointingHere[] = [];

  constructor(
    private readonly elements: NavigationElements,
    private readonly editor: () => WhisperEditor | undefined,
    private readonly actions: NavigationActions,
  ) {}

  /** The whispers that point at the one open; the panel shows them until another whisper is opened. */
  showPointingHere(pointing: readonly WhisperPointingHere[]): void {
    this.pointingHere = pointing;
    this.draw();
  }

  /** The whisper changed. The panel follows, a moment later, so that writing is never held up for it. */
  changed(): void {
    if (this.drawingSoon !== 0) return;
    this.drawingSoon = window.setTimeout(() => {
      this.drawingSoon = 0;
      this.draw();
    }, DRAWN_AFTER_MS);
  }

  draw(): void {
    const editor = this.editor();
    if (editor === undefined) return;
    const here = whereabouts(editor);
    this.elements.navigationInside.replaceChildren(
      this.list(
        'This whisper',
        here.headings.map((heading) => ({
          label: heading.text === '' ? '(untitled section)' : heading.text,
          depth: heading.level,
          go: () => this.actions.goToHeading(heading.identity),
        })),
        'No headings yet.',
      ),
      this.list(
        'Turns',
        here.turns.map((turn) => ({
          label: `Turn ${turn.turn}${turn.shown === '' ? '' : ` · ${turn.shown}`}`,
          depth: 1,
          go: () => this.actions.goToTurn(turn.sectionId),
        })),
        'No turns taken yet.',
      ),
      this.list(
        'Points at',
        here.pointsAt.map((link) => ({
          label: link.name,
          depth: 1,
          go: () => this.actions.follow(link.address),
        })),
        'This whisper points at nothing yet.',
      ),
      this.list(
        'Points here',
        this.pointingHere.map((whisper) => ({
          label: whisper.title,
          depth: 1,
          go: () => this.actions.open(whisper.name),
        })),
        'Nothing points here yet.',
      ),
    );
  }

  private list(
    title: string,
    entries: readonly { readonly label: string; readonly depth: number; readonly go: () => void }[],
    whenEmpty: string,
  ): HTMLElement {
    const holder = document.createElement('section');
    holder.className = 'navigation-part';
    const heading = document.createElement('h2');
    heading.className = 'side-panel-title';
    heading.textContent = title;
    holder.append(heading);
    if (entries.length === 0) {
      const nothing = document.createElement('p');
      nothing.className = 'side-panel-note';
      nothing.textContent = whenEmpty;
      holder.append(nothing);
      return holder;
    }
    const list = document.createElement('ul');
    list.className = 'navigation-list';
    for (const entry of entries) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'navigation-go';
      button.textContent = entry.label;
      button.title = entry.label;
      button.dataset['depth'] = String(Math.min(entry.depth, 3));
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => entry.go());
      item.append(button);
      list.append(item);
    }
    holder.append(list);
    return holder;
  }
}
