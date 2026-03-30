import { motion, AnimatePresence } from 'framer-motion';
import { type Station } from '../../data/stations';
import { type PlaybackStatus } from '../../hooks/useAudioEngine';
import styles from './DisplayScreen.module.css';

const EQ_SEQUENCES = [
  ['10%','70%','30%','90%','20%','60%','40%','85%','15%','75%','35%','95%','25%','65%','45%','80%','20%','55%','38%','72%'],
  ['50%','20%','80%','15%','65%','40%','90%','25%','70%','35%','85%','10%','60%','45%','75%','30%','88%','18%','62%','42%'],
  ['30%','85%','15%','60%','45%','80%','20%','70%','40%','92%','25%','55%','75%','35%','88%','12%','65%','48%','78%','22%'],
  ['75%','25%','55%','95%','18%','68%','42%','82%','28%','72%','50%','15%','85%','38%','62%','92%','22%','58%','33%','78%'],
  ['20%','90%','35%','65%','50%','78%','12%','88%','42%','68%','30%','95%','22%','55%','80%','38%','70%','15%','85%','45%'],
];

function ScreenEQ({ active }: { active: boolean }) {
  return (
    <div className={styles.eqRow}>
      {Array.from({ length: 20 }).map((_, i) => (
        <motion.div
          key={i}
          className={styles.eqBar}
          animate={active ? { scaleY: EQ_SEQUENCES[i % EQ_SEQUENCES.length] as string[] } : { scaleY: 0.06 }}
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
      <div className={styles.screenHeader}>Tune in. Chop it up.</div>
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
