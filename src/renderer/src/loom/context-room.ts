// How much room is left in the assistant's context window, said in the status bar.
//
// The assistant reports what it is holding and how much it can hold (ACP's usage_update); Insanity_Loom says it in
// words the author can read at a glance — "62% used · 124k of 200k" — and draws it as a bar beside them. When the
// room runs low the words change color, and Compact offers to make room by having the assistant summarize what has
// been said so far.

/** Below this share of the window left, the author is told plainly that room is running out. */
const LITTLE_ROOM_LEFT = 0.2;

/** Tokens are counted in thousands once there are more than this many, as every tool that shows them does. */
const THOUSAND = 1000;

export interface ContextElements {
  readonly contextHolder: HTMLElement;
  readonly contextSaid: HTMLElement;
  readonly contextFull: HTMLElement;
  readonly compactButton: HTMLButtonElement;
}

/** A number of tokens as the author reads it: "124k", or "820" when there are few. */
export function inThousands(tokens: number): string {
  return tokens >= THOUSAND ? `${Math.round(tokens / THOUSAND)}k` : String(Math.round(tokens));
}

/** What the status bar says about the room left. */
export function describeRoom(used: number, size: number): { readonly said: string; readonly share: number; readonly little: boolean } {
  if (size <= 0) return { said: '', share: 0, little: false };
  const share = Math.min(1, Math.max(0, used / size));
  return {
    said: `${Math.round(share * 100)}% of context · ${inThousands(used)} of ${inThousands(size)}`,
    share,
    little: 1 - share <= LITTLE_ROOM_LEFT,
  };
}

export class ContextRoom {
  constructor(
    private readonly elements: ContextElements,
    compact: () => void,
  ) {
    elements.compactButton.addEventListener('click', () => compact());
  }

  /** The assistant said what it is holding. Nothing is shown until it does. */
  show(used: number, size: number): void {
    const room = describeRoom(used, size);
    if (room.said === '') {
      this.elements.contextHolder.hidden = true;
      return;
    }
    this.elements.contextHolder.hidden = false;
    this.elements.contextSaid.textContent = room.said;
    this.elements.contextFull.style.width = `${(room.share * 100).toFixed(1)}%`;
    this.elements.contextHolder.dataset['room'] = room.little ? 'little' : 'plenty';
  }

  /** Whether the assistant offers to make room at all; the button appears only if it does. */
  offersCompacting(offers: boolean): void {
    this.elements.compactButton.hidden = !offers;
  }

  /** What is happening while room is being made. */
  compacting(status: string): void {
    const busy = status === 'in_progress';
    this.elements.compactButton.disabled = busy;
    this.elements.compactButton.textContent = busy ? 'Compacting…' : 'Compact';
  }
}
