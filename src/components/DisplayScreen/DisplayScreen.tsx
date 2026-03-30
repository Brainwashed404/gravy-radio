import { motion, AnimatePresence } from 'framer-motion';
import { type Station } from '../../data/stations';
import { type PlaybackStatus } from '../../hooks/useAudioEngine';
import styles from './DisplayScreen.module.css';

const EQ_SEQUENCES: number[][] = [
  [0.10,0.70,0.30,0.90,0.20,0.60,0.40,0.85,0.15,0.75,0.35,0.95,0.25,0.65,0.45,0.80,0.20,0.55,0.38,0.72],
  [0.50,0.20,0.80,0.15,0.65,0.40,0.90,0.25,0.70,0.35,0.85,0.10,0.60,0.45,0.75,0.30,0.88,0.18,0.62,0.42],
  [0.30,0.85,0.15,0.60,0.45,0.80,0.20,0.70,0.40,0.92,0.25,0.55,0.75,0.35,0.88,0.12,0.65,0.48,0.78,0.22],
  [0.75,0.25,0.55,0.95,0.18,0.68,0.42,0.82,0.28,0.72,0.50,0.15,0.85,0.38,0.62,0.92,0.22,0.58,0.33,0.78],
  [0.20,0.90,0.35,0.65,0.50,0.78,0.12,0.88,0.42,0.68,0.30,0.95,0.22,0.55,0.80,0.38,0.70,0.15,0.85,0.45],
];

function ScreenEQ({ active }: { active: boolean }) {
  return (
    <div className={styles.eqRow}>
      {Array.from({ length: 20 }).map((_, i) => (
        <motion.div
          key={i}
          className={styles.eqBar}
          animate={active ? { scaleY: EQ_SEQUENCES[i % EQ_SEQUENCES.length] } : { scaleY: 0.06 }}
          transition={active ? { duration: 0.6 + i * 0.05, repeat: Infinity, ease: 'linear', delay: i * 0.04 } : { duration: 0.4 }}
        />
      ))}
    </div>
  );
}

interface DisplayScreenProps {
  station: Station | null;
  status: PlaybackStatus;
}

export function DisplayScreen({ station, status }: DisplayScreenProps) {
  const showIdle = status === 'idle' && !station;
  const showError = status === 'error';

  const isPlaying = status === 'playing';

  return (
    <div className={styles.screen}>
      <div className={styles.scanlines} />
      <div className={styles.content}>
        <AnimatePresence mode="wait">
          {showIdle && (
            <motion.div
              key="idle"
              className={styles.idleState}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <span className={styles.idleTitle}>LUCKY BREAKS</span>
              <span className={styles.idleSub}>SELECT A VIBE OR PRESS SHUFFLE</span>
            </motion.div>
          )}

          {showError && (
            <motion.div
              key="error"
              className={styles.errorState}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className={styles.errorLabel}>STREAM ERROR</span>
              {station && <span className={styles.errorStation}>{station.name}</span>}
            </motion.div>
          )}

          {!showIdle && !showError && station && (
            <motion.div
              key={station.id}
              className={styles.playingState}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
            >
              <div className={styles.stationName}>{station.name}</div>
              {status === 'loading' ? (
                <motion.div
                  className={styles.loadingBar}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  ████████████ LOADING...
                </motion.div>
              ) : (
                <div className={styles.stationDesc}>
                  {station.description.length > 60
                    ? station.description.slice(0, 57) + '...'
                    : station.description}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <ScreenEQ active={isPlaying} />
    </div>
  );
}
