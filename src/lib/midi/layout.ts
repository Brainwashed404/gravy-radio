// What each of the 64 grid pads does, in visual order: 0 is the top left pad,
// counting left to right then down (row-major, 8 columns).
//
// Layout:
//   rows 0-3, all columns    A to Z station jump (26 used, 6 spare)
//   row 4, all columns       spare (8 pads)
//   rows 5-7, cols 4-7       the 12 genres, 4 per row, in a 4-wide x 3-tall block
//                            in the bottom right corner
//   rows 5-7, cols 0-3       the genre-matched visualiser modes, mirrored into the
//                            bottom left corner: same row as its genre, so the pad
//                            directly across the grid from a genre switches the
//                            visualiser to that genre's default mode

import { GRID_COLS, GRID_SIZE } from './apcMiniMk2';
import { PAD_GENRE_MAP, PAD_LABELS } from '../../data/stations';
import { GENRE_VISUALISER_MODE } from '../genreVisualiserModes';

export type PadSlot =
  | { kind: 'genre'; index: number }
  | { kind: 'letter'; letter: string }
  | { kind: 'visualiser'; mode: string; genreIndex: number }
  | { kind: 'empty' };

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const BLOCK_ROWS = 3;
const BLOCK_COLS = 4;
const BOTTOM_ROW_START = GRID_COLS - BLOCK_ROWS; // row 5
const RIGHT_COL_START = GRID_COLS - BLOCK_COLS;  // col 4

const layout: PadSlot[] = Array.from({ length: GRID_SIZE }, (): PadSlot => ({ kind: 'empty' }));
const visualIndex = (row: number, col: number) => row * GRID_COLS + col;

// A to Z across the top four rows, row by row.
LETTERS.forEach((letter, i) => {
  const row = Math.floor(i / GRID_COLS);
  const col = i % GRID_COLS;
  layout[visualIndex(row, col)] = { kind: 'letter', letter };
});

// The 12 genres and their mirrored visualiser modes share the same row/column
// position within their block, so each genre lines up with its visualiser pad
// straight across the grid.
PAD_LABELS.forEach((label, i) => {
  const blockRow = Math.floor(i / BLOCK_COLS);
  const blockCol = i % BLOCK_COLS;
  const row = BOTTOM_ROW_START + blockRow;

  layout[visualIndex(row, RIGHT_COL_START + blockCol)] = { kind: 'genre', index: i };

  const genre = PAD_GENRE_MAP[label];
  layout[visualIndex(row, blockCol)] = {
    kind: 'visualiser',
    mode: GENRE_VISUALISER_MODE[genre],
    genreIndex: i,
  };
});

export const PAD_LAYOUT: readonly PadSlot[] = layout;
