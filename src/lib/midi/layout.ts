// What each of the 64 grid pads does, in visual order: 0 is the top left pad,
// counting left to right then down (row-major, 8 columns).
//
// Layout:
//   rows 0-3, all columns    A to Z station jump (26 used, 6 spare)
//   rows 4-7, cols 5-7       the 12 genres, 3 per row, in a 3-wide x 4-tall block
//                            in the bottom right corner
//   rows 4-7, cols 0-2       the genre-matched visualiser modes, mirrored into the
//                            bottom left corner: same row as its genre, so the pad
//                            directly across the grid from a genre switches the
//                            visualiser to that genre's default mode
//   rows 4-7, cols 3-4       spare (8 pads)

import { GRID_COLS, GRID_SIZE } from './apcMiniMk2';
import { PAD_GENRE_MAP, PAD_LABELS } from '../../data/stations';
import { GENRE_VISUALISER_MODE } from '../genreVisualiserModes';

export type PadSlot =
  | { kind: 'genre'; index: number }
  | { kind: 'letter'; letter: string }
  | { kind: 'visualiser'; mode: string; genreIndex: number }
  | { kind: 'empty' };

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const BLOCK_ROWS = 4;
const BLOCK_COLS = 3;
const BOTTOM_ROW_START = GRID_COLS - BLOCK_ROWS; // row 4
const RIGHT_COL_START = GRID_COLS - BLOCK_COLS;  // col 5

const layout: PadSlot[] = Array.from({ length: GRID_SIZE }, (): PadSlot => ({ kind: 'empty' }));
const visualIndex = (row: number, col: number) => row * GRID_COLS + col;

// A to Z across the top four rows, row by row.
LETTERS.forEach((letter, i) => {
  const row = Math.floor(i / GRID_COLS);
  const col = i % GRID_COLS;
  layout[visualIndex(row, col)] = { kind: 'letter', letter };
});

// The 12 genres and their mirrored visualiser modes share the same row/column
// position within their 3x4 block, so each genre lines up with its visualiser pad
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
