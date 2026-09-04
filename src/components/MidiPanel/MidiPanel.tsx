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
            Only the bottom 3 rows are in use, the 5 above are blank for now.
            Bottom right is a 4-across, 3-tall block of the <b>12 genres</b>, each
            its own colour; bottom left mirrors it exactly with <b>12 loopers</b>,
            same shape. Press a loop pad to start recording whatever&apos;s
            playing (baked in with whatever effects are live at that moment),
            press again to commit it as a loop. From then on the pad&apos;s a
            play button: every press restarts it from the beginning and it
            keeps looping from there, so tapping it repeatedly is an
            instrument in its own right. Holding the same pad down for over a
            second clears it instead. Pulsing amber means a pad is waiting to
            connect before it can record; pulsing red means it&apos;s
            recording; solid green means it&apos;s looping and audible, dim
            green means it&apos;s loaded but stopped. Overall volume and
            muting are the column fader&apos;s job (below), not the
            pad&apos;s. Hold <b>SHIFT</b> while pressing a genre pad to stay
            inside your favs; hold it while pressing an already-looping pad
            to toggle it silent and back without clearing it (keep SHIFT down
            and keep pressing the same pad to flip it back and forth, resuming
            always restarts it from the top); hold it while moving
            faders 1-4 for a second bank instead of the fx below - each of
            those four faders is the volume for the loop column directly
            above it (fader 1 is the leftmost column, and so on), whatever
            pad in that column happens to be looping. Faders 5-8 aren&apos;t
            used for loops. If the rows come out upside down, hit Flip grid.
          </div>

          <div className={styles.hint}>
            Faders 1 to 7 each drive a live effect (filter, phaser/flanger,
            stutter, beat repeat, reverb, ping pong delay, dub delay), left to
            right; fader 8 is the feedback amount for both delays at once, not
            a separate effect, and already has a sensible amount of repeat
            dialled in even if you never touch it. Phaser/flanger shares fader
            2 the same way filter works: bypass at dead centre, phaser sweeps
            in below it, flanger above. Stutter and beat repeat are two
            different takes on the same idea: stutter freezes whatever
            it&apos;s playing the instant the fader leaves 0 and loops that
            one frozen bit, barely up is a slow repeat, maxed is a robotic
            buzz; beat repeat keeps recording underneath and re-slices from
            the tail of that instead, so it retriggers rather than staying
            frozen, and moving the fader mid-roll is meant to be played with.
            Ping pong delay&apos;s own fader also sets the repeat spacing,
            barely up gives long, spaced-out repeats, pushed
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
            fast, or muting the radio or the fx (below), doesn&apos;t cut the
            repeats already ringing, it just stops new ones
            starting, so what&apos;s already going fades out on its own.
          </div>

          <div className={styles.hint}>
            Round buttons above the faders: <b>VOLUME</b> mutes/unmutes the
            live radio outright, loops keep playing regardless. <b>PAN</b>
            mutes/unmutes every loop at once via one shared control, without
            touching any individual loop&apos;s own volume. <b>DEVICE</b>
            mutes/unmutes all fx: drops back to plain, unprocessed radio
            without losing where any fx fader is actually set, they&apos;re
            still exactly there once it&apos;s switched off again (loops
            aren&apos;t affected either way, they never route through fx).
            Hold <b>SHIFT</b> while pressing DEVICE for a full reset instead,
            every fx fader back to its own bypass point.
            <b> SEND</b> opens the loop bank panel on screen to download any
            of your loops as a WAV, press it again to close it. <b>▲/▼</b>
            step to the previous/next genre, <b>◄/►</b>
            rewind/forward. Soft keys (the column to the right of the grid):
            <b> CLIP STOP</b> cycles pad view / in-app visualiser / fullscreen
            visualiser, <b>SOLO</b> steps through the 12 visualiser patterns,
            <b> MUTE</b> dark mode, <b>REC ARM</b> clear genre, <b>SELECT</b>
            station index (press again to close it), <b>DRUM</b> favs mode,
            <b> NOTE</b> shuffle/all, <b>STOP ALL CLIPS</b> play/pause. Info no
            longer has a hardware button, on-screen only from here (same as
            hearting a station already was).
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
