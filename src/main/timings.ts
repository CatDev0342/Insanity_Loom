// Where the rows measuring a turn are kept: Data/Logs/timings.tsv, one line per turn, with a heading line the first
// time so the file can be read by anyone who opens it — including a spreadsheet.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TIMINGS_FILE_NAME } from '../shared/timings';
import { appendFileSafely } from './files';

/** The heading line, matching src/renderer/src/loom/timings.ts's columns. */
const HEADING = ['when', 'turn', 'sent', 'untilAsked', 'untilFirstWord', 'pieces', 'usualGap', 'worstGap', 'drawing', 'untilFinished', 'assistant'].join(
  '\t',
);

export function recordTiming(logsFolder: string, row: string): void {
  const file = join(logsFolder, TIMINGS_FILE_NAME);
  const heading = existsSync(file) ? '' : `${HEADING}\n`;
  appendFileSafely(file, `${heading}${row}\n`);
}
