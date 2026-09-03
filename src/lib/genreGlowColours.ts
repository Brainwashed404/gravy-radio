// On-screen equivalent of GENRE_PALETTE (src/lib/midi/apcMiniMk2.ts): that array is
// APC mini palette indices for the hardware LEDs, this is real CSS colour for the
// matching glow on the genre pads in the app itself. Same 12 hues, same order as
// PAD_LABELS, so a pad glows on screen the colour it's lit on the controller.
export const GENRE_GLOW_COLOURS = [
  '#e5484d', // AMBIENT + CHILL: red
  '#f0883e', // CLASSICAL: orange
  '#f5d90a', // DNB + RAVE: yellow
  '#b4d332', // DRAMA + TALK: yellow-green
  '#46a758', // DUB + REGGAE: green
  '#2fbd77', // ECLECTIC: spring green
  '#12a594', // HIP HOP + RNB: teal
  '#00b8d9', // HOUSE + UKG: cyan
  '#0091ff', // JAZZ + EXOTICA: sky blue
  '#3e63dd', // LEGENDS + ERAS: blue
  '#8e4ec6', // ROCK + INDIE: purple
  '#d6409f', // SOUL + FUNK: magenta
] as const;
