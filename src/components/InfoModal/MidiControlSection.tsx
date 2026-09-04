import { useState } from 'react';
import { ACTIONS, describeBinding } from '../../lib/midi/bindings';
import type { useMidiSurface } from '../../hooks/useMidiSurface';
import infoStyles from './InfoModal.module.css';
import styles from './MidiControlSection.module.css';

type Surface = ReturnType<typeof useMidiSurface>;

const STATUS_TEXT: Record<Surface['status'], string> = {
  unsupported: 'This browser has no Web MIDI. Try Chrome.',
  off: 'Not connected',
  requesting: 'Asking for MIDI access...',
  denied: 'MIDI access was blocked by the browser',
  waiting: 'Connected, waiting for an APC mini mk2',
  connected: 'Ready',
};

/** The full MIDI control guide, lives inside the Info modal as one of its
 *  collapsible sections rather than its own floating panel - a hardware
 *  controller is a deep-enough topic that it earns a proper guide, not a
 *  wall of reasoning-heavy prose. This is the "what does each thing do"
 *  reference; the exact note/CC numbers and rebinding live in the Advanced
 *  sub-section below it for anyone actually troubleshooting a mismatch. */
export function MidiControlSection({ surface }: { surface: Surface }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  if (surface.status === 'unsupported') {
    return <p className={infoStyles.syncDesc}>This browser doesn&apos;t support Web MIDI, so an APC mini mk2 can&apos;t connect here. Try Chrome or Edge.</p>;
  }

  const connected = surface.status === 'connected';

  return (
    <div className={styles.wrap}>
      <p className={infoStyles.syncDesc}>
        Plug in an Akai APC mini mk2 and play Lucky Breaks like an instrument: 12 genre pads,
        a 12-pad live looper, 8 effect faders and a full set of transport controls, all on the
        hardware.
      </p>

      <div className={styles.statusRow}>
        <span className={`${styles.dot} ${connected ? styles.dotLive : surface.status === 'denied' ? styles.dotError : surface.status === 'waiting' ? styles.dotWaiting : ''}`} />
        <span className={styles.statusText}>
          {STATUS_TEXT[surface.status]}
          {surface.deviceName ? `: ${surface.deviceName}` : ''}
        </span>
      </div>

      <div className={styles.btnRow}>
        {connected || surface.status === 'waiting' ? (
          <button className={styles.btn} onClick={surface.disconnect}>Disconnect</button>
        ) : (
          <button className={styles.btn} onClick={() => void surface.connect()}>Connect</button>
        )}
        {connected && (
          <>
            <button
              className={`${styles.btn} ${surface.ledsEnabled ? styles.btnOn : ''}`}
              onClick={() => surface.setLedsEnabled(!surface.ledsEnabled)}
              aria-pressed={surface.ledsEnabled}
            >
              Pad lights
            </button>
            <button
              className={styles.btn}
              onClick={() => surface.setGridOrigin(surface.gridOrigin === 'bottom-left' ? 'top-left' : 'bottom-left')}
            >
              Flip grid
            </button>
          </>
        )}
      </div>

      {connected && (
        <>
          <p className={styles.subhead}>Genres &amp; playback</p>
          <ul className={infoStyles.list}>
            <li><strong>Genre pads</strong> (bottom right): tap to shuffle to a station in that genre.</li>
            <li><strong>▲ ▼</strong>: step to the previous / next genre. <strong>◄ ►</strong>: rewind / forward.</li>
            <li><strong>VOLUME</strong>: mute/unmute the radio. <strong>PAN</strong>: mute/unmute all loops at once. <strong>SEND</strong>: open the loop bank to download your loops. <strong>DEVICE</strong>: mute/unmute all effects.</li>
            <li><strong>Soft keys</strong> (right column, top to bottom): CLIP STOP cycles pad view → visualiser → fullscreen; SOLO steps through the 12 visualiser patterns; MUTE toggles dark mode; REC ARM clears the current genre; SELECT opens the station index; DRUM toggles FAVS mode; NOTE toggles shuffle/all; STOP ALL CLIPS plays/pauses.</li>
          </ul>

          <p className={styles.subhead}>The looper (bottom left, 12 pads)</p>
          <ul className={infoStyles.list}>
            <li>Press an empty pad to start recording whatever&apos;s playing. Press it again to commit the loop, which also mutes the radio so you can actually hear what you made.</li>
            <li>Once it&apos;s a loop, every press restarts it from the top - tap it like an instrument.</li>
            <li>Hold a pad down for about a second to clear it, whether it&apos;s mid-recording (throws the take away) or already looping.</li>
            <li>Only one pad records at a time - pressing a different empty pad mid-recording moves the recording onto it instead.</li>
            <li className={infoStyles.tip}>💡 Amber pulse = waiting to record. Red pulse = recording. Solid green = looping. Dim green = loaded but silenced.</li>
          </ul>

          <p className={styles.subhead}>SHIFT</p>
          <ul className={infoStyles.list}>
            <li>Hold <strong>SHIFT</strong> + a genre pad to stay inside your FAVS.</li>
            <li>Hold <strong>SHIFT</strong>, tap an already-looping pad to silence it without clearing it, tap again to bring it back. Hold <strong>SHIFT</strong> and HOLD that pad instead to clear it outright.</li>
            <li>Hold <strong>SHIFT</strong> while moving faders 1-4: each is the volume for the loop column directly above it.</li>
            <li>Hold <strong>SHIFT</strong> while moving faders 5-8: shapes whichever pad you last pressed - 5 trims where it starts, 6 trims where it ends, 7 adds reverb, 8 bends the pitch.</li>
            <li>Hold <strong>SHIFT</strong> + <strong>DEVICE</strong>: reset every effect fader back to its default.</li>
            <li><strong>Double-tap SHIFT</strong> to latch faders 1-8 onto the loop controls without needing to keep holding it - handy for playing a pad live while riding a fader. Double-tap again to release.</li>
          </ul>

          <p className={styles.subhead}>The 8 faders</p>
          <ul className={infoStyles.list}>
            <li>Left to right: filter, phaser/flanger, stutter, beat repeat, reverb, ping-pong delay, dub delay, and feedback shared by both delays.</li>
            <li>Mute the radio (VOLUME) and these same 8 faders switch to mangling your loops instead - press a spare pad while they&apos;re playing to sample the result.</li>
          </ul>

          <button className={styles.advancedToggle} onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
            {showAdvanced ? '− Hide exact button mapping' : '+ Exact button mapping (advanced)'}
          </button>

          {showAdvanced && (
            <div className={styles.advanced}>
              <p className={styles.advancedNote}>
                Every button here can be rebound if a default doesn&apos;t match your unit: press Learn, then press the button on the controller.
              </p>
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

              <p className={styles.advancedSubhead}>Incoming</p>
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

              <div className={styles.resetBlock}>
                {confirmingReset ? (
                  <div className={styles.confirmRow}>
                    <span className={styles.confirmText}>Reset every button and fader binding to its default?</span>
                    <div className={styles.confirmBtns}>
                      <button
                        className={styles.resetBtnConfirm}
                        onClick={() => { surface.resetBindings(); setConfirmingReset(false); }}
                      >
                        Yes, reset
                      </button>
                      <button className={styles.cancelBtn} onClick={() => setConfirmingReset(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className={styles.resetBtn} onClick={() => setConfirmingReset(true)}>
                    Reset all buttons to default
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
