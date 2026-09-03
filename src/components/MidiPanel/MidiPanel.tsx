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
            Top four rows are <b>A to Z</b> station jump. Bottom right is a 4-across,
            3-tall block of the <b>12 genres</b>, each its own colour; bottom left has
            the matching <b>visualiser mode</b> for each genre, same colour, in its own
            3-across, 4-tall block with a spare column between the two.
            Tap <b>SHIFT</b> to play/pause; hold it while pressing a genre pad to stay inside
            your favs instead. If the rows come out upside down (letters at the bottom,
            genres up top), hit Flip grid.
          </div>

          <div className={styles.hint}>
            Faders 1 to 7 each drive a live effect (filter, phaser/flanger,
            stutter, gate, reverb, ping pong delay, dub delay), left to right;
            fader 8 is the feedback amount for both delays at once, not a
            separate effect, and already has a sensible amount of repeat
            dialled in even if you never touch it. Phaser/flanger shares fader
            2 the same way filter works: bypass at dead centre, phaser sweeps
            in below it, flanger above. Stutter freezes and loops whatever
            it&apos;s playing the instant the fader leaves 0, barely up is a
            slow repeat, maxed is a robotic buzz. Gate only lets the loudest
            peaks through as the fader climbs, barely up mostly leaves the
            signal alone. Ping pong delay&apos;s own fader also sets the
            repeat spacing, barely up gives long, spaced-out repeats, pushed
            further up they get closer together. Touching a fader for
            the first time switches playback onto a second, effects-capable
            stream of the current station; if that station won&apos;t
            cooperate it falls back to playing normally with no effects,
            rather than going silent. Every fader resets to its own bypass
            point on a station change (0, except filter and phaser/flanger
            which rest at their centre), so you always start on a clean mix:
            the physical faders obviously don&apos;t move to match, so one
            left up will disagree with the app until it&apos;s touched again.
            Dub delay and ping pong delay are post-fader: pulling either down
            fast, or hitting SHIFT to pause, doesn&apos;t cut the repeats
            already ringing, it just stops new ones
            starting, so what&apos;s already going fades out on its own.
          </div>

          <div className={styles.hint}>
            Round buttons below the faders: <b>VOLUME</b> steps through three
            stages, pad view, in-app visualiser, then fullscreen visualiser,
            before landing back on the pad view&apos;s default screen; <b> PAN</b>
            dark mode, <b>SEND</b> favs mode, <b>DEVICE</b> shuffle/all,
            <b> ▲/▼</b> step to the next/previous genre, <b>◄/►</b> rewind/forward.
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
