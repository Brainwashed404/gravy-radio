import { motion } from 'framer-motion';
import type { LoopBankEntry } from '../../hooks/useFxAudioBridge';
import { downloadWav } from '../../lib/audio/wavEncode';
import styles from './LoopBankPanel.module.css';

interface LoopBankPanelProps {
  onClose: () => void;
  loopBank: LoopBankEntry[];
  getLoopBuffer: (padId: number) => AudioBuffer | null;
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

/** The on-screen half of loop export: the APC's DEVICE button just opens this,
 *  the actual download has to happen from a real click in here. A MIDI
 *  note-on isn't a trusted user gesture as far as the browser's download
 *  gating is concerned, so triggering a save straight from the hardware
 *  button would get silently blocked. */
export function LoopBankPanel({ onClose, loopBank, getLoopBuffer }: LoopBankPanelProps) {
  const handleDownload = (padId: number, index: number) => {
    const buffer = getLoopBuffer(padId);
    if (!buffer) return;
    downloadWav(buffer, `lucky-breaks-loop-${index + 1}.wav`);
  };

  // Staggered, not all in the same tick: Chrome (and others) will silently
  // block a burst of automatic downloads past the first one or two unless
  // the site already has that permission, showing a one-time "this site
  // wants to download multiple files" prompt instead - a real browser
  // protection this can't route around, only be a good citizen about. A
  // small gap between each genuinely helps some browsers treat them as
  // separate rather than one burst; it doesn't guarantee no prompt for a
  // large bank, but there's nothing more code-side can do about that once
  // this itself is already a real click (see wavEncode.ts's own comment on
  // why the hardware SEND button can only ever open this panel, never
  // trigger a save directly).
  const handleDownloadAll = () => {
    loopBank.forEach((entry, i) => {
      setTimeout(() => handleDownload(entry.padId, i), i * 250);
    });
  };

  return (
    <>
      <motion.div
        className={styles.backdrop}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        className={styles.modal}
        initial={{ opacity: 0, y: '100%' }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      >
        <div className={styles.header}>
          <span className={styles.title}>Loop bank</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.scroll}>
          <div className={styles.hint}>
            Every loop currently playing, dry and effect-free at capture unless you had
            an effect dialled in when you recorded it. Download any of them as a WAV to
            drop into a DAW.
          </div>

          {loopBank.length === 0 ? (
            <div className={styles.empty}>No loops yet. Press a pad on the grid to start one.</div>
          ) : (
            <>
              <button className={styles.downloadAllBtn} onClick={handleDownloadAll}>
                Download all ({loopBank.length})
              </button>
              {loopBank.map((entry, i) => (
                <div key={entry.padId} className={styles.row}>
                  <span className={styles.rowLabel}>
                    Loop {i + 1}
                    <span className={styles.rowDuration}>{formatDuration(entry.durationSeconds)}</span>
                  </span>
                  <button className={styles.downloadBtn} onClick={() => handleDownload(entry.padId, i)}>
                    Download
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </motion.div>
    </>
  );
}
