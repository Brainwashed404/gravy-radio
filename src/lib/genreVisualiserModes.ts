// Which GravityVisualiser mode each genre defaults to. Single source of truth for
// both the visualiser itself (keys the genre currently playing) and the APC mini's
// pad layout (mirrors the genre grid's visualiser modes, in the same order).
import { type Genre } from '../data/stations';

export const GENRE_VISUALISER_MODE: Record<Genre, string> = {
  'AMBIENT + CHILL': '3',
  'CLASSICAL':       '5',
  'DNB + RAVE':      '4',
  'DRAMA + TALK':    'b',
  'DUB + REGGAE':    '6',
  'ECLECTIC':        '0',
  'HIP HOP + RNB':   '9',
  'HOUSE + UKG':     '1',
  'JAZZ + EXOTICA':  '8',
  'LEGENDS + ERAS':  'a',
  'ROCK + INDIE':    '7',
  'SOUL + FUNK':     '2',
};
