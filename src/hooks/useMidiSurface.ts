import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUTTON_BLINK,
  BUTTON_OFF,
  BUTTON_ON,
  BUTTON_STATUS,
  COLOUR,
  GENRE_PALETTE,
  GRID_SIZE,
  PAD_BRIGHTNESS,
  PAD_DIM,
  PAD_PULSE,
  PAD_SOLID,
  SHIFT_NOTE,
  type GridOrigin,
  isTargetPort,
  noteToVisual,
  visualToNote,
} from '../lib/midi/apcMiniMk2';
import { LETTERS, PAD_LAYOUT } from '../lib/midi/layout';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  type Binding,
  type MidiActionId,
  loadBindings,
  saveBindings,
} from '../lib/midi/bindings';

export type MidiStatus =
  | 'unsupported'  // browser has no Web MIDI
  | 'off'          // not connected, user has not opted in
  | 'requesting'
  | 'denied'
  | 'waiting'      // permission granted, controller not plugged in
  | 'connected';

export interface MidiHandlers {
  onGenre: (index: number, shift: boolean) => void;
  onLetter: (letter: string) => void;
  onVisualiser: (mode: string) => void;
  onAction: (id: MidiActionId) => void;
  /** Any CC-bound control: the master fader (volume) and the 8 per-effect faders
   *  all arrive here, keyed by which action's binding matched. */
  onFader: (id: MidiActionId, value: number) => void;
  /** SHIFT pressed and released on its own, with no grid pad in between. Held
   *  together with a genre pad it stays the existing favs modifier instead. */
  onShiftTap: () => void;
}

export interface MidiSurfaceState {
  activeGenreIndex: number | null;
  loading: boolean;
  error: boolean;
  playing: boolean;
  shuffleMode: boolean;
  favsMode: boolean;
  currentIsFav: boolean;
  dark: boolean;
  fullscreenViz: boolean;
  currentLetter: string | null;
}

export interface MonitorEntry {
  id: number;
  label: string;
  detail: string;
}

const ENABLED_KEY = 'lucky-breaks-midi-enabled';
const ORIGIN_KEY = 'lucky-breaks-midi-grid-origin';
const LEDS_KEY = 'lucky-breaks-midi-leds';

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
  const [visualiserMode, setVisualiserMode] = useState<string | null>(null);
  const [shiftDown, setShiftDown] = useState(false);

  const accessRef = useRef<MIDIAccess | null>(null);
  const inputRef = useRef<MIDIInput | null>(null);
  const outputRef = useRef<MIDIOutput | null>(null);
  /** Last value written to each note, so we only send what actually changed. */
  const lampShadowRef = useRef<Map<number, Lamp>>(new Map());
  const monitorIdRef = useRef(0);
  /** Cleared on SHIFT-down, set the moment any grid pad is pressed while it's held.
   *  Still false on SHIFT-up means it was a tap, not a hold-and-combine. */
  const shiftUsedRef = useRef(false);

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

    if (d1 === SHIFT_NOTE && (isNoteOn || isNoteOff)) {
      if (isNoteOn) {
        shiftUsedRef.current = false;
      } else if (!shiftUsedRef.current) {
        handlersRef.current.onShiftTap();
      }
      setShiftDown(isNoteOn);
      return;
    }

    if (isCC) {
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

    if (!isNoteOn) return;

    // Grid pads first, then the bound buttons
    const visual = noteToVisual(d1, gridOriginRef.current);
    if (visual !== null) {
      if (shiftRef.current) shiftUsedRef.current = true;
      const slot = PAD_LAYOUT[visual];
      if (slot.kind === 'genre') handlersRef.current.onGenre(slot.index, shiftRef.current);
      else if (slot.kind === 'letter') handlersRef.current.onLetter(slot.letter);
      else if (slot.kind === 'visualiser') {
        setVisualiserMode(slot.mode);
        handlersRef.current.onVisualiser(slot.mode);
      }
      return;
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

    if (inputRef.current && inputRef.current !== input) {
      inputRef.current.onmidimessage = null;
    }

    inputRef.current = input;
    outputRef.current = output;

    if (input) {
      input.onmidimessage = handleMessage;
      setDeviceName(input.name ?? 'APC mini mk2');
      setStatus('connected');
    } else {
      lampShadowRef.current.clear();
      setDeviceName(null);
      setStatus('waiting');
    }
  }, [handleMessage]);

  const connect = useCallback(async () => {
    if (!('requestMIDIAccess' in navigator)) { setStatus('unsupported'); return; }
    setStatus('requesting');
    try {
      // sysex is not needed: pads and buttons are plain note and CC traffic,
      // and skipping it avoids the scarier browser permission prompt.
      const access = await navigator.requestMIDIAccess({ sysex: false });
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
      } else if (slot.kind === 'letter') {
        // All 26 lit, even letters with no stations (there's exactly one: X). Same
        // hue throughout, stepped through the seven static brightness channels so
        // each letter reads as a slightly different shade of the same colour.
        const i = LETTERS.indexOf(slot.letter);
        const step = Math.round((i / (LETTERS.length - 1)) * (PAD_BRIGHTNESS.length - 1));
        lamp = state.currentLetter === slot.letter
          ? [PAD_PULSE, COLOUR.blue]
          : [PAD_BRIGHTNESS[step], COLOUR.blue];
      } else if (slot.kind === 'visualiser') {
        // Coloured to match its mirrored genre pad, reinforcing the left/right
        // correspondence rather than a single uniform visualiser colour.
        const genreColour = GENRE_PALETTE[slot.genreIndex];
        lamp = visualiserMode === slot.mode ? [PAD_SOLID, genreColour] : [PAD_DIM, genreColour];
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
    frame.set(SHIFT_NOTE, [BUTTON_STATUS, state.loading ? BUTTON_BLINK : state.playing ? BUTTON_ON : BUTTON_OFF]);
    button('shuffle', state.shuffleMode);
    button('favs', state.favsMode);
    button('favouriteCurrent', state.currentIsFav);
    button('dark', state.dark);
    button('fullscreenViz', state.fullscreenViz);
    button('fwd', false);
    button('rwd', false);
    button('index', false);
    button('info', false);
    button('closeViz', false);
    button('clearAll', state.activeGenreIndex !== null);

    // Diff against what is already on the hardware
    const shadow = lampShadowRef.current;
    for (const [note, lamp] of frame) {
      const prev = shadow.get(note);
      if (prev && prev[0] === lamp[0] && prev[1] === lamp[1]) continue;
      send([lamp[0], note, lamp[1]]);
      shadow.set(note, lamp);
    }
  }, [status, ledsEnabled, gridOrigin, bindings, visualiserMode, state, send, blankSurface]);

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
    connect,
    disconnect,
    resetBindings,
  };
}
