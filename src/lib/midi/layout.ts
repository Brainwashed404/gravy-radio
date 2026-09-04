// What each of the 64 grid pads does, in visual order: 0 is the top left pad,
// counting left to right then down (row-major, 8 columns).
//
// Layout: the bottom 3 rows are the only rows in use. Bottom right is the
// 12-genre block (4 wide x 3 tall), bottom left mirrors it exactly with 12
// looper pads in the same 4-wide x 3-tall shape - deliberately capped at 12
// rather than "every non-genre pad", the earlier all-52-pads version was more
// than this is ever actually used for. The 5 rows above both blocks (0-4) are
// entirely blank for now, free for whatever comes next.
//
// Looper pad behaviour is unchanged: press to record whatever's currently
// playing (baked in with whatever effects are live at that moment), press
// again to commit it as a loop, press a third time to stop and clear it.

import { GRID_COLS, GRID_SIZE } from './apcMiniMk2';
import { PAD_LABELS } from '../../data/stations';

export type PadSlot =
  | { kind: 'genre'; index: number }
  | { kind: 'looper'; padId: number }
  | { kind: 'empty' };

const GENRE_BLOCK_ROWS = 3;
const GENRE_BLOCK_COLS = 4;
const GENRE_BOTTOM_ROW_START = GRID_COLS - GENRE_BLOCK_ROWS; // row 5
const GENRE_RIGHT_COL_START = GRID_COLS - GENRE_BLOCK_COLS;  // col 4

const LOOP_BLOCK_ROWS = 3;
const LOOP_BLOCK_COLS = 4;
const LOOP_LEFT_COL_START = 0;

const visualIndex = (row: number, col: number) => row * GRID_COLS + col;

const layout: PadSlot[] = Array.from({ length: GRID_SIZE }, (): PadSlot => ({ kind: 'empty' }));

// Genre block: 4 wide, 3 tall, bottom right.
PAD_LABELS.forEach((_label, i) => {
  const blockRow = Math.floor(i / GENRE_BLOCK_COLS);
  const blockCol = i % GENRE_BLOCK_COLS;
  const row = GENRE_BOTTOM_ROW_START + blockRow;
  layout[visualIndex(row, GENRE_RIGHT_COL_START + blockCol)] = { kind: 'genre', index: i };
});

// Loop block: 4 wide, 3 tall, bottom left - same rows as the genre block,
// mirrored to the other side. padId is just 0-11 in row-major order, same
// convention as the genre block's own index.
let padCounter = 0;
for (let blockRow = 0; blockRow < LOOP_BLOCK_ROWS; blockRow++) {
  for (let blockCol = 0; blockCol < LOOP_BLOCK_COLS; blockCol++) {
    const row = GENRE_BOTTOM_ROW_START + blockRow;
    const col = LOOP_LEFT_COL_START + blockCol;
    layout[visualIndex(row, col)] = { kind: 'looper', padId: padCounter++ };
  }
}

export const PAD_LAYOUT: readonly PadSlot[] = layout;

/** Every padId that's a looper (12 of the 64 grid pads), for anything that
 *  needs to iterate all of them rather than walking the whole grid. */
export const LOOPER_PAD_IDS: readonly number[] = layout
  .filter((slot): slot is { kind: 'looper'; padId: number } => slot.kind === 'looper')
  .map((slot) => slot.padId);
