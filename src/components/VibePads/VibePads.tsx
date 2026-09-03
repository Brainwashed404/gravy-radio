import { type Genre, PAD_GENRE_MAP, PAD_LABELS, type PadLabel } from '../../data/stations';
import type { PlaybackStatus } from '../../hooks/useAudioEngine';
import { GENRE_GLOW_COLOURS } from '../../lib/genreGlowColours';
import { VibePad, type PadGlowState } from './VibePad';
import styles from './VibePads.module.css';

interface VibePadsProps {
  activeGenre: Genre | null;
  onPadClick: (label: PadLabel) => void;
  /** When set, each pad glows the colour its LED is showing on the connected APC
   *  mini right now. Omit (or pass false) when MIDI isn't connected. */
  midiConnected?: boolean;
  playbackStatus?: PlaybackStatus;
}

export function VibePads({ activeGenre, onPadClick, midiConnected, playbackStatus }: VibePadsProps) {
  return (
    <div className={styles.grid}>
      {PAD_LABELS.map((label, index) => {
        const isActive = activeGenre === PAD_GENRE_MAP[label];
        const glowState: PadGlowState = !isActive
          ? 'idle'
          : playbackStatus === 'error' ? 'error'
          : playbackStatus === 'loading' ? 'loading'
          : 'active';
        // Idle/active glow is a genuine hardware mirror, so it stays MIDI-only
        // (its whole point is showing the same colour the LED is actually
        // showing). Loading and error aren't decorative, they're the only
        // pulse/colour feedback a station is loading or failed - gating those
        // behind midiConnected too meant nobody using the app without the
        // controller ever saw any loading pulse at all, just a static border.
        const showGlow = midiConnected || glowState === 'loading' || glowState === 'error';
        return (
          <VibePad
            key={label}
            label={label}
            isActive={isActive}
            onClick={() => onPadClick(label)}
            glow={showGlow ? { colour: GENRE_GLOW_COLOURS[index], state: glowState } : null}
          />
        );
      })}
    </div>
  );
}
