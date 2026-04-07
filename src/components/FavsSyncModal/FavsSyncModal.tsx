import { useState } from 'react';
import { motion } from 'framer-motion';
import styles from './FavsSyncModal.module.css';
import { generateCode, pushFavs, pullFavs } from '../../lib/favsSync';

const CODE_KEY = 'gravy-radio-sync-code';

interface FavsSyncModalProps {
  onClose: () => void;
  favourites: Set<string>;
  onLoadFavs: (ids: string[]) => void;
}

type PushStatus = 'idle' | 'pushing' | 'done' | 'error';
type PullStatus = 'idle' | 'pulling' | 'done' | 'notfound' | 'error';

export function FavsSyncModal({ onClose, favourites, onLoadFavs }: FavsSyncModalProps) {
  const [savedCode, setSavedCode] = useState<string>(() => localStorage.getItem(CODE_KEY) ?? '');
  const [pushStatus, setPushStatus] = useState<PushStatus>('idle');
  const [pullCode, setPullCode] = useState('');
  const [pullStatus, setPullStatus] = useState<PullStatus>('idle');
  const [copied, setCopied] = useState(false);

  const handlePush = async () => {
    if (favourites.size === 0) return;
    setPushStatus('pushing');
    try {
      const code = generateCode();
      await pushFavs(code, [...favourites]);
      localStorage.setItem(CODE_KEY, code);
      setSavedCode(code);
      setPushStatus('done');
    } catch {
      setPushStatus('error');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(savedCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePull = async () => {
    const code = pullCode.trim().toUpperCase();
    if (code.length < 6) return;
    setPullStatus('pulling');
    try {
      const ids = await pullFavs(code);
      onLoadFavs(ids);
      setPullStatus('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setPullStatus(msg.includes('not found') ? 'notfound' : 'error');
    }
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
          <span className={styles.title}>SYNC FAVS</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.scroll}>
          {/* Push */}
          <div className={styles.section}>
            <p className={styles.sectionLabel}>Save to cloud</p>
            <p className={styles.desc}>
              Generate a code and enter it on your other device to load your FAVS.
            </p>
            <button
              className={styles.actionBtn}
              onClick={handlePush}
              disabled={pushStatus === 'pushing' || favourites.size === 0}
            >
              {pushStatus === 'pushing' ? 'Saving...' : savedCode ? 'Refresh Code' : 'Generate Code'}
            </button>
            {favourites.size === 0 && (
              <p className={styles.hint}>Add some stations to FAVS first.</p>
            )}
            {savedCode && (
              <div className={styles.codeRow}>
                <span className={styles.code}>{savedCode}</span>
                <button className={styles.copyBtn} onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
            {pushStatus === 'done' && (
              <p className={styles.success}>Saved. Enter this code on your other device.</p>
            )}
            {pushStatus === 'error' && (
              <p className={styles.error}>Something went wrong. Check your connection and try again.</p>
            )}
          </div>

          {/* Pull */}
          <div className={styles.section}>
            <p className={styles.sectionLabel}>Load from another device</p>
            <p className={styles.desc}>
              Enter the sync code from your other device to load those FAVS here.
            </p>
            <div className={styles.inputRow}>
              <input
                className={styles.codeInput}
                value={pullCode}
                onChange={(e) => setPullCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))}
                placeholder="XXXXXX"
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                className={styles.actionBtn}
                onClick={handlePull}
                disabled={pullStatus === 'pulling' || pullCode.trim().length < 6}
              >
                {pullStatus === 'pulling' ? 'Loading...' : 'Load'}
              </button>
            </div>
            {pullStatus === 'done' && (
              <p className={styles.success}>FAVS loaded successfully.</p>
            )}
            {pullStatus === 'notfound' && (
              <p className={styles.error}>Code not found. Check the code and try again.</p>
            )}
            {pullStatus === 'error' && (
              <p className={styles.error}>Something went wrong. Check your connection and try again.</p>
            )}
          </div>

          <p className={styles.note}>
            Codes expire after 30 days. Your FAVS are stored locally on each device and we do not track your listening data.
          </p>
        </div>
      </motion.div>
    </>
  );
}
