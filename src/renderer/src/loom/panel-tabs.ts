// The tabs at the top of a side panel, and the panes beneath them.
//
// A panel holds several things the author may want in the same place — the assistant's thinking, the library it is
// citing — and only one at a time. The tabs behave as a desktop program's do: Left and Right move between them, Home
// and End to the ends, and only the tab in use is in the Tab order, so a keyboard passes the strip in one step.

export interface Tab {
  readonly id: string;
  readonly name: string;
  readonly pane: HTMLElement;
}

export class PanelTabs {
  private readonly buttons: HTMLButtonElement[] = [];
  private showing = 0;

  constructor(
    private readonly strip: HTMLElement,
    private readonly tabs: readonly Tab[],
    private readonly onShown?: (id: string) => void,
  ) {
    strip.setAttribute('role', 'tablist');
    tabs.forEach((tab, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'panel-tab';
      button.id = `tab-${tab.id}`;
      button.textContent = tab.name;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', tab.pane.id);
      tab.pane.setAttribute('role', 'tabpanel');
      tab.pane.setAttribute('aria-labelledby', button.id);
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => this.show(index));
      button.addEventListener('keydown', (event) => this.onKey(event, index));
      strip.append(button);
      this.buttons.push(button);
    });
    this.show(0);
  }

  /** Shows a tab by its name in the code; nothing happens if there is no such tab. */
  showTab(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index !== -1) this.show(index);
  }

  get showingTab(): string {
    return this.tabs[this.showing]?.id ?? '';
  }

  /** Which tab a key asks for, or nothing when the key is not the strip's. */
  private static tabFor(key: string, index: number, count: number): number | undefined {
    if (key === 'ArrowLeft') return (index - 1 + count) % count;
    if (key === 'ArrowRight') return (index + 1) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return undefined;
  }

  private show(index: number): void {
    this.showing = index;
    this.tabs.forEach((tab, at) => {
      const chosen = at === index;
      tab.pane.hidden = !chosen;
      const button = this.buttons[at];
      if (button === undefined) return;
      button.setAttribute('aria-selected', chosen ? 'true' : 'false');
      // Only the tab in use is in the Tab order: the strip is one stop, and the arrows move within it.
      button.tabIndex = chosen ? 0 : -1;
    });
    this.onShown?.(this.showingTab);
  }

  private onKey(event: KeyboardEvent, index: number): void {
    const count = this.tabs.length;
    const next = PanelTabs.tabFor(event.key, index, count);
    if (next === undefined) return;
    event.preventDefault();
    this.show(next);
    this.buttons[next]?.focus();
  }
}
