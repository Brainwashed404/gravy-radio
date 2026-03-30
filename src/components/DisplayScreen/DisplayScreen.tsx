import { motion, AnimatePresence } from 'framer-motion';
import { type Station } from '../../data/stations';
import { type PlaybackStatus } from '../../hooks/useAudioEngine';
import styles from './DisplayScreen.module.css';

function ScreenEQ({ bars }: { bars: number[] }) {
  return (
    <div className={styles.eqRow}>
      {bars.map((v, i) => (
        <div
          key={i}
          className={styles.eqBar}
          style={{ height: `${Math.max(3, v * 100)}%` }}
        />
      ))}
    </div>
  );
}

interface DisplayScreenProps {
  station: Station | null;
  status: PlaybackStatus;
  eqBars: number[];
}

export function DisplayScreen({ station, status, eqBars }: DisplayScreenProps) {
  const showIdle = status === 'idle' && !station;
  const showError = status === 'error';

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
      <ScreenEQ bars={eqBars} />
    </div>
  );
}
