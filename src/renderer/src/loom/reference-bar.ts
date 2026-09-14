// The thin bar between the whisper and the panel beside it.
//
// The two do not scroll together — being dragged about while reading is worse than scrolling — so the bar says how
// far apart they have drifted instead. Every turn whose reply cited the library leaves a mark on the bar, at the
// height of that turn in the whisper; the mark for the turn the author is reading is lit, and an arrow at the top or
// the bottom says which way the library must go to show what that turn cited. Choosing a mark takes both there.
//
// It is the idea of the bar a development tool draws beside its scrollbar, made to point at another panel rather than
// at the same document.

/** How near the middle of the window a turn must be to count as the one being read, as a share of the window. */
const READING_BAND = 0.5;

export interface ReferenceBarElements {
  readonly referenceBar: HTMLElement;
}

export interface ReferenceBarSource {
  /** Which turns cited the library, and what each cited. */
  readonly citations: () => readonly { readonly turn: number; readonly addresses: readonly string[] }[];
  /** Where the line closing a turn is drawn, or undefined when it is not in the whisper. */
  readonly turnElement: (turn: number) => HTMLElement | undefined;
  /** Where a cited entry is drawn in the panel beside it. */
  readonly entryElement: (address: string) => HTMLElement | undefined;
  /** The whisper's scroll, and the panel's. */
  readonly whisperScroll: HTMLElement;
  readonly panelScroll: HTMLElement;
  /** Takes the author to a citation in the panel. */
  readonly goToCitation: (address: string) => void;
}

/** Which way the panel must go to show what the author is reading about: nothing when it is already showing it. */
export function whichWay(entry: DOMRect | undefined, view: DOMRect): 'up' | 'down' | 'here' | 'none' {
  if (entry === undefined) return 'none';
  if (entry.bottom < view.top) return 'up';
  if (entry.top > view.bottom) return 'down';
  return 'here';
}

export class ReferenceBar {
  private readonly marks = document.createElement('div');
  private readonly arrowUp = document.createElement('div');
  private readonly arrowDown = document.createElement('div');
  private drawingSoon = 0;

  constructor(
    private readonly elements: ReferenceBarElements,
    private readonly source: ReferenceBarSource,
  ) {
    this.marks.className = 'reference-marks';
    this.arrowUp.className = 'reference-arrow reference-arrow-up';
    this.arrowUp.textContent = '▲';
    this.arrowDown.className = 'reference-arrow reference-arrow-down';
    this.arrowDown.textContent = '▼';
    elements.referenceBar.append(this.arrowUp, this.marks, this.arrowDown);
    source.whisperScroll.addEventListener('scroll', () => this.drawSoon(), { passive: true });
    source.panelScroll.addEventListener('scroll', () => this.drawSoon(), { passive: true });
    window.addEventListener('resize', () => this.drawSoon());
  }

  /** The whisper or the list changed; the bar follows, at the next frame rather than at every pixel of scrolling. */
  drawSoon(): void {
    if (this.drawingSoon !== 0) return;
    this.drawingSoon = requestAnimationFrame(() => {
      this.drawingSoon = 0;
      this.draw();
    });
  }

  draw(): void {
    const citations = this.source.citations();
    const whisper = this.source.whisperScroll;
    const bar = this.elements.referenceBar;
    if (citations.length === 0) {
      this.marks.replaceChildren();
      bar.dataset['state'] = 'quiet';
      this.arrowUp.hidden = true;
      this.arrowDown.hidden = true;
      return;
    }

    const middle = whisper.scrollTop + whisper.clientHeight / 2;
    const band = whisper.clientHeight * READING_BAND;
    const view = this.source.panelScroll.getBoundingClientRect();
    let reading: { readonly addresses: readonly string[]; readonly apart: number } | undefined;

    this.marks.replaceChildren(
      ...citations.flatMap((citation) => {
        const element = this.source.turnElement(citation.turn);
        if (element === undefined) return [];
        const at = element.offsetTop;
        const share = Math.min(1, Math.max(0, at / Math.max(1, whisper.scrollHeight)));
        const apart = Math.abs(at - middle);
        if (apart <= band && (reading === undefined || apart < reading.apart)) reading = { addresses: citation.addresses, apart };

        const mark = document.createElement('button');
        mark.type = 'button';
        mark.className = 'reference-mark';
        mark.style.top = `${(share * 100).toFixed(2)}%`;
        mark.setAttribute('aria-label', `Turn ${citation.turn}: ${citation.addresses.join(', ')}`);
        mark.title = `Turn ${citation.turn} · ${citation.addresses.join(', ')}`;
        if (apart <= band) mark.dataset['reading'] = 'true';
        mark.addEventListener('mousedown', (event) => event.preventDefault());
        mark.addEventListener('click', () => {
          element.scrollIntoView({ block: 'center' });
          const first = citation.addresses[0];
          if (first !== undefined) this.source.goToCitation(first);
        });
        return [mark];
      }),
    );

    // Where the panel must go to show what the turn being read cited.
    const address = reading?.addresses[0];
    const entry = address === undefined ? undefined : this.source.entryElement(address);
    const way = whichWay(entry?.getBoundingClientRect(), view);
    bar.dataset['state'] = way === 'up' || way === 'down' ? 'apart' : 'quiet';
    this.arrowUp.hidden = way !== 'up';
    this.arrowDown.hidden = way !== 'down';
  }
}
