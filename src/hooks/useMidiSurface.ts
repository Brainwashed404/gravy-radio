import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUTTON_BLINK,
  BUTTON_OFF,
  BUTTON_ON,
  BUTTON_STATUS,
  COLOUR,
  GENRE_PALETTE,
  GRID_SIZE,
  INTRODUCTION_MESSAGE,
  NORMAL_MODE_MESSAGE,
  PAD_DIM,
  PAD_PULSE,
  PAD_SOLID,
  SHIFT_NOTE,
  TRACK_FADER_CCS,
  type GridOrigin,
  isTargetPort,
  noteToVisual,
  visualToNote,
} from '../lib/midi/apcMiniMk2';
import { PAD_LAYOUT } from '../lib/midi/layout';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  type Binding,
  type MidiActionId,
  loadBindings,
  saveBindings,
} from '../lib/midi/bindings';
import type { LooperStatus } from './useFxAudioBridge';

export type MidiStatus =
  | 'unsupported'  // browser has no Web MIDI
  | 'off'          // not connected, user has not opted in
  | 'requesting'
  | 'denied'
  | 'waiting'      // permission granted, controller not plugged in
  | 'connected';

export interface MidiHandlers {
  onGenre: (index: number, shift: boolean) => void;
  onAction: (id: MidiActionId) => void;
  /** Any CC-bound control: the master fader (volume) and the 8 per-effect faders
   *  all arrive here, keyed by which action's binding matched. */
  onFader: (id: MidiActionId, value: number) => void;
  /** One of the 8 track faders, moved while SHIFT is held - the per-loop
   *  volume bank. slotIndex is 0-7, physical fader position, independent of
   *  the rebindable fx actions above (see bindings.ts). */
  onLoopFader: (slotIndex: number, value: number) => void;
  /** A looper pad pressed down, and whether SHIFT was held for it. What it
   *  actually does depends on the pad's own status in
   *  MidiSurfaceState.loopStatuses AND shiftHeld - see useFxAudioBridge's
   *  looperPadPress for the full breakdown of all five cases. Idle/arming
   *  act immediately (or ignore it); everything else defers part or all of
   *  what happens to a hold timer, resolved on release - see
   *  onLooperPadRelease. */
  onLooperPadPress: (padId: number, shiftHeld: boolean) => void;
  /** A looper pad released - resolves whatever the press above deferred (a
   *  tap if this fires before the hold did, a no-op if the hold already
   *  won). Fires regardless of whether the ORIGINAL press was SHIFT-held;
   *  looperPadPress already baked that into what it armed. */
  onLooperPadRelease: (padId: number) => void;
  /** SHIFT + DEVICE: a full reset, every fx fader back to its own rest
   *  value, instead of DEVICE's plain mute/unmute-fx toggle. */
  onResetFx: () => void;
  /** SHIFT + whichever of ▲▼◄► sits directly above faders 5-8, instead of
   *  that button's plain genre-nav/rewind/forward action: resets just THAT
   *  fader's own loop macro (start trim, end trim, reverb, pitch) back to
   *  its own rest value, for whichever pad is currently selected - see
   *  useFxAudioBridge's resetSelectedLoopMacro. */
  onResetLoopMacro: (which: 'start' | 'end' | 'reverb' | 'pitch') => void;
}

export interface MidiSurfaceState {
  activeGenreIndex: number | null;
  loading: boolean;
  error: boolean;
  playing: boolean;
  favsMode: boolean;
  shuffleMode: boolean;
  dark: boolean;
  loopStatuses: ReadonlyMap<number, LooperStatus>;
  /** Whether each currently-looping pad is actually making sound (missing
   *  entry = playing, the default whenever a loop is committed or
   *  retriggered) - see useFxAudioBridge's stopLoopPad. */
  loopPlaying: ReadonlyMap<number, boolean>;
  loopsMuted: boolean;
  radioMuted: boolean;
  fxMuted: boolean;
  indexOpen: boolean;
  loopBankOpen: boolean;
  /** Which of the three CLIP STOP stages the screen is currently on - also
   *  drives SOLO's LED, since a visualiser pattern only means anything while
   *  one is actually showing. */
  screenStage: 'pad' | 'appViz' | 'fullscreen';
}

export interface MonitorEntry {
  id: number;
  label: string;
  detail: string;
}

const ENABLED_KEY = 'lucky-breaks-midi-enabled';
const ORIGIN_KEY = 'lucky-breaks-midi-grid-origin';
const LEDS_KEY = 'lucky-breaks-midi-leds';

/** Two SHIFT presses within this long count as a double-tap (see
 *  fadersLatchedRef) rather than two unrelated taps. */
const DOUBLE_TAP_WINDOW_MS = 400;

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

/** [statusByte, velocity] for one lamp. */
type Lamp = [number, number];

export function useMidiSurface(handlers: MidiHandlers, state: MidiSurfaceState) {
  const [status, setStatus] = useState<MidiStatus>(
    typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'off' : 'unsupported',
  );
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<MonitorEntry[]>([]);
  const [bindings, setBindings] = useState(loadBindings);
  const [learning, setLearning] = useState<MidiActionId | null>(null);
  const [gridOrigin, setGridOriginState] = useState<GridOrigin>(
    () => (readFlag(ORIGIN_KEY, true) ? 'bottom-left' : 'top-left'),
  );
  const [ledsEnabled, setLedsEnabledState] = useState(() => readFlag(LEDS_KEY, true));
  const [shiftDown, setShiftDown] = useState(false);
  /** Double-tap SHIFT to latch faders 1-8 onto the loop bank (column volume
   *  / selected-pad macros) persistently, independent of whether SHIFT is
   *  still physically held - so you can double-tap, let go, and freely
   *  alternate between plain pad presses (retrigger) and moving those
   *  faders, rather than needing SHIFT held for the fader AND released for
   *  the pad at the same time. Tap it again to unlatch. Everything else
   *  SHIFT does (favs, the pad toggle/hold-clear gesture, DEVICE's reset) is
   *  untouched - still needs an actual physical hold, exactly as before;
   *  this only ever affects which bank the faders are reading from. */
  const [fadersLatched, setFadersLatched] = useState(false);
  const fadersLatchedRef = useRef(false);
  // Drives the recording pad's own hard pulse ourselves rather than the
  // hardware's own PAD_PULSE animation, same reasoning as everything else
  // that pulses on this surface: an exact, tunable rate rather than whatever
  // the device's fixed animation tempo happens to be.
  const [pulsePhase, setPulsePhase] = useState(false);

  const accessRef = useRef<MIDIAccess | null>(null);
  const inputRef = useRef<MIDIInput | null>(null);
  const outputRef = useRef<MIDIOutput | null>(null);
  /** Last value written to each note, so we only send what actually changed. */
  const lampShadowRef = useRef<Map<number, Lamp>>(new Map());
  const monitorIdRef = useRef(0);

  // Refs so the MIDI listener never needs re-attaching mid session
  const handlersRef = useRef(handlers);
  const bindingsRef = useRef(bindings);
  const learningRef = useRef(learning);
  const gridOriginRef = useRef(gridOrigin);
  const shiftRef = useRef(shiftDown);
  handlersRef.current = handlers;
  bindingsRef.current = bindings;
  learningRef.current = learning;
  gridOriginRef.current = gridOrigin;
  shiftRef.current = shiftDown;
  fadersLatchedRef.current = fadersLatched;
  /** Timestamp of the last SHIFT press, for double-tap detection - see
   *  fadersLatchedRef above. */
  const shiftLastPressAtRef = useRef(0);

  const pushMonitor = useCallback((label: string, detail: string) => {
    const id = monitorIdRef.current++;
    setMonitor((prev) => [{ id, label, detail }, ...prev].slice(0, 12));
  }, []);

  // ─── Output ────────────────────────────────────────────────────────────────
  // Every send re-checks the port name. Belt and braces: an output we did not
  // explicitly allowlist must never receive a byte from this app.
  const send = useCallback((bytes: number[]) => {
    const out = outputRef.current;
    if (!out || !isTargetPort(out.name)) return;
    try { out.send(bytes); } catch {}
  }, []);

  const blankSurface = useCallback(() => {
    for (const [note] of lampShadowRef.current) {
      send([BUTTON_STATUS, note, 0]);
    }
    lampShadowRef.current.clear();
  }, [send]);

  // ─── Incoming messages ─────────────────────────────────────────────────────
  const handleMessage = useCallback((event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 2) return;
    const kind = data[0] & 0xf0;
    const channel = (data[0] & 0x0f) + 1;
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;

    const isNoteOn = kind === 0x90 && d2 > 0;
    const isNoteOff = kind === 0x80 || (kind === 0x90 && d2 === 0);
    const isCC = kind === 0xb0;

    if (isNoteOn) pushMonitor(`Note ${d1}`, `on, vel ${d2}, ch ${channel}`);
    else if (isCC) pushMonitor(`CC ${d1}`, `value ${d2}, ch ${channel}`);

    // Learn mode swallows the message rather than acting on it
    const learningFor = learningRef.current;
    if (learningFor && (isNoteOn || isCC)) {
      const meta = ACTIONS.find((a) => a.id === learningFor);
      const wantsFader = meta?.control === 'fader';
      if (wantsFader && !isCC) return;
      if (!wantsFader && !isNoteOn) return;
      const captured: Binding = isCC ? { kind: 'cc', cc: d1 } : { kind: 'note', note: d1 };
      setBindings((prev) => {
        const next = { ...prev, [learningFor]: captured };
        saveBindings(next);
        return next;
      });
      setLearning(null);
      return;
    }

    // SHIFT is a pure modifier now: a single tap fires nothing on its own,
    // it just changes what a genre pad (favs), a looper pad (toggle/hold-
    // clear) or DEVICE (reset) does while it's held. A DOUBLE tap is the one
    // exception: it toggles fadersLatchedRef instead of doing nothing,
    // independent of the held/momentary state tracked below - see its own
    // comment.
    if (d1 === SHIFT_NOTE && isNoteOn) {
      const now = Date.now();
      if (now - shiftLastPressAtRef.current < DOUBLE_TAP_WINDOW_MS) {
        setFadersLatched((v) => !v);
        shiftLastPressAtRef.current = 0; // don't let a third quick press chain into another toggle
      } else {
        shiftLastPressAtRef.current = now;
      }
    }
    if (d1 === SHIFT_NOTE && (isNoteOn || isNoteOff)) {
      setShiftDown(isNoteOn);
      return;
    }

    if (isCC) {
      // While SHIFT is held, OR while double-tap has latched it (see
      // fadersLatchedRef), the 8 track faders (not the master fader) become
      // a second bank: per-loop volume instead of their usual fx action.
      // Physical fader position, not the rebindable action list - Learn mode
      // remapping an fx effect to a different fader doesn't move this.
      if (shiftRef.current || fadersLatchedRef.current) {
        const faderSlot = TRACK_FADER_CCS.indexOf(d1 as typeof TRACK_FADER_CCS[number]);
        if (faderSlot !== -1) {
          handlersRef.current.onLoopFader(faderSlot, d2 / 127);
          return;
        }
      }
      // Generic over every cc-bound action: the master fader and the 8 fx faders
      // all resolve here rather than each needing their own hardcoded branch.
      for (const [id, binding] of Object.entries(bindingsRef.current)) {
        if (binding.kind === 'cc' && binding.cc === d1) {
          handlersRef.current.onFader(id as MidiActionId, d2 / 127);
          return;
        }
      }
      return;
    }

    // Looper pads care about release too (hold-to-clear vs tap-to-toggle on
    // an already-looping pad - see useFxAudioBridge's looperPadPress/Release).
    // Every other grid pad and every bound button only ever act on press.
    if (isNoteOff) {
      const visual = noteToVisual(d1, gridOriginRef.current);
      const slot = visual !== null ? PAD_LAYOUT[visual] : null;
      if (slot?.kind === 'looper') handlersRef.current.onLooperPadRelease(slot.padId);
      return;
    }

    if (!isNoteOn) return;

    // Grid pads first, then the bound buttons
    const visual = noteToVisual(d1, gridOriginRef.current);
    if (visual !== null) {
      const slot = PAD_LAYOUT[visual];
      if (slot.kind === 'genre') handlersRef.current.onGenre(slot.index, shiftRef.current);
      // shiftRef.current goes straight through - useFxAudioBridge's
      // looperPadPress decides what SHIFT actually means per the pad's own
      // status, this layer doesn't need its own branching for it any more.
      else if (slot.kind === 'looper') handlersRef.current.onLooperPadPress(slot.padId, shiftRef.current);
      return;
    }

    // SHIFT + DEVICE (muteFx's own binding) resets every fx fader instead
    // of DEVICE's plain mute/unmute toggle - checked ahead of the generic
    // button loop below since it's the same physical note either way.
    if (shiftRef.current) {
      const muteFxBinding = bindingsRef.current.muteFx;
      if (muteFxBinding.kind === 'note' && muteFxBinding.note === d1) {
        handlersRef.current.onResetFx();
        return;
      }
      // SHIFT + whichever of ▲▼◄► sits directly above faders 5-8 on the
      // hardware resets just that one fader's loop macro instead of its
      // plain genre-nav/rewind/forward action - same "same physical note,
      // SHIFT changes what it means" pattern as DEVICE above.
      const LOOP_MACRO_BUTTONS: readonly [MidiActionId, 'start' | 'end' | 'reverb' | 'pitch'][] = [
        ['prevGenre', 'start'], ['nextGenre', 'end'], ['rwd', 'reverb'], ['fwd', 'pitch'],
      ];
      for (const [actionId, which] of LOOP_MACRO_BUTTONS) {
        const b = bindingsRef.current[actionId];
        if (b.kind === 'note' && b.note === d1) {
          handlersRef.current.onResetLoopMacro(which);
          return;
        }
      }
    }

    for (const [id, binding] of Object.entries(bindingsRef.current)) {
      if (binding.kind === 'note' && binding.note === d1) {
        handlersRef.current.onAction(id as MidiActionId);
        return;
      }
    }
  }, [pushMonitor]);

  // ─── Port binding ──────────────────────────────────────────────────────────
  const bindPorts = useCallback((access: MIDIAccess) => {
    let input: MIDIInput | null = null;
    let output: MIDIOutput | null = null;

    // Allowlist only. Other controllers on the bus are skipped entirely, never
    // opened and never written to.
    for (const port of access.inputs.values()) {
      if (isTargetPort(port.name)) { input = port; break; }
    }
    for (const port of access.outputs.values()) {
      if (isTargetPort(port.name)) { output = port; break; }
    }

    // Only a genuinely new output (not just some unrelated device blipping on
    // the bus and retriggering onstatechange) gets the startup handshake below
    // resent: it's a real device-specific message, not something to spam.
    const isNewOutput = output !== null && output !== outputRef.current;

    if (inputRef.current && inputRef.current !== input) {
      inputRef.current.onmidimessage = null;
    }

    inputRef.current = input;
    outputRef.current = output;

    if (input) {
      input.onmidimessage = handleMessage;
      setDeviceName(input.name ?? 'APC mini mk2');
      setStatus('connected');
      if (isNewOutput) {
        // Akai's protocol says the Introduction Message must go out before any
        // other device-specific message; forcing Normal mode right after it
        // guarantees the pad grid and LED behaviour below actually match this
        // file's assumptions, regardless of whatever mode the hardware was
        // last left in. Silently does nothing if sysex permission wasn't
        // granted (send() only writes real sysex bytes when the browser will
        // actually forward them).
        send(INTRODUCTION_MESSAGE);
        send(NORMAL_MODE_MESSAGE);
      }
    } else {
      lampShadowRef.current.clear();
      setDeviceName(null);
      setStatus('waiting');
    }
  }, [handleMessage, send]);

  const connect = useCallback(async () => {
    if (!('requestMIDIAccess' in navigator)) { setStatus('unsupported'); return; }
    setStatus('requesting');
    try {
      // sysex is needed for the startup handshake in bindPorts (Akai's own
      // protocol calls for it before anything else, and it's also how the pad
      // grid gets forced back into the mode this app assumes). That means the
      // bigger, scarier "full control including system exclusive" browser
      // prompt instead of the plain one; if the user declines it specifically,
      // fall back to a sysex-less grant so plain note/CC traffic (everything
      // except that handshake) still works rather than failing outright.
      let access: MIDIAccess;
      try {
        access = await navigator.requestMIDIAccess({ sysex: true });
      } catch {
        access = await navigator.requestMIDIAccess({ sysex: false });
      }
      accessRef.current = access;
      access.onstatechange = () => bindPorts(access);
      bindPorts(access);
      writeFlag(ENABLED_KEY, 'true');
    } catch {
      setStatus('denied');
    }
  }, [bindPorts]);

  const disconnect = useCallback(() => {
    blankSurface();
    if (inputRef.current) inputRef.current.onmidimessage = null;
    if (accessRef.current) accessRef.current.onstatechange = null;
    inputRef.current = null;
    outputRef.current = null;
    accessRef.current = null;
    setDeviceName(null);
    setStatus('off');
    writeFlag(ENABLED_KEY, 'false');
  }, [blankSurface]);

  // Reconnect silently on load if the user has used it before
  useEffect(() => {
    if (readFlag(ENABLED_KEY, false)) void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear down on unmount so we never leave lamps lit on the hardware
  useEffect(() => () => {
    blankSurface();
    if (inputRef.current) inputRef.current.onmidimessage = null;
    if (accessRef.current) accessRef.current.onstatechange = null;
  }, [blankSurface]);

  // The unmount effect above only fires on a client-side navigation away from the
  // app; closing the tab, closing the browser, or quitting Chrome kills the JS
  // context without ever unmounting React, which is exactly the case the user
  // actually meant by "quit Lucky Breaks" and the one that was leaving every pad
  // and button lit. pagehide fires reliably for all of those (including mobile
  // Safari's app-switch case); beforeunload is the older/wider-supported backstop
  // for the same moment. blankSurface() is a synchronous, immediate MIDI send, so
  // it has time to actually reach the hardware before the page is gone; both
  // listeners are safe to fire together since blankSurface() against an empty or
  // already-blank shadow map is a no-op.
  useEffect(() => {
    const handleUnload = () => blankSurface();
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [blankSurface]);

  // A slow, deliberate breathing rate — not a blink. Runs continuously while
  // connected regardless of whether anything is actually pulsing right now; toggling
  // it when nothing needs it is harmless, the LED effect just ignores it.
  useEffect(() => {
    if (status !== 'connected') return;
    const timer = setInterval(() => setPulsePhase((p) => !p), 1400);
    return () => clearInterval(timer);
  }, [status]);

  // ─── LED feedback ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'connected') return;
    if (!ledsEnabled) { blankSurface(); return; }

    const frame = new Map<number, Lamp>();

    for (let visual = 0; visual < GRID_SIZE; visual++) {
      const slot = PAD_LAYOUT[visual];
      const note = visualToNote(visual, gridOrigin);
      let lamp: Lamp = [PAD_DIM, COLOUR.off];

      if (slot.kind === 'genre') {
        // Each genre keeps its own colour whether idle or active, so the 12 pads
        // stay identifiable at a glance; loading and error stay universal signals
        // and override the genre's own colour while they're relevant.
        const active = state.activeGenreIndex === slot.index;
        const genreColour = GENRE_PALETTE[slot.index];
        if (active && state.error) lamp = [PAD_SOLID, COLOUR.red];
        else if (active && state.loading) lamp = [PAD_PULSE, COLOUR.amber];
        else if (active) lamp = [PAD_SOLID, genreColour];
        else lamp = [PAD_DIM, genreColour];
      } else if (slot.kind === 'looper') {
        // idle: dim white, ready. arming: pulsing amber, same "waiting"
        // language as a genre pad mid-load. recording: hard red pulse (full
        // contrast, not the gentle breathing used elsewhere - REC wants to
        // read as urgent). looping: solid green while actually playing, dim
        // green if SHIFT+stopped (loaded but silent) - still distinct from
        // idle's dim white so "empty" and "loaded but stopped" never read
        // the same. Volume/muting via the column fader doesn't touch this.
        const loopStatus = state.loopStatuses.get(slot.padId) ?? 'idle';
        if (loopStatus === 'arming') lamp = [PAD_PULSE, COLOUR.amber];
        else if (loopStatus === 'recording') lamp = [pulsePhase ? PAD_SOLID : PAD_DIM, COLOUR.red];
        else if (loopStatus === 'looping') {
          const playing = state.loopPlaying.get(slot.padId) ?? true;
          lamp = playing ? [PAD_SOLID, COLOUR.green] : [PAD_DIM, COLOUR.green];
        }
        else lamp = [PAD_DIM, COLOUR.white];
      }

      frame.set(note, lamp);
    }

    const button = (id: MidiActionId, on: boolean, blink = false) => {
      const b = bindings[id];
      if (b.kind !== 'note') return;
      frame.set(b.note, [BUTTON_STATUS, blink ? BUTTON_BLINK : on ? BUTTON_ON : BUTTON_OFF]);
    };
    // SHIFT isn't in the rebindable set (it's read specially, before the generic
    // lookup), so it gets its own lamp rather than going through button().
    // Solid while physically held (unambiguous, wins over anything else even
    // if it's also latched); blinking when latched but NOT currently held -
    // faders 1-8 are still reading the loop bank even though your hand's off
    // SHIFT; off when neither.
    frame.set(SHIFT_NOTE, [BUTTON_STATUS, shiftDown ? BUTTON_ON : fadersLatched ? BUTTON_BLINK : BUTTON_OFF]);
    button('favs', state.favsMode);
    button('dark', state.dark);
    button('playPause', state.playing, state.loading);
    button('cyclePadView', state.screenStage !== 'pad');
    button('index', state.indexOpen);
    button('shuffle', state.shuffleMode);
    button('cycleVisualisation', state.screenStage !== 'pad');
    button('clearAll', state.activeGenreIndex !== null);
    button('muteLoops', state.loopsMuted);
    button('muteRadio', state.radioMuted);
    button('muteFx', state.fxMuted);
    button('exportLoops', state.loopBankOpen);

    // Diff against what is already on the hardware
    const shadow = lampShadowRef.current;
    for (const [note, lamp] of frame) {
      const prev = shadow.get(note);
      if (prev && prev[0] === lamp[0] && prev[1] === lamp[1]) continue;
      send([lamp[0], note, lamp[1]]);
      shadow.set(note, lamp);
    }
  }, [status, ledsEnabled, gridOrigin, bindings, pulsePhase, shiftDown, fadersLatched, state, send, blankSurface]);

  const setGridOrigin = useCallback((origin: GridOrigin) => {
    lampShadowRef.current.clear();
    writeFlag(ORIGIN_KEY, String(origin === 'bottom-left'));
    setGridOriginState(origin);
  }, []);

  const setLedsEnabled = useCallback((on: boolean) => {
    writeFlag(LEDS_KEY, String(on));
    lampShadowRef.current.clear();
    setLedsEnabledState(on);
  }, []);

  const resetBindings = useCallback(() => {
    try { localStorage.removeItem('lucky-breaks-midi-bindings'); } catch {}
    setBindings({ ...DEFAULT_BINDINGS });
    setLearning(null);
    lampShadowRef.current.clear();
  }, []);

  return {
    status,
    deviceName,
    monitor,
    bindings,
    learning,
    setLearning,
    gridOrigin,
    setGridOrigin,
    ledsEnabled,
    setLedsEnabled,
    shiftDown,
    fadersLatched,
    connect,
    disconnect,
    resetBindings,
  };
}
