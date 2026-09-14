// The Library tab: what the assistant has cited, and the library itself when the author wants to look.
//
// It shows a list, not a document: every place in the library the assistant referred to in its replies, newest last,
// each as its address and what stands there. The library is loaded behind the list, so choosing an entry opens that
// document at that place at once — as a live document the author may edit, with everything around it in view.
//
// The entry chosen stays pinned above the document, as a development tool pins the thing you opened. Choosing it
// again puts the document away and the list comes back, exactly where it was: the list keeps its history, so the
// author can scroll back through everything referred to over the whole conversation.

import { documentOf, type GreatHall, type GreatHallBridge, type HallSection } from '../../../shared/greathall';

export interface LibraryElements {
  readonly libraryInside: HTMLElement;
  readonly librarySaid: HTMLElement;
  /** What scrolls when the library is longer than the panel. */
  readonly libraryPane: HTMLElement;
  /** Brings the Library tab to the front, for when something takes the author there. */
  readonly showLibraryTab: () => void;
}

/** How long after the last change a document edited in the panel is written back, in milliseconds. */
const WRITTEN_AFTER_MS = 800;

export class Library {
  private hall: GreatHall | undefined;
  /** Everything cited, in the order it was cited, with nothing repeated; each remembers the turn that cited it. */
  private readonly cited: (HallSection & { readonly turn: number })[] = [];
  /** Where each cited entry is drawn, so the bar between the panels can point at it. */
  private readonly drawn = new Map<string, HTMLElement>();
  private readonly list = document.createElement('div');
  /** The entry opened, if any, what is drawn for it, and the state its file was in when it was read. */
  private open: { readonly section: HallSection; readonly holder: HTMLElement; stamp: string } | undefined;
  private writingSoon = 0;

  constructor(
    private readonly elements: LibraryElements,
    private readonly greatHall: GreatHallBridge,
    private readonly onProblem: (message: string) => void,
  ) {
    this.list.className = 'library-list';
    elements.libraryInside.append(this.list);
  }

  /** The GreatHall in use; the tab says so, and what it can do depends on it. */
  useHall(hall: GreatHall | undefined): void {
    this.hall = hall;
    this.say();
  }

  get addresses(): readonly string[] {
    return this.hall?.documents.map((document) => document.address) ?? [];
  }

  /** Forgets what was cited: another whisper is another conversation, and its own citations are read from it. */
  forget(): void {
    this.cited.length = 0;
    this.drawn.clear();
    this.list.replaceChildren();
    this.say();
  }

  /** What the assistant cited in a reply to one turn: added to the list, in the order written, nothing twice. */
  async cite(turn: number, addresses: readonly string[]): Promise<void> {
    if (this.hall === undefined || addresses.length === 0) return;
    const fresh = addresses.filter((address) => !this.cited.some((already) => already.address === address));
    if (fresh.length === 0) return;
    try {
      const sections = await this.greatHall.sections(fresh);
      for (const section of sections) this.cited.push({ ...section, turn });
      this.drawList();
    } catch (problem) {
      this.onProblem(`The library could not be read: ${problem instanceof Error ? problem.message : String(problem)}`);
    }
  }

  private say(): void {
    if (this.hall === undefined) {
      this.elements.librarySaid.textContent = 'No GreatHall is open. File ▸ Open GreatHall… opens one.';
      return;
    }
    this.elements.librarySaid.textContent =
      this.cited.length === 0
        ? `${this.hall.libraryName}: what the assistant cites will be listed here.`
        : `${this.hall.libraryName} · ${this.cited.length} cited`;
  }

  /** Which turns cited something, and what each cited: what the bar between the panels is drawn from. */
  get citationsByTurn(): readonly { readonly turn: number; readonly addresses: readonly string[] }[] {
    const byTurn = new Map<number, string[]>();
    for (const section of this.cited) {
      const already = byTurn.get(section.turn);
      if (already === undefined) byTurn.set(section.turn, [section.address]);
      else already.push(section.address);
    }
    return [...byTurn.entries()].sort(([left], [right]) => left - right).map(([turn, addresses]) => ({ turn, addresses }));
  }

  /** Where a cited entry is drawn in the panel, for pointing at it and for scrolling to it. */
  entryFor(address: string): HTMLElement | undefined {
    return this.drawn.get(address);
  }

  /** Takes the author to a cited entry in the list. */
  goTo(address: string): void {
    const entry = this.drawn.get(address);
    if (entry === undefined) return;
    if (this.open !== undefined) this.closeDocument();
    entry.scrollIntoView({ block: 'center' });
    entry.classList.add('is-found');
    window.setTimeout(() => entry.classList.remove('is-found'), FOUND_MS);
  }

  private drawList(): void {
    this.say();
    this.drawn.clear();
    this.list.replaceChildren(
      ...this.cited.map((section) => {
        const entry = document.createElement('button');
        entry.type = 'button';
        entry.className = 'library-entry';
        entry.dataset['address'] = section.address;
        const address = document.createElement('span');
        address.className = 'library-address';
        address.textContent = section.address;
        const text = document.createElement('span');
        text.className = 'library-text';
        text.textContent = section.text === '' ? `(not in ${section.title})` : section.text;
        entry.append(address, text);
        entry.title = `${section.address} — ${section.title}`;
        entry.addEventListener('mousedown', (event) => event.preventDefault());
        entry.addEventListener('click', () => void this.choose(section));
        this.drawn.set(section.address, entry);
        return entry;
      }),
    );
  }

  /** Opens a library document at a line, whether or not it was ever cited — what Find in Files asks for. */
  async openAt(address: string, line: number): Promise<void> {
    if (this.hall === undefined) return;
    try {
      const read = await this.greatHall.document(address);
      const title = this.hall.documents.find((document) => document.address === documentOf(address))?.title ?? address;
      this.showDocument({ address, document: documentOf(address), line, text: '', title }, read.markdown, read.stamp);
    } catch (problem) {
      this.onProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  /** Opens a cited place as a live document, or puts it away again when it is the one already open. */
  private async choose(section: HallSection): Promise<void> {
    if (this.open?.section.address === section.address) {
      this.closeDocument();
      return;
    }
    try {
      const read = await this.greatHall.document(section.address);
      this.showDocument(section, read.markdown, read.stamp);
    } catch (problem) {
      this.onProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  /** The document, pinned under the entry that opened it, as a development tool pins what you opened. */
  private showDocument(section: HallSection, markdown: string, stamp: string): void {
    this.closeDocument();
    const holder = document.createElement('div');
    holder.className = 'library-open';

    const pinned = document.createElement('button');
    pinned.type = 'button';
    pinned.className = 'library-pinned';
    pinned.textContent = `${section.address} — ${section.title}`;
    pinned.title = 'Choose again to close';
    pinned.addEventListener('mousedown', (event) => event.preventDefault());
    pinned.addEventListener('click', () => this.closeDocument());

    const writing = document.createElement('textarea');
    writing.className = 'library-writing';
    writing.spellcheck = false;
    writing.value = markdown;
    writing.addEventListener('input', () => this.writeSoon(section.address, writing.value));

    holder.append(pinned, writing);
    this.elements.libraryInside.append(holder);
    this.list.hidden = true;
    this.open = { section, holder, stamp };
    Library.showLine(writing, section.line);
  }

  /**
   * Puts the line the author came for in view, and selects it so their eye lands on it.
   *
   * How tall a line is drawn is measured rather than assumed: a guess lands in the wrong place the moment the font
   * or the window changes, and the author is then looking at the wrong part of their own library.
   */
  private static showLine(writing: HTMLTextAreaElement, line: number): void {
    if (line <= 0) return;
    const lines = writing.value.split('\n');
    const before = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    const ends = before + (lines[line - 1]?.length ?? 0);
    writing.setSelectionRange(before, ends);
    const measured = Number.parseFloat(getComputedStyle(writing).lineHeight);
    const tall = Number.isFinite(measured) && measured > 0 ? measured : LINE_HEIGHT_WHEN_UNMEASURED;
    writing.scrollTop = Math.max(0, (line - 1) * tall - writing.clientHeight / 3);
  }

  /** Puts the document away; the list comes back exactly where it was. */
  private closeDocument(): void {
    this.writeNow();
    this.open?.holder.remove();
    this.open = undefined;
    this.list.hidden = false;
  }

  /** Where in the library the author is looking, for the bar between the panels; -1 when they are not. */
  get lookingAt(): { readonly address: string; readonly share: number } | undefined {
    const holder = this.open;
    if (holder === undefined) return undefined;
    const writing = holder.holder.querySelector('textarea');
    if (writing === null) return undefined;
    const room = writing.scrollHeight - writing.clientHeight;
    return { address: holder.section.address, share: room <= 0 ? 0 : writing.scrollTop / room };
  }

  private writeSoon(address: string, markdown: string): void {
    this.pending = { address, markdown };
    if (this.writingSoon !== 0) return;
    this.writingSoon = window.setTimeout(() => {
      this.writingSoon = 0;
      this.writeNow();
    }, WRITTEN_AFTER_MS);
  }

  private pending: { readonly address: string; readonly markdown: string } | undefined;

  /**
   * Writes the author's editing back to the library's own file — unless someone else has written to it since it was
   * opened, in which case nothing is written over and the author is told, with the way to read it afresh.
   */
  private writeNow(): void {
    if (this.writingSoon !== 0) {
      window.clearTimeout(this.writingSoon);
      this.writingSoon = 0;
    }
    const pending = this.pending;
    this.pending = undefined;
    if (pending === undefined) return;
    const open = this.open;
    void this.greatHall
      .saveDocument(pending.address, pending.markdown, open?.stamp ?? '')
      .then(() => {
        // What was written is now what stands on disk, so the next save is measured against this one.
        void this.greatHall.document(pending.address).then((read) => {
          if (this.open?.section.address === pending.address) this.open.stamp = read.stamp;
        });
      })
      .catch((problem: unknown) => {
        this.onProblem(
          `The library could not be saved: ${problem instanceof Error ? problem.message : String(problem)} Choose the entry again to read it as it now stands.`,
        );
      });
  }
}

/** How tall a line is taken to be when the page cannot say — a window not yet drawn has no measurements. */
const LINE_HEIGHT_WHEN_UNMEASURED = 19;

/** How long an entry the author was taken to stays marked, in milliseconds. */
const FOUND_MS = 1500;
