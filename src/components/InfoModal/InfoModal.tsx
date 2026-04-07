import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './InfoModal.module.css';
import { generateCode, pushFavs, pullFavs } from '../../lib/favsSync';

const CODE_KEY = 'gravy-radio-sync-code';

interface InfoModalProps {
  onClose: () => void;
  favourites: Set<string>;
  onLoadFavs: (ids: string[]) => void;
}

type PushStatus = 'idle' | 'pushing' | 'done' | 'error';
type PullStatus = 'idle' | 'pulling' | 'done' | 'notfound' | 'error';

function FavsSyncPanel({ favourites, onLoadFavs }: { favourites: Set<string>; onLoadFavs: (ids: string[]) => void }) {
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
    <div className={styles.syncPanel}>
      <p className={styles.syncTitle}>Sync across devices</p>

      <div className={styles.syncBlock}>
        <p className={styles.syncDesc}>Save your FAVS to the cloud and load them on another device.</p>
        <button
          className={styles.syncBtn}
          onClick={handlePush}
          disabled={pushStatus === 'pushing' || favourites.size === 0}
        >
          {pushStatus === 'pushing' ? 'Saving...' : savedCode ? 'Refresh Code' : 'Generate Code'}
        </button>
        {favourites.size === 0 && <p className={styles.syncHint}>Add some stations to FAVS first.</p>}
        {savedCode && (
          <div className={styles.codeRow}>
            <span className={styles.code}>{savedCode}</span>
            <button className={styles.copyBtn} onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>
        )}
        {pushStatus === 'done' && <p className={styles.syncSuccess}>Saved. Enter this code on your other device.</p>}
        {pushStatus === 'error' && <p className={styles.syncError}>Something went wrong. Try again.</p>}
      </div>

      <div className={styles.syncBlock}>
        <p className={styles.syncDesc}>Enter a sync code from another device to load those FAVS here.</p>
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
            className={styles.syncBtn}
            onClick={handlePull}
            disabled={pullStatus === 'pulling' || pullCode.trim().length < 6}
          >
            {pullStatus === 'pulling' ? 'Loading...' : 'Load'}
          </button>
        </div>
        {pullStatus === 'done' && <p className={styles.syncSuccess}>FAVS loaded successfully.</p>}
        {pullStatus === 'notfound' && <p className={styles.syncError}>Code not found. Check and try again.</p>}
        {pullStatus === 'error' && <p className={styles.syncError}>Something went wrong. Try again.</p>}
      </div>

      <p className={styles.syncNote}>Codes expire after 30 days. Your FAVS are stored locally and we never track your listening data.</p>
    </div>
  );
}

export function InfoModal({ onClose, favourites, onLoadFavs }: InfoModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sections = [
    {
      id: 'controls',
      title: '🎛️ Main Controls',
      content: (
        <ul className={styles.list}>
          <li><strong>Genre Pads</strong>: Tap any pad to instantly shuffle live stations within that category.</li>
          <li><strong>ALL</strong>: Appears when a genre or FAVS mode is active. Tap to clear and return to open selection.</li>
          <li><strong>SHUFFLE</strong>: Pick a completely random station from the entire global library.</li>
          <li><strong>PLAY / PAUSE</strong>: Start or stop the current stream.</li>
          <li><strong>FWD / RWD</strong>: Skip ahead to a brand-new station, or step back through your session history.</li>
          <li><strong>INDEX</strong>: Open the full station directory. Search by name, filter by genre, or tap any station to tune in directly. Press arrows next to station names to visit their website.</li>
          <li><strong>Night Mode</strong>: Tap the moon icon to switch to a dark midnight palette.</li>
          <li><strong>Scrolling Ticker</strong>: Tap the station name on the main screen for a full-screen display. Tap it again to stop.</li>
          <li className={styles.tip}>💡 <strong>Pro Tip:</strong> Save Lucky Breaks as a web app on your desktop, tablet, or smartphone home screen for the ultimate experience.</li>
        </ul>
      ),
    },
    {
      id: 'favs',
      title: '🧡 Favourites',
      content: (
        <>
          <ul className={styles.list}>
            <li><strong>Save</strong>: Press the <span style={{color: 'var(--color-orange)'}}>♥</span> on the player or in the index to save a station locally to your device.</li>
            <li><strong>FAVS Mode</strong>: Toggle on to browse exclusively through your saved stations. FWD and RWD scroll through them alphabetically. Press FAVS again to exit.</li>
            <li><strong>Shuffle FAVS</strong>: Hit SHUFFLE while in FAVS mode to randomly jump between your saved stations.</li>
            <li><strong>Filter FAVS by genre</strong>: Press a genre pad while in FAVS mode to navigate only your saved stations within that genre.</li>
          </ul>
          <FavsSyncPanel favourites={favourites} onLoadFavs={onLoadFavs} />
        </>
      ),
    },
    {
      id: 'submit',
      title: '📻 Submit a Station',
      content: (
        <div className={styles.disclaimer}>
          <p>Know a station that belongs here? We are always looking to expand the library with quality streams from around the world.</p>
          <p>Send us the station name, stream URL, genre, and a short description. We review every submission and add stations that fit the vibe.</p>
          <p>Email us at <a href="mailto:digging@luckybreaks.xyz" className={styles.link}>digging@luckybreaks.xyz</a> or DM us on Instagram at <a href="https://www.instagram.com/luckybreaks.xyz" target="_blank" rel="noopener noreferrer" className={styles.link}>@luckybreaks.xyz</a>.</p>
        </div>
      ),
    },
    {
      id: 'disclaimer',
      title: '⚖️ Disclaimer',
      content: (
        <div className={styles.disclaimer}>
          <p>Lucky Breaks is a free aggregator and directory of third-party public radio streams. We do not host, broadcast, or claim ownership of any audio content. All rights belong strictly to their respective creators and broadcasters.</p>
          <p>While Lucky Breaks is built for musical discovery, sampling is done entirely at your own risk. We do not authorise copyright infringement and cannot grant licences or permissions for any broadcast material. You are solely responsible for clearing your own samples and ensuring you have the appropriate legal rights before using any audio in your commercial work.</p>
          <p>Because these are live stations, we do not control what is broadcasted and cannot guarantee stream uptime.</p>
          <p><strong>Privacy:</strong> Your Favourites list is stored locally on your device. We do not track or store your personal listening data.</p>
          <p><strong>Notice and Takedown:</strong> If you are a station owner or rights holder and want your stream removed, please message us at <a href="mailto:digging@luckybreaks.xyz" className={styles.link}>digging@luckybreaks.xyz</a>. We will process removal requests promptly.</p>
          <p className={styles.legal}>© 2026 LuckyBreaks.xyz, a project created by Jotter Media Limited.<br/>Company No. 16824603 · Registered in England and Wales<br/>Hoxton Mix, 3rd Floor, 86–90 Paul Street, London EC2A 4NE</p>
          <p><a href="https://www.jotter.media/lucky-breaks-tc" target="_blank" rel="noopener noreferrer" className={styles.link}>Terms of Service and Privacy Policy</a></p>
        </div>
      ),
    },
  ];

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
          <span className={styles.title}>TUNE IN. CHOP UP.</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.scroll}>
          <div className={styles.intro}>
            <p>Lucky Breaks is a radio player built for beatmakers, crate diggers, and sonic explorers.</p>
            <p>Stream hundreds of live global stations, shuffle by genre, and sample serendipitously straight into your groovebox.</p>
            <div className={styles.social}>
              <a href="https://buymeacoffee.com/luckybreaks" target="_blank" rel="noopener noreferrer" className={`${styles.socialBtn} ${styles.socialBtnCoffee}`}>☕ Buy us a coffee</a>
              <a href="https://www.instagram.com/luckybreaks.xyz" target="_blank" rel="noopener noreferrer" className={`${styles.socialBtn} ${styles.socialBtnIg}`}>📷 Follow on Instagram</a>
            </div>
          </div>

          {sections.map((section) => (
            <div key={section.id} className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggle(section.id)}
                aria-expanded={expanded.has(section.id)}
              >
                <span>{section.title}</span>
                <span className={styles.toggle}>{expanded.has(section.id) ? '−' : '+'}</span>
              </button>
              <AnimatePresence initial={false}>
                {expanded.has(section.id) && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeInOut' }}
                    className={styles.sectionBody}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className={styles.sectionContent}>
                      {section.content}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </motion.div>
    </>
  );
}
