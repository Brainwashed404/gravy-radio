import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { type Station } from '../../data/stations';
import { type PlaybackStatus } from '../../hooks/useAudioEngine';
import { Visualizer, type VizMode } from '../Visualizer/Visualizer';
import styles from './DisplayScreen.module.css';

const VIZ_MODES: VizMode[] = ['eq', 'wave', 'radial'];
const VIZ_LABELS: Record<VizMode, string> = { eq: 'EQ', wave: 'SCOPE', radial: 'RADIAL' };

interface DisplayScreenProps {
  station: Station | null;
  status: PlaybackStatus;
  analyser: AnalyserNode | null;
}

export function DisplayScreen({ station, status, analyser }: DisplayScreenProps) {
  const [vizMode, setVizMode] = useState<VizMode>('eq');
  const showIdle = status === 'idle' && !station;
  const showError = status === 'error';
  const isPlaying = status === 'playing';

  const cycleMode = () =>
    setVizMode((m) => VIZ_MODES[(VIZ_MODES.indexOf(m) + 1) % VIZ_MODES.length]);

  return (
    <div className={styles.screen}>
      <div className={styles.scanlines} />

      {/* Full-screen visualizer layer — shown when playing */}
      {isPlaying && station && (
        <div className={styles.vizLayer}>
          <Visualizer analyser={analyser} mode={vizMode} isActive={isPlaying} />
          <span className={styles.stationNameOverlay}>{station.name}</span>
          <button className={styles.vizToggle} onClick={cycleMode} aria-label="Cycle visualizer">
            {VIZ_LABELS[vizMode]}
          </button>
        </div>
      )}

      {/* Content area — idle / loading / error */}
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

          {!showIdle && !showError && station && !isPlaying && (
            <motion.div
              key={station.id}
              className={styles.playingState}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
            >
              <div className={styles.stationName}>{station.name}</div>
              <motion.div
                className={styles.loadingBar}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                ████████████ LOADING...
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
