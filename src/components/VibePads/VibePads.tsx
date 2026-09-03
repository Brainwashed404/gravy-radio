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
        return (
          <VibePad
            key={label}
            label={label}
            isActive={isActive}
            onClick={() => onPadClick(label)}
            glow={midiConnected ? { colour: GENRE_GLOW_COLOURS[index], state: glowState } : null}
          />
        );
      })}
    </div>
  );
}
