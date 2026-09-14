// The bars between the three sections of the window, and how wide the author has made each.
//
// The writing fills whatever room it is given, so how the screen is divided is the author's to decide and the
// program's to remember. A bar is dragged with the pointer, or moved with the arrow keys when it has the keyboard —
// it is a separator, and says so, with how wide the panel now is.
//
// What is dragged is always a *panel's* width; the writing takes the rest. That way a wider window gives its new room
// to the writing, which is what the author is looking at.

/** How far an arrow key moves a bar, in pixels. */
const STEP_PX = 16;

/** The narrowest and widest a panel may be made, in pixels: narrow enough to tuck away, never wider than the window. */
const NARROWEST_PX = 120;
const WIDEST_SHARE = 0.45;

export interface PanelWidths {
  readonly left: number;
  readonly right: number;
}

export const PANEL_WIDTHS_UNSET: PanelWidths = { left: 0, right: 0 };

export interface SplitterElements {
  readonly leftSplitter: HTMLElement;
  readonly rightSplitter: HTMLElement;
  readonly leftPanel: HTMLElement;
  readonly rightPanel: HTMLElement;
}

/** Keeps a width within what the window can hold. */
export function widthWithin(asked: number, windowWidth: number): number {
  const widest = Math.max(NARROWEST_PX, Math.round(windowWidth * WIDEST_SHARE));
  return Math.min(widest, Math.max(NARROWEST_PX, Math.round(asked)));
}

export class Splitters {
  private widths: PanelWidths = PANEL_WIDTHS_UNSET;

  constructor(
    private readonly elements: SplitterElements,
    private readonly onChanged: (widths: PanelWidths) => void,
  ) {
    this.watch(elements.leftSplitter, 'left');
    this.watch(elements.rightSplitter, 'right');
  }

  /** The widths the author last chose; nothing means the panels keep the width the page gives them. */
  use(widths: PanelWidths): void {
    this.widths = widths;
    if (widths.left > 0) this.set('left', widths.left);
    if (widths.right > 0) this.set('right', widths.right);
  }

  get chosen(): PanelWidths {
    return this.widths;
  }

  private panelOf(side: 'left' | 'right'): HTMLElement {
    return side === 'left' ? this.elements.leftPanel : this.elements.rightPanel;
  }

  private set(side: 'left' | 'right', width: number): void {
    const kept = widthWithin(width, window.innerWidth);
    document.documentElement.style.setProperty(`--${side}-panel-width`, `${String(kept)}px`);
    this.widths = side === 'left' ? { ...this.widths, left: kept } : { ...this.widths, right: kept };
    const splitter = side === 'left' ? this.elements.leftSplitter : this.elements.rightSplitter;
    splitter.setAttribute('aria-valuenow', String(kept));
    this.onChanged(this.widths);
  }

  private watch(splitter: HTMLElement, side: 'left' | 'right'): void {
    splitter.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      splitter.setPointerCapture(event.pointerId);
      splitter.dataset['dragging'] = 'true';
    });
    splitter.addEventListener('pointermove', (event) => {
      if (splitter.dataset['dragging'] !== 'true') return;
      const panel = this.panelOf(side).getBoundingClientRect();
      // The edge the author is dragging is the one away from the panel, so the panel grows toward the pointer.
      this.set(side, side === 'left' ? event.clientX - panel.left : panel.right - event.clientX);
    });
    const letGo = (event: PointerEvent): void => {
      if (splitter.dataset['dragging'] !== 'true') return;
      splitter.dataset['dragging'] = 'false';
      splitter.releasePointerCapture(event.pointerId);
    };
    splitter.addEventListener('pointerup', letGo);
    splitter.addEventListener('pointercancel', letGo);

    splitter.addEventListener('keydown', (event) => {
      const wider = event.key === (side === 'left' ? 'ArrowRight' : 'ArrowLeft');
      const narrower = event.key === (side === 'left' ? 'ArrowLeft' : 'ArrowRight');
      if (!wider && !narrower) return;
      event.preventDefault();
      const now = this.panelOf(side).getBoundingClientRect().width;
      this.set(side, now + (wider ? STEP_PX : -STEP_PX));
    });
  }
}
