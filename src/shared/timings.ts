// Writing down what a turn cost, so where the seconds go is measured rather than argued about
// (src/renderer/src/loom/timings.ts).

export interface TimingsBridge {
  /** Adds one turn's row to Data/Logs/timings.tsv. */
  record(row: string): Promise<void>;
}

export const TIMING_CHANNELS = {
  record: 'insanity-loom:timings-record',
} as const;

/** What the file is called, and what its first line says. */
export const TIMINGS_FILE_NAME = 'timings.tsv';
