// APC mini mk2 device profile.
//
// SAFETY: this module is deliberately scoped to ONE device. The port matcher is an
// allowlist, not a "find any MIDI thing" search. Nothing in this app opens, reads or
// writes to any other controller — an APC40 running an Ableton set sitting on the same
// USB bus must never receive a byte from us, or we would stomp its clip LEDs.

/** Only ports whose name matches this are ever opened, in either direction. */
const PORT_ALLOWLIST = /apc\s*mini\s*mk\s*2/i;

export function isTargetPort(name: string | null | undefined): boolean {
  return !!name && PORT_ALLOWLIST.test(name);
}

// ─── Control surface constants ────────────────────────────────────────────────
// Grid pads are documented and stable. The button note numbers below are the
// mk2 defaults; if any of them turn out to be wrong on this unit, the MIDI panel's
// Learn mode rebinds them at runtime and persists the override, so nothing here
// needs editing.

export const GRID_COLS = 8;
export const GRID_ROWS = 8;
export const GRID_SIZE = GRID_COLS * GRID_ROWS;

/** Bottom row of round buttons: VOLUME PAN SEND DEVICE, then the four arrows. */
export const TRACK_BUTTON_NOTES = [100, 101, 102, 103, 104, 105, 106, 107] as const;

/** Right hand column, top to bottom: CLIP STOP, SOLO, MUTE, REC ARM, SELECT, DRUM, NOTE, STOP ALL CLIPS. */
export const SCENE_BUTTON_NOTES = [112, 113, 114, 115, 116, 117, 118, 119] as const;

export const SHIFT_NOTE = 122;

/** Faders 1 to 8 left to right, then the master fader on the right of the unit. */
export const TRACK_FADER_CCS = [48, 49, 50, 51, 52, 53, 54, 55] as const;
export const MASTER_FADER_CC = 56;

// ─── Grid addressing ──────────────────────────────────────────────────────────
// The grid is addressed here by VISUAL index: 0 is the top left pad, counting left
// to right then down, so layout code reads the way the hardware looks. The device
// itself numbers note 0 at the bottom left, so we flip rows on the way out.
//
// Firmware revisions have been known to differ on this, which is why the origin is a
// runtime setting rather than a baked in constant. If the top and bottom rows come
// out swapped, flip it in the MIDI panel.

export type GridOrigin = 'bottom-left' | 'top-left';

export function visualToNote(visual: number, origin: GridOrigin): number {
  const row = Math.floor(visual / GRID_COLS);
  const col = visual % GRID_COLS;
  return origin === 'bottom-left' ? (GRID_ROWS - 1 - row) * GRID_COLS + col : row * GRID_COLS + col;
}

export function noteToVisual(note: number, origin: GridOrigin): number | null {
  if (note < 0 || note >= GRID_SIZE) return null;
  const row = Math.floor(note / GRID_COLS);
  const col = note % GRID_COLS;
  return origin === 'bottom-left' ? (GRID_ROWS - 1 - row) * GRID_COLS + col : row * GRID_COLS + col;
}

// ─── Pad colours ──────────────────────────────────────────────────────────────
// Grid pads are RGB and take a palette index as velocity, with the MIDI channel
// selecting brightness or animation. These are the standard palette slots; tweak the
// numbers here if a colour reads differently in the flesh.

export const COLOUR = {
  off: 0,
  grey: 1,
  white: 3,
  red: 5,
  amber: 9,
  yellow: 13,
  green: 21,
  blue: 45,
  purple: 53,
} as const;

/** One distinct colour per genre, in PAD_LABELS order, so every genre pad (and its
 *  mirrored visualiser pad) is recognisable by colour alone. A rough spread across
 *  the palette rather than a verified chart: these are the first thing to eyeball
 *  and adjust against the real hardware, since unlike button and letter positions
 *  there's no Learn mode for colour. */
export const GENRE_PALETTE = [
  5,   // AMBIENT + CHILL: red
  9,   // CLASSICAL: orange
  13,  // DNB + RAVE: yellow
  17,  // DRAMA + TALK: yellow-green
  21,  // DUB + REGGAE: green
  25,  // ECLECTIC: spring green
  29,  // HIP HOP + RNB: teal
  33,  // HOUSE + UKG: cyan
  41,  // JAZZ + EXOTICA: sky blue
  45,  // LEGENDS + ERAS: blue
  53,  // ROCK + INDIE: purple
  57,  // SOUL + FUNK: magenta
] as const;

/** Note-on status bytes. Low channels are dim, channel 7 is full brightness, higher channels animate. */
export const PAD_DIM = 0x92;      // ~50% brightness, solid
export const PAD_MID = 0x94;      // ~75% brightness, solid
export const PAD_SOLID = 0x96;    // 100% brightness, solid
export const PAD_PULSE = 0x99;    // pulsing
export const PAD_BLINK = 0x9b;    // blinking

/** The seven static (non-animating) brightness channels for a single palette colour,
 *  10% through 100%. Used for the A-Z gradient: same hue throughout, stepped shade. */
export const PAD_BRIGHTNESS = [0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96] as const;

/** The round buttons are single colour: 0 off, 1 lit, 2 blinking, always on channel 1. */
export const BUTTON_STATUS = 0x90;
export const BUTTON_OFF = 0;
export const BUTTON_ON = 1;
export const BUTTON_BLINK = 2;
