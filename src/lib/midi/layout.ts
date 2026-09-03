// What each of the 64 grid pads does, in visual order: 0 is the top left pad,
// counting left to right then down (row-major, 8 columns).
//
// Layout:
//   rows 0-3, all columns    A to Z station jump (26 used, 6 spare)
//   row 4, col 4             the live looper: press to start recording,
//                            press again to loop it, press a third time to
//                            stop and clear
//   rows 4-7, cols 4-7       the 12 genres, 4 per row, in a 4-wide x 3-tall
//                            block in the bottom right corner (row 4 of this
//                            column range is otherwise spare - genres only
//                            need 3 rows - cols 5-7 of it still are)
//   col 3, rows 4-7          spacer column, always empty, between the two blocks
//   rows 4-7, cols 0-2       the genre-matched visualiser modes, mirrored into
//                            the bottom left corner in their own 3-wide x
//                            4-tall block
//
// The genre block and the visualiser block are DIFFERENT shapes (4x3 vs 3x4)
// so a spacer column would fit between them (4+1+3=8), which is a deliberate
// trade: the two blocks no longer share row-for-row correspondence the way a
// same-shape mirror would, so "the pad directly across the grid from a genre"
// only actually lines up with that genre's visualiser pad for some of the 12
// (whichever ones happen to land on the same row under each block's own
// independent row-major layout) rather than all of them - there is no way to
// keep a perfect straight-across mirror once the two blocks have unequal
// width, this is the least-bad option given a real spacer column was wanted
// and only one block could stay 4 wide.

import { GRID_COLS, GRID_SIZE } from './apcMiniMk2';
import { PAD_GENRE_MAP, PAD_LABELS } from '../../data/stations';
import { GENRE_VISUALISER_MODE } from '../genreVisualiserModes';

export type PadSlot =
  | { kind: 'genre'; index: number }
  | { kind: 'letter'; letter: string }
  | { kind: 'visualiser'; mode: string; genreIndex: number }
  | { kind: 'looper' }
  | { kind: 'empty' };

/** Row 4, col 4 - the first pad past the spacer column, on its own with
 *  nothing genre- or visualiser-related sharing the row. */
export const LOOPER_PAD_VISUAL_INDEX = 4 * GRID_COLS + 4;

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const GENRE_BLOCK_ROWS = 3;
const GENRE_BLOCK_COLS = 4;
const GENRE_BOTTOM_ROW_START = GRID_COLS - GENRE_BLOCK_ROWS; // row 5
const GENRE_RIGHT_COL_START = GRID_COLS - GENRE_BLOCK_COLS;  // col 4

const VIZ_BLOCK_ROWS = 4;
const VIZ_BLOCK_COLS = 3;
const VIZ_BOTTOM_ROW_START = GRID_COLS - VIZ_BLOCK_ROWS; // row 4
const VIZ_LEFT_COL_START = 0;

const layout: PadSlot[] = Array.from({ length: GRID_SIZE }, (): PadSlot => ({ kind: 'empty' }));
const visualIndex = (row: number, col: number) => row * GRID_COLS + col;

// A to Z across the top four rows, row by row.
LETTERS.forEach((letter, i) => {
  const row = Math.floor(i / GRID_COLS);
  const col = i % GRID_COLS;
  layout[visualIndex(row, col)] = { kind: 'letter', letter };
});

layout[LOOPER_PAD_VISUAL_INDEX] = { kind: 'looper' };

// Genre block: 4 wide, 3 tall, bottom right.
PAD_LABELS.forEach((_label, i) => {
  const blockRow = Math.floor(i / GENRE_BLOCK_COLS);
  const blockCol = i % GENRE_BLOCK_COLS;
  const row = GENRE_BOTTOM_ROW_START + blockRow;
  layout[visualIndex(row, GENRE_RIGHT_COL_START + blockCol)] = { kind: 'genre', index: i };
});

// Visualiser block: 3 wide, 4 tall, bottom left, laid out independently of the
// genre block's own row/column geometry (see the header comment on why they
// can't share row-for-row placement any more).
PAD_LABELS.forEach((label, i) => {
  const blockRow = Math.floor(i / VIZ_BLOCK_COLS);
  const blockCol = i % VIZ_BLOCK_COLS;
  const row = VIZ_BOTTOM_ROW_START + blockRow;
  const genre = PAD_GENRE_MAP[label];
  layout[visualIndex(row, VIZ_LEFT_COL_START + blockCol)] = {
    kind: 'visualiser',
    mode: GENRE_VISUALISER_MODE[genre],
    genreIndex: i,
  };
});

export const PAD_LAYOUT: readonly PadSlot[] = layout;
