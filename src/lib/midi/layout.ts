// What each of the 64 grid pads does, in visual order: 0 is the top left pad.
//
//   rows 0-1   12 genre pads (row 0 full, row 1 half), 4 spare
//   rows 2-5   A to Z station jump, 6 spare
//   rows 6-7   12 visualiser modes, 4 spare

import { GRID_SIZE } from './apcMiniMk2';

export type PadSlot =
  | { kind: 'genre'; index: number }
  | { kind: 'letter'; letter: string }
  | { kind: 'visualiser'; mode: string }
  | { kind: 'empty' };

export const GENRE_START = 0;
export const GENRE_COUNT = 12;
export const LETTER_START = 16;
export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
export const VISUALISER_START = 48;
/** Matches the keys the visualiser's own modes object is keyed by. */
export const VISUALISER_MODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'a', 'b'];

export const PAD_LAYOUT: PadSlot[] = Array.from({ length: GRID_SIZE }, (_, i): PadSlot => {
  if (i >= GENRE_START && i < GENRE_START + GENRE_COUNT) {
    return { kind: 'genre', index: i - GENRE_START };
  }
  if (i >= LETTER_START && i < LETTER_START + LETTERS.length) {
    return { kind: 'letter', letter: LETTERS[i - LETTER_START] };
  }
  if (i >= VISUALISER_START && i < VISUALISER_START + VISUALISER_MODES.length) {
    return { kind: 'visualiser', mode: VISUALISER_MODES[i - VISUALISER_START] };
  }
  return { kind: 'empty' };
});
