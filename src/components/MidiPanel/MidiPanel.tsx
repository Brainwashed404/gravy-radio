import { useState } from 'react';
import { ACTIONS, describeBinding } from '../../lib/midi/bindings';
import type { useMidiSurface } from '../../hooks/useMidiSurface';
import styles from './MidiPanel.module.css';

type Surface = ReturnType<typeof useMidiSurface>;

const STATUS_TEXT: Record<Surface['status'], string> = {
  unsupported: 'This browser has no Web MIDI. Try Chrome.',
  off: 'Not connected',
  requesting: 'Asking for MIDI access...',
  denied: 'MIDI access was blocked by the browser',
  waiting: 'Connected, waiting for an APC mini mk2',
  connected: 'Ready',
};

export function MidiPanel({ surface }: { surface: Surface }) {
  const [open, setOpen] = useState(false);

  if (surface.status === 'unsupported') return null;

  const dotClass =
    surface.status === 'connected' ? styles.dotLive
    : surface.status === 'denied' ? styles.dotError
    : surface.status === 'waiting' ? styles.dotWaiting
    : '';

  if (!open) {
    return (
      <button className={styles.chip} onClick={() => setOpen(true)} aria-label="MIDI controller settings">
        <span className={`${styles.dot} ${dotClass}`} />
        MIDI
      </button>
    );
  }

  const connected = surface.status === 'connected';

  return (
    <div className={styles.panel} role="dialog" aria-label="MIDI controller settings">
      <div className={styles.head}>
        <span className={styles.title}>MIDI CONTROL</span>
        <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close">×</button>
      </div>

      <div className={styles.status}>
        {STATUS_TEXT[surface.status]}
        {surface.deviceName ? `: ${surface.deviceName}` : ''}
      </div>

      <div className={styles.row}>
        {connected || surface.status === 'waiting' ? (
          <button className={styles.btn} onClick={surface.disconnect}>Disconnect</button>
        ) : (
          <button className={styles.btn} onClick={() => void surface.connect()}>Connect</button>
        )}
        <button
          className={`${styles.btn} ${surface.ledsEnabled ? styles.btnOn : ''}`}
          onClick={() => surface.setLedsEnabled(!surface.ledsEnabled)}
          aria-pressed={surface.ledsEnabled}
        >
          Pad lights
        </button>
      </div>

      {connected && (
        <>
          <div className={styles.row}>
            <button
              className={styles.btn}
              onClick={() => surface.setGridOrigin(surface.gridOrigin === 'bottom-left' ? 'top-left' : 'bottom-left')}
            >
              Flip grid
            </button>
            <button className={styles.btn} onClick={surface.resetBindings}>Reset buttons</button>
          </div>

          <div className={styles.hint}>
            Top two rows are the <b>12 genres</b>, the middle block is <b>A to Z</b> station jump, the bottom
            two rows switch <b>visualiser modes</b>. Hold <b>SHIFT</b> with a genre pad to stay inside your favs.
            If the rows come out upside down, hit Flip grid.
          </div>

          <div className={styles.sectionLabel}>Buttons</div>
          {ACTIONS.map((action) => (
            <div key={action.id} className={styles.bindRow}>
              <span>{action.label}</span>
              <span className={styles.bindWhere}>{describeBinding(surface.bindings[action.id])}</span>
              <button
                className={`${styles.learnBtn} ${surface.learning === action.id ? styles.learnActive : ''}`}
                onClick={() => surface.setLearning(surface.learning === action.id ? null : action.id)}
              >
                {surface.learning === action.id ? 'Press it' : 'Learn'}
              </button>
            </div>
          ))}

          <div className={styles.sectionLabel}>Incoming</div>
          <div className={styles.monitor}>
            {surface.monitor.length === 0 ? (
              <div className={styles.monitorEmpty}>Press something on the controller</div>
            ) : (
              surface.monitor.map((m) => (
                <div key={m.id}>
                  {m.label} <span className={styles.monitorDetail}>{m.detail}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
