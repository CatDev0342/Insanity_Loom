// How the author divided the window between the three sections: what passes between the page and the layer underneath
// so that it is still divided that way after a restart.

export interface PanelWidths {
  readonly left: number;
  readonly right: number;
}

export interface LayoutBridge {
  /** The widths the author last chose; zeros when they have chosen none. */
  panelWidths(): Promise<PanelWidths>;
  /** Remembers the widths the author has just dragged. */
  savePanelWidths(widths: PanelWidths): Promise<void>;
}

export const LAYOUT_CHANNELS = {
  panelWidths: 'insanity-loom:layout-panel-widths',
  savePanelWidths: 'insanity-loom:layout-save-panel-widths',
} as const;
