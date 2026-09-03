// On-screen equivalent of GENRE_PALETTE (src/lib/midi/apcMiniMk2.ts): that array is
// APC mini palette indices for the hardware LEDs, this is real CSS colour for the
// matching glow on the genre pads in the app itself. Same 12 hues, same order as
// PAD_LABELS, so a pad glows on screen the colour it's lit on the controller.
//
// Deliberately NOT a smooth rainbow in PAD_LABELS order any more: that put every
// pad next to another pad one hue-step away, so a whole grid of adjacent pads
// all looked like shades of the same colour. Reassigned via a step-5 permutation
// of the same 12 hues instead (position i gets hue index (i*5) mod 12), which
// scatters them so every pair of grid neighbours - checked against the desktop
// grid (6 across, 2 tall), the mobile grid (3 across, 4 tall), and the
// hardware's genre block (4 across, 3 tall) - sits at minimum 53 degrees apart
// on the colour wheel (was ~16 degrees before, i.e. next-door on the wheel),
// most pairs much further.
export const GENRE_GLOW_COLOURS = [
  '#e5484d', // AMBIENT + CHILL: red
  '#2fbd77', // CLASSICAL: spring green
  '#8e4ec6', // DNB + RAVE: purple
  '#b4d332', // DRAMA + TALK: yellow-green
  '#0091ff', // DUB + REGGAE: sky blue
  '#f0883e', // ECLECTIC: orange
  '#12a594', // HIP HOP + RNB: teal
  '#d6409f', // HOUSE + UKG: magenta
  '#46a758', // JAZZ + EXOTICA: green
  '#3e63dd', // LEGENDS + ERAS: blue
  '#f5d90a', // ROCK + INDIE: yellow
  '#00b8d9', // SOUL + FUNK: cyan
] as const;
