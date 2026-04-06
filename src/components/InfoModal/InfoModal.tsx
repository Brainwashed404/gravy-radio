import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './InfoModal.module.css';

interface InfoModalProps {
  onClose: () => void;
}

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

const sections: Section[] = [
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
      <ul className={styles.list}>
        <li><strong>Save</strong>: Press the <span style={{color: 'var(--color-orange)'}}>♥</span> on the player or in the index to save a station locally to your device.</li>
        <li><strong>FAVS Mode</strong>: Toggle on to browse exclusively through your saved stations. FWD and RWD scroll through them alphabetically. Press FAVS again to exit.</li>
        <li><strong>Shuffle FAVS</strong>: Hit SHUFFLE while in FAVS mode to randomly jump between your saved stations.</li>
        <li><strong>Filter FAVS by genre</strong>: Press a genre pad while in FAVS mode to navigate only your saved stations within that genre.</li>
      </ul>
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

export function InfoModal({ onClose }: InfoModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
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
          <span className={styles.title}>TUNE IN. CHOP UP.</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.scroll}>
          {/* Intro:always visible */}
          <div className={styles.intro}>
            <p>Lucky Breaks is a radio player built for beatmakers, crate diggers, and sonic explorers.</p>
            <p>Stream hundreds of live global stations, shuffle by genre, and sample serendipitously straight into your groovebox.</p>
            <div className={styles.social}>
              <a href="https://buymeacoffee.com/luckybreaks" target="_blank" rel="noopener noreferrer" className={`${styles.socialBtn} ${styles.socialBtnCoffee}`}>☕ Buy us a coffee</a>
              <a href="https://www.instagram.com/luckybreaks.xyz" target="_blank" rel="noopener noreferrer" className={`${styles.socialBtn} ${styles.socialBtnIg}`}>📷 Follow on Instagram</a>
            </div>
          </div>

          {/* Collapsible sections */}
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
