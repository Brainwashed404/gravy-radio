// What each of the 64 grid pads does, in visual order: 0 is the top left pad,
// counting left to right then down (row-major, 8 columns).
//
// Layout: the 12 genre pads keep their 4-wide x 3-tall block, bottom right
// (rows 5-7, cols 4-7). Every other pad on the grid (52 of them) is an
// independent live looper: press to record whatever's currently playing
// (baked in with whatever effects are live at that moment), press again to
// commit it as a loop, press a third time to stop and clear it. There's no
// reserved letter-jump block any more and no separate visualiser-select
// block - both were retired in favour of maximising loop pads (visualiser
// mode selection moved to the NOTE soft key instead, see bindings.ts).

import { GRID_COLS, GRID_SIZE } from './apcMiniMk2';
import { PAD_LABELS } from '../../data/stations';

export type PadSlot =
  | { kind: 'genre'; index: number }
  | { kind: 'looper'; padId: number };

const GENRE_BLOCK_ROWS = 3;
const GENRE_BLOCK_COLS = 4;
const GENRE_BOTTOM_ROW_START = GRID_COLS - GENRE_BLOCK_ROWS; // row 5
const GENRE_RIGHT_COL_START = GRID_COLS - GENRE_BLOCK_COLS;  // col 4

const visualIndex = (row: number, col: number) => row * GRID_COLS + col;

// Start every pad as a looper, identified by its own visual index (stable,
// unique, doubles as the padId used everywhere else - the fx bridge, the
// on-screen loop bank panel, the fader-slot mixer). Then carve out the genre
// block on top.
const layout: PadSlot[] = Array.from({ length: GRID_SIZE }, (_, visual): PadSlot => ({
  kind: 'looper',
  padId: visual,
}));

// Genre block: 4 wide, 3 tall, bottom right.
PAD_LABELS.forEach((_label, i) => {
  const blockRow = Math.floor(i / GENRE_BLOCK_COLS);
  const blockCol = i % GENRE_BLOCK_COLS;
  const row = GENRE_BOTTOM_ROW_START + blockRow;
  layout[visualIndex(row, GENRE_RIGHT_COL_START + blockCol)] = { kind: 'genre', index: i };
});

export const PAD_LAYOUT: readonly PadSlot[] = layout;

/** Every padId that's a looper (52 of the 64 grid pads), for anything that
 *  needs to iterate all of them rather than walking the whole grid. */
export const LOOPER_PAD_IDS: readonly number[] = layout
  .filter((slot): slot is { kind: 'looper'; padId: number } => slot.kind === 'looper')
  .map((slot) => slot.padId);
