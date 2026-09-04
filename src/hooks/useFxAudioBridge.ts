import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  createEffectsChain,
  createReverbEffect,
  EFFECT_ORDER,
  EFFECT_REST_VALUE,
  EFFECT_SECONDARY_REST_VALUE,
  type EffectId,
  type EffectsChain,
  type EffectUnit,
} from '../lib/audio/effects';
import { fxSourceUrl } from '../lib/audio/fxProxy';

export type FxStatus = 'idle' | 'starting' | 'active' | 'unavailable';
/** idle: empty, ready to record. arming: pad was pressed but the fx chain
 *  isn't confirmed-audible yet, waiting for that before recording can start
 *  (recordTap only carries real signal once engaged) - same reasoning as any
 *  other fader touch, just deferred one step. recording: capturing into the
 *  buffer. looping: captured buffer is playing back on repeat, mixed in with
 *  whatever else is looping and, unless muted, the live station too. */
export type LooperStatus = 'idle' | 'arming' | 'recording' | 'looping';

export interface LoopBankEntry {
  padId: number;
  durationSeconds: number;
}

const STORAGE_PREFIX = 'lucky-breaks-fx-';
const SECONDARY_STORAGE_PREFIX = 'lucky-breaks-fx2-';

function loadAmount(id: EffectId): number {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + id);
    return v === null ? EFFECT_REST_VALUE[id] : Math.min(1, Math.max(0, Number(v)));
  } catch {
    return EFFECT_REST_VALUE[id];
  }
}

function saveAmount(id: EffectId, value: number): void {
  try { localStorage.setItem(STORAGE_PREFIX + id, String(value)); } catch {}
}

function loadSecondary(id: EffectId): number {
  const rest = EFFECT_SECONDARY_REST_VALUE[id] ?? 0;
  try {
    const v = localStorage.getItem(SECONDARY_STORAGE_PREFIX + id);
    return v === null ? rest : Math.min(1, Math.max(0, Number(v)));
  } catch {
    return rest;
  }
}

function saveSecondary(id: EffectId, value: number): void {
  try { localStorage.setItem(SECONDARY_STORAGE_PREFIX + id, String(value)); } catch {}
}

/**
 * A second, independent audio element carries live effects, entirely separate from
 * the plain playback element useAudioEngine owns. That element has to be safe for
 * every station regardless of CORS support, and Web Audio effects need the opposite:
 * a crossOrigin element, which makes some stations' servers fail to load at all
 * (confirmed against the real catalogue, not theoretical — createMediaElementSource
 * also only works once per element, ever, so this can't be toggled on the one
 * element normal playback already depends on).
 *
 * So: the primary element always plays, unconditionally, exactly as it always has —
 * nothing here ever touches its .src or its load/retry logic. This bridge only ever
 * mutes/unmutes it. The fx element mirrors the primary's station only once the user
 * has actually touched a fader, races to confirm it can play that station, and only
 * then takes over (primary muted, fx chain's gain brought up). Anything short of a
 * confirmed 'playing' event on the fx element falls back to leaving the primary
 * audible with no effects — never to silence.
 */
/** How many peekLevel() checks to run, and how far apart, before giving up on a
 *  station that fired 'playing' but never shows real signal. Spread out rather
 *  than one snapshot: a single read can land on a true-silent instant in otherwise
 *  perfectly normal audio (a pause in speech, a quiet intro) and false-negative. */
const AUDIBILITY_PROBE_ATTEMPTS = 8;
const AUDIBILITY_PROBE_INTERVAL_MS = 150;
const AUDIBILITY_THRESHOLD = 0.003;

/** Time constant (not a hard cutoff — this is an exponential decay) for the whole
 *  chain's output on a station switch, instead of cutting instantly. Needs to be
 *  comfortably longer than a delay loop's own natural decay (dub delay's is
 *  roughly 1-1.3s at max feedback, audible for several seconds past that) or this
 *  fade becomes the thing truncating the trail rather than the loop's own physics
 *  being what's actually heard decaying. 8s keeps this envelope close to fully open
 *  for most of a long trail's natural length, only mattering as an eventual floor. */
const TAIL_FADE_SECONDS = 8;

/** Ramp used by applyAudibility when switching the fx chain's gain in step
 *  with primary.muted - see the comment there. Long enough to avoid a
 *  hard-cut click, short enough that the two streams are never both
 *  perceptibly audible at once. */
const AUDIBILITY_SWITCH_RAMP = 0.005;

/** Hard cap on a loop's length. 30s comfortably covers a break, a vocal
 *  snippet, a drum hit - the kind of thing this is for - without letting a
 *  forgotten recording grow unbounded (stereo Float32 at 44.1kHz: 30s is
 *  about 10.6MB per pad, negligible even with several loops held at once;
 *  there just needs to be SOME ceiling). */
const LOOPER_MAX_SECONDS = 30;
/** Below this, a "recording" is almost certainly an accidental double-tap
 *  rather than a real capture - cancel back to idle instead of looping a
 *  near-silent sliver. */
const LOOPER_MIN_SAMPLES_FACTOR = 0.1; // seconds

/** A captured loop's start and end are two essentially random points in
 *  whatever was playing live - nothing lines them up in phase or amplitude,
 *  so an unmodified capture wraps from wherever its last sample happened to
 *  land straight back to sample 0, an abrupt discontinuity that reads as a
 *  click or digital-sounding glitch right at the loop point, worse the
 *  louder that mismatch happens to be (which is why it's intermittent - some
 *  captures land near a zero-crossing by luck, most don't). Fading only the
 *  TAIL to true silence (not the head too, see finishRecordingAndLoopPad)
 *  turns that jump into silence -> a sharp new onset instead, which reads as
 *  a natural gap rather than a click, and keeps a recording's own opening
 *  transient - a drum hit, a vocal's attack - fully intact rather than
 *  softened. Same technique as STUTTER_CROSSFADE_MS in effects.ts, just
 *  one-sided here since this loop point is fixed at capture time rather than
 *  continuously retriggering. */
const LOOP_TAIL_FADE_SECONDS = 0.012;

/** The loop pad block is 4 columns wide - one SHIFT+fader (1-4) permanently
 *  owns each column's volume, whatever pad(s) in that column happen to be
 *  looping. Faders 5-8 aren't used for loops at all any more. */
const LOOP_COLUMNS = 4;

/** How long a press has to hold on an already-looping pad before it counts
 *  as "clear" rather than a plain retrigger - see looperPadPress/Release. */
const HOLD_TO_CLEAR_MS = 1000;

interface LoopSlot {
  // Recording-in-progress state.
  recordNode: ScriptProcessorNode | null;
  silence: GainNode | null;
  bufferL: Float32Array | null;
  bufferR: Float32Array | null;
  writeIdx: number;
  // Committed-loop state.
  playback: AudioBufferSourceNode | null;
  /** Fader-controlled volume (the column's SHIFT+fader) - the only volume
   *  control a committed loop has. Reused across retriggers: a fresh
   *  AudioBufferSourceNode gets created and connected to this SAME node
   *  each time (a source can only ever be started once), so the fader
   *  position survives a retrigger untouched. */
  gain: GainNode | null;
  audioBuffer: AudioBuffer | null;
  /** Loop trim as fractions (0-1) of the buffer's own duration, applied to the
   *  playback source's native loopStart/loopEnd - SHIFT+fader 5/6, whichever
   *  pad is currently selected (see selectLoopPad). Both are natively
   *  live-adjustable on an already-playing AudioBufferSourceNode, so trimming
   *  doesn't need a retrigger to be heard. Reset to the full buffer (0/1) on
   *  every fresh commit and on clear. */
  startFrac: number;
  endFrac: number;
  /** SHIFT+fader 7: how much of this pad's own signal feeds the shared
   *  reverb unit (see ensureLoopReverb) whenever THIS pad is the one
   *  selected - each pad remembers its own amount independently and it's
   *  restored automatically on reselecting it (see selectLoopPad), not
   *  whatever amount the last-edited pad happened to leave the shared unit
   *  on. 0 (no reverb) is the rest value, same convention as the radio fx. */
  reverbAmount: number;
  /** SHIFT+fader 8: this pad's own pitch, as the raw 0-1 fader position -
   *  0.5 is neutral (dead centre, same bypass convention as the radio's
   *  filter/phaser fader). Converted to a playbackRate via pitchFracToRate
   *  and written straight onto this pad's own AudioBufferSourceNode, so it's
   *  inherently per-pad with no shared unit or splicing needed at all -
   *  remembered here purely so a retrigger or a fresh pad selection can put
   *  it back on a brand new source node. */
  pitchFrac: number;
}

/** Minimum gap kept between a loop's start and end trim points, so SHIFT+fader
 *  5/6 can never cross them into an inverted or zero-length loop. */
const MIN_TRIM_GAP_SECONDS = 0.03;

/** Fader 8: pitch, mapped so the fader's dead centre is truly neutral
 *  (playbackRate 1.0, no shift at all) - a full octave down at the bottom,
 *  a full octave up at the top, same dead-centre-bypass convention as the
 *  radio's own filter and phaser/flanger faders (see EFFECT_REST_VALUE in
 *  effects.ts). playbackRate shifts pitch and speed together (a turntable,
 *  not a formant-preserving shifter) - deliberately: it needs no DSP chain
 *  of its own, works natively on the AudioBufferSourceNode that's already
 *  there, and that "vinyl" character fits a break-sampling tool like this
 *  one anyway. */
const PITCH_SEMITONE_RANGE = 12;
const PITCH_RAMP = 0.02; // seconds - short smoothing so the fader doesn't click
function pitchFracToRate(frac: number): number {
  const semitones = (frac - 0.5) * 2 * PITCH_SEMITONE_RANGE;
  return Math.pow(2, semitones / 12);
}

export function useFxAudioBridge(primaryAudioRef: RefObject<HTMLAudioElement | null>) {
  const fxAudioRef = useRef<HTMLAudioElement | null>(null);
  const chainRef = useRef<EffectsChain | null>(null);
  /** The fx chain's actual entry point (what's passed as `source` to
   *  createEffectsChain) - a plain gain node, not the radio's
   *  MediaElementAudioSourceNode directly, so more than one thing can feed
   *  into the SAME chain. Radio feeds in via radioSourceGainRef; the loop mix
   *  feeds in via loopFxSendGainRef (see ensureLoopMixBus) whenever loop-fx
   *  mode is engaged. Set once, alongside chainRef, inside ensureChain. */
  const chainEntryRef = useRef<GainNode | null>(null);
  /** Gates the radio's OWN contribution into the chain specifically -
   *  separate from the chain's own final masterGain (chain.setActive), which
   *  now has to stay open for loop-fx mode too. Audible only in the ordinary
   *  "radio confirmed playing through fx" case - see applyAudibility. */
  const radioSourceGainRef = useRef<GainNode | null>(null);
  /** Reads the radio fx source's OWN raw level, tapped before
   *  radioSourceGainRef's gate rather than chain.peekLevel (which reads
   *  post-effects, downstream of that gate) - the audibility probe in
   *  startFxForCurrentUrl needs to detect real decoded radio signal
   *  regardless of whether it's currently gated audible or not, since
   *  radioSourceGain only OPENS once the probe has already confirmed
   *  success. Reading post-gate here would be circular: silent until
   *  confirmed, never confirmable because it reads silent. Set alongside
   *  chainEntryRef inside ensureChain. */
  const radioPeekLevelRef = useRef<(() => number) | null>(null);
  const engagedRef = useRef(false);
  const currentUrlRef = useRef<string>('');
  const attemptTokenRef = useRef(0); // guards against a stale probe outliving a station switch
  const unavailableRef = useRef(false); // Web Audio itself unsupported — stop retrying
  const amountsRef = useRef<Record<EffectId, number>>(
    Object.fromEntries(EFFECT_ORDER.map((id) => [id, loadAmount(id)])) as Record<EffectId, number>,
  );
  const secondaryAmountsRef = useRef<Record<EffectId, number>>(
    Object.fromEntries(EFFECT_ORDER.map((id) => [id, loadSecondary(id)])) as Record<EffectId, number>,
  );
  const [fxStatus, setFxStatusState] = useState<FxStatus>('idle');
  const fxStatusRef = useRef<FxStatus>('idle');
  const setFxStatus = useCallback((s: FxStatus) => {
    fxStatusRef.current = s;
    setFxStatusState(s);
  }, []);

  // ─── Loopers (one independent slot per looper pad, up to 52 of them) ───────
  const [loopStatuses, setLoopStatusesState] = useState<ReadonlyMap<number, LooperStatus>>(new Map());
  const loopStatusesRef = useRef<Map<number, LooperStatus>>(new Map());
  const setPadStatus = useCallback((padId: number, status: LooperStatus) => {
    if (status === 'idle') loopStatusesRef.current.delete(padId);
    else loopStatusesRef.current.set(padId, status);
    setLoopStatusesState(new Map(loopStatusesRef.current));
  }, []);

  const [loopBank, setLoopBank] = useState<LoopBankEntry[]>([]);

  /** Whether each currently-looping pad is actually making sound right now
   *  (true) or stopped-but-still-loaded (false) via SHIFT+pad - see
   *  stopLoopPad. Missing entry means playing (the default the instant a
   *  loop is committed, and again after every retrigger). */
  const [loopPlaying, setLoopPlayingState] = useState<ReadonlyMap<number, boolean>>(new Map());
  const loopPlayingRef = useRef<Map<number, boolean>>(new Map());
  const setLoopPlayingFor = useCallback((padId: number, playing: boolean) => {
    loopPlayingRef.current.set(padId, playing);
    setLoopPlayingState(new Map(loopPlayingRef.current));
  }, []);

  const loopSlotsRef = useRef<Map<number, LoopSlot>>(new Map());
  const getOrCreateSlot = useCallback((padId: number): LoopSlot => {
    let slot = loopSlotsRef.current.get(padId);
    if (!slot) {
      slot = {
        recordNode: null, silence: null, bufferL: null, bufferR: null, writeIdx: 0,
        playback: null, gain: null, audioBuffer: null, startFrac: 0, endFrac: 1,
        reverbAmount: 0, pitchFrac: 0.5,
      };
      loopSlotsRef.current.set(padId, slot);
    }
    return slot;
  }, []);

  /** Pads waiting on the fx chain to become audible before they can start
   *  recording (mirrors the old single-pad looperArmedRef, just a set now
   *  since more than one pad can be pressed before that happens). */
  const armingPadsRef = useRef<Set<number>>(new Set());

  /** Pending "is this press a hold?" timers for pads currently mid-press -
   *  see looperPadPress/looperPadRelease. Three different presses arm one of
   *  these: recording (tap commits it, hold discards the take outright),
   *  SHIFT+looping (tap toggles play/stop, hold clears it outright - without
   *  ever having to make it audible again first to get there), and plain
   *  looping (retriggers immediately regardless, a hold can still override
   *  that by clearing what it just started - onTapConfirmed stays unset
   *  there, there's nothing left to do on a confirmed tap). onTapConfirmed
   *  runs on release ONLY if the hold never fired - the deferred half of
   *  "tap does X, hold does Y instead" for the first two. */
  const holdTimersRef = useRef<Map<number, { timer: ReturnType<typeof setTimeout>; onTapConfirmed?: () => void }>>(new Map());

  /** One persistent gain node per column (padId % 4), each fed by every
   *  looping pad in that column and feeding the shared loop bus in turn -
   *  this is what SHIFT+fader 1-4 actually controls. Created lazily, same
   *  pattern as the bus itself. */
  const columnGainsRef = useRef<(GainNode | null)[]>(new Array(LOOP_COLUMNS).fill(null));

/** Every committed loop sums into this one bus. From there it splits two ways,
   *  never both open at once (see applyAudibility): normally straight to
   *  destination, untouched by the live fx chain, same as always - effects
   *  baked in at record time are all a loop needs by default. But whenever
   *  the radio's muted (VOLUME), that's read as "the loops are what's meant
   *  to be heard right now" and this same bus is rerouted into the SAME fx
   *  chain the radio faders normally drive instead (see chainEntryRef,
   *  ensureChain) - so faders 1-8 mangle the loop mix live rather than
   *  sitting idle while radio's silent. Also doubles as the "mute loops"
   *  control (PAN): one gain ramp on the bus itself silences every loop at
   *  once regardless of which of the two paths is currently open. */
  const loopMixBusRef = useRef<GainNode | null>(null);
  const loopsMutedRef = useRef(false);
  /** The loop mix's normal, direct path to destination - open (1) except
   *  while loop-fx mode has taken over below. */
  const loopDirectGainRef = useRef<GainNode | null>(null);
  /** The loop mix's path into the shared fx chain (chainEntryRef) - open (1)
   *  only while loop-fx mode is engaged, its exact complement to
   *  loopDirectGainRef so the identical signal is never audible down both
   *  paths at once (same reasoning as AUDIBILITY_SWITCH_RAMP's own comment). */
  const loopFxSendGainRef = useRef<GainNode | null>(null);
  const ensureLoopMixBus = useCallback((ctx: AudioContext): GainNode => {
    if (loopMixBusRef.current) return loopMixBusRef.current;
    const bus = ctx.createGain();
    bus.gain.value = loopsMutedRef.current ? 0 : 1;

    // Loop-fx mode is on exactly when the radio's muted and the shared chain
    // actually exists yet (chainEntryRef is only set once ensureChain has run
    // at least once) - read directly here rather than via applyAudibility,
    // which is declared later in this file and would be a TDZ reference this
    // early. Whichever it is right now, start both paths already in that
    // state instead of both defaulting open and needing a follow-up call to
    // correct it.
    const loopFxEngagedNow = radioMutedRef.current && !!chainEntryRef.current;
    const direct = ctx.createGain();
    direct.gain.value = loopFxEngagedNow ? 0 : 1;
    bus.connect(direct).connect(ctx.destination);
    loopDirectGainRef.current = direct;

    const send = ctx.createGain();
    send.gain.value = loopFxEngagedNow ? 1 : 0;
    bus.connect(send);
    if (chainEntryRef.current) send.connect(chainEntryRef.current);
    loopFxSendGainRef.current = send;

    loopMixBusRef.current = bus;
    return bus;
  }, []);

  /** The column gain a loop in this column should feed into, creating it
   *  (at unity, so a brand new column starts fully audible) the first time
   *  anything in that column ever commits. */
  const ensureColumnGain = useCallback((ctx: AudioContext, col: number): GainNode => {
    const existing = columnGainsRef.current[col];
    if (existing) return existing;
    const bus = ensureLoopMixBus(ctx);
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(bus);
    columnGainsRef.current[col] = g;
    return g;
  }, [ensureLoopMixBus]);

  /** Whichever loop pad was most recently pressed - "the currently selected
   *  loop" that SHIFT+fader 5-8 edits (start trim, end trim, reverb, delay).
   *  Set on every looperPadPress regardless of that press's own status (idle,
   *  recording, looping...), so a pad becomes the edit target the instant
   *  it's touched even before it has a committed loop to actually route. */
  const selectedPadRef = useRef<number | null>(null);

  /** One shared reverb unit for the WHOLE looper, not 12 independent per-pad
   *  copies - SHIFT+fader 7 only ever processes whichever pad is currently
   *  selected, with that pad's OWN remembered amount (LoopSlot.reverbAmount)
   *  re-applied every time selection lands back on it (see selectLoopPad),
   *  so it still reads as a per-pad setting even though the actual DSP node
   *  is shared. Created lazily on first use. Pitch (fader 8) needs no
   *  equivalent of this - it's a native property on each pad's own source
   *  node, see pitchFracToRate. */
  const loopReverbRef = useRef<EffectUnit | null>(null);
  const ensureLoopReverb = useCallback((ctx: AudioContext): EffectUnit => {
    if (loopReverbRef.current) return loopReverbRef.current;
    const reverb = createReverbEffect(ctx);
    loopReverbRef.current = reverb;
    return reverb;
  }, []);

  const radioMutedRef = useRef(false); // VOLUME: live radio silenced outright
  const fxMutedRef = useRef(false); // DEVICE: dry radio, fx chain's processed output silenced

  /** Connects a committed loop's fader-gain node onward to its column - through
   *  the shared reverb unit first if this pad is the one currently selected
   *  (ensureLoopReverb above), with that pad's own remembered amount put back
   *  on it, straight to the column otherwise. Only ever touches the gain
   *  node's OWN outgoing connection, never what feeds IT - a retrigger reuses
   *  the same gain node, so its routing (selected or not) survives untouched
   *  across retriggers. */
  const routeLoopGain = useCallback((ctx: AudioContext, padId: number, gain: GainNode) => {
    const columnGain = ensureColumnGain(ctx, padId % LOOP_COLUMNS);
    if (selectedPadRef.current === padId) {
      const reverb = ensureLoopReverb(ctx);
      gain.connect(reverb.input);
      reverb.output.disconnect();
      reverb.output.connect(columnGain);
      reverb.setAmount(loopSlotsRef.current.get(padId)?.reverbAmount ?? 0);
    } else {
      gain.connect(columnGain);
    }
  }, [ensureColumnGain, ensureLoopReverb]);

  /** Moves "the currently selected loop" (see selectedPadRef) to padId,
   *  live-rewiring the shared reverb unit off whichever pad had it before and
   *  onto this one, and recalling THIS pad's own reverb amount and pitch
   *  (not whatever the previous pad's were) so each pad's macro controls
   *  read as independent even though the reverb DSP itself is shared -
   *  pitch needs no rewiring, just writing its remembered rate straight onto
   *  the pad's own already-playing source. Reverb rewiring only happens if
   *  each pad actually has a committed loop right now; a pad with nothing
   *  recorded yet just becomes the selection with no wiring to do
   *  (routeLoopGain applies it correctly whenever that pad's loop is next
   *  committed). A no-op if padId is already selected. */
  const selectLoopPad = useCallback((padId: number) => {
    const prevId = selectedPadRef.current;
    if (prevId === padId) return;
    selectedPadRef.current = padId;
    const chain = chainRef.current;
    if (!chain) return; // no Web Audio graph yet - nothing to rewire until one exists
    const ctx = chain.ctx;
    const reverb = ensureLoopReverb(ctx);

    if (prevId !== null) {
      const prevSlot = loopSlotsRef.current.get(prevId);
      if (prevSlot?.gain) {
        try { prevSlot.gain.disconnect(reverb.input); } catch { /* wasn't connected */ }
        prevSlot.gain.connect(ensureColumnGain(ctx, prevId % LOOP_COLUMNS));
      }
    }

    reverb.output.disconnect();
    const slot = loopSlotsRef.current.get(padId);
    if (slot?.gain) {
      const columnGain = ensureColumnGain(ctx, padId % LOOP_COLUMNS);
      try { slot.gain.disconnect(columnGain); } catch { /* wasn't connected */ }
      slot.gain.connect(reverb.input);
      reverb.output.connect(columnGain);
    }
    reverb.setAmount(slot?.reverbAmount ?? 0);
    if (slot?.playback) {
      slot.playback.playbackRate.setTargetAtTime(pitchFracToRate(slot.pitchFrac), ctx.currentTime, PITCH_RAMP);
    }
  }, [ensureColumnGain, ensureLoopReverb]);

  /** SHIFT + fader 5/6, for whichever pad is currently selected: live-adjusts
   *  that loop's start/end trim as a fraction of its own buffer, straight
   *  onto the already-playing source's own loopStart/loopEnd - both are
   *  natively live-adjustable on Web Audio even mid-loop, no retrigger needed
   *  to hear it move. Clamped to MIN_TRIM_GAP_SECONDS apart so the two points
   *  can never cross into an inverted or zero-length loop. */
  const setSelectedLoopTrim = useCallback((which: 'start' | 'end', value: number) => {
    const padId = selectedPadRef.current;
    if (padId === null) return;
    const slot = loopSlotsRef.current.get(padId);
    if (!slot?.audioBuffer) return;
    const dur = slot.audioBuffer.duration;
    const v = Math.min(1, Math.max(0, value));
    const minGapFrac = dur > 0 ? MIN_TRIM_GAP_SECONDS / dur : 0;
    if (which === 'start') {
      slot.startFrac = Math.max(0, Math.min(v, slot.endFrac - minGapFrac));
    } else {
      slot.endFrac = Math.min(1, Math.max(v, slot.startFrac + minGapFrac));
    }
    if (slot.playback) {
      slot.playback.loopStart = slot.startFrac * dur;
      slot.playback.loopEnd = slot.endFrac * dur;
    }
  }, []);

  /** SHIFT + fader 7, for whichever pad is currently selected: how much of
   *  it feeds the shared reverb unit. Stored on the pad itself so it's
   *  recalled correctly next time selection lands back on this pad (see
   *  selectLoopPad), not left at whatever the last-edited pad's amount was. */
  const setSelectedLoopReverb = useCallback((value: number) => {
    const padId = selectedPadRef.current;
    if (padId === null) return;
    const slot = loopSlotsRef.current.get(padId);
    if (!slot) return;
    const v = Math.min(1, Math.max(0, value));
    slot.reverbAmount = v;
    const ctx = chainRef.current?.ctx;
    if (ctx) ensureLoopReverb(ctx).setAmount(v);
  }, [ensureLoopReverb]);

  /** SHIFT + fader 8, for whichever pad is currently selected: pitch, dead
   *  centre neutral (see pitchFracToRate) - written straight onto that pad's
   *  own already-playing source's native playbackRate, no shared unit or
   *  splicing needed since each pad already has its own source node. Stored
   *  on the pad so a retrigger or a later reselection puts it back. */
  const setSelectedLoopPitch = useCallback((value: number) => {
    const padId = selectedPadRef.current;
    if (padId === null) return;
    const slot = loopSlotsRef.current.get(padId);
    if (!slot) return;
    const v = Math.min(1, Math.max(0, value));
    slot.pitchFrac = v;
    if (slot.playback) {
      slot.playback.playbackRate.setTargetAtTime(pitchFracToRate(v), slot.playback.context.currentTime, PITCH_RAMP);
    }
  }, []);

  /** SHIFT + whichever of ▲▼◄► sits directly above faders 5-8: puts just
   *  THAT fader's own loop macro back to its rest value for whichever pad
   *  is currently selected, exactly as if its fader had been moved there -
   *  start trim back to the very beginning, end trim back to the very end,
   *  reverb back to none, pitch back to dead centre (no shift). Plain
   *  wrappers around the same setters the faders themselves call, so
   *  there's only one place that actually knows how to apply each of these. */
  const resetSelectedLoopMacro = useCallback((which: 'start' | 'end' | 'reverb' | 'pitch') => {
    switch (which) {
      case 'start': setSelectedLoopTrim('start', 0); return;
      case 'end': setSelectedLoopTrim('end', 1); return;
      case 'reverb': setSelectedLoopReverb(0); return;
      case 'pitch': setSelectedLoopPitch(0.5); return;
    }
  }, [setSelectedLoopTrim, setSelectedLoopReverb, setSelectedLoopPitch]);

  const ensureFxAudio = useCallback((): HTMLAudioElement => {
    if (fxAudioRef.current) return fxAudioRef.current;
    const a = new Audio();
    a.preload = 'none';
    a.crossOrigin = 'anonymous';
    a.style.display = 'none';
    // Match whatever the volume fader is already set to, in case it was moved
    // before this element ever existed — setVolume() only updates it going forward.
    a.volume = primaryAudioRef.current?.volume ?? 1;
    document.body.appendChild(a);
    fxAudioRef.current = a;
    return a;
  }, [primaryAudioRef]);

  const ensureChain = useCallback((): EffectsChain | null => {
    if (unavailableRef.current) return null;
    if (chainRef.current) {
      chainRef.current.resume();
      return chainRef.current;
    }
    try {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) { unavailableRef.current = true; return null; }
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(ensureFxAudio());
      // The chain's real entry point is this gain node, not the radio source
      // directly, so the loop mix can ALSO feed into the exact same chain
      // (see loopFxSendGainRef) without needing a second copy of every
      // effect. radioSourceGain gates the radio's own contribution
      // specifically, independent of the chain's final masterGain
      // (chain.setActive) which now has to stay open for loop-fx mode too -
      // see applyAudibility for how these are actually driven.
      const chainEntry = ctx.createGain();
      chainEntry.gain.value = 1;
      const radioSourceGain = ctx.createGain();
      radioSourceGain.gain.value = 0; // applyAudibility sets the real value once fx is confirmed
      source.connect(radioSourceGain);
      radioSourceGain.connect(chainEntry);
      chainEntryRef.current = chainEntry;
      radioSourceGainRef.current = radioSourceGain;

      // A raw, ungated tap on source itself for the audibility probe below -
      // see radioPeekLevelRef's own comment for why it can't just read
      // chain.peekLevel any more now that radioSourceGain sits in the way.
      const radioAnalyser = ctx.createAnalyser();
      radioAnalyser.fftSize = 1024;
      source.connect(radioAnalyser);
      const radioAnalyserBuffer = new Float32Array(radioAnalyser.fftSize);
      radioPeekLevelRef.current = () => {
        radioAnalyser.getFloatTimeDomainData(radioAnalyserBuffer);
        let peak = 0;
        for (let i = 0; i < radioAnalyserBuffer.length; i++) {
          const a = Math.abs(radioAnalyserBuffer[i]);
          if (a > peak) peak = a;
        }
        return peak;
      };

      const chain = createEffectsChain(ctx, chainEntry);
      for (const id of EFFECT_ORDER) {
        chain.setAmount(id, amountsRef.current[id]);
        chain.setSecondary(id, secondaryAmountsRef.current[id]);
      }
      chainRef.current = chain;
      chain.resume();
      // If a loop mix bus was somehow created before this chain existed (not
      // expected in practice - ensureLoopMixBus never runs until a chain
      // already does, see its own comment - but cheap to cover), hook its
      // fx-send into the chain now that it finally exists.
      if (loopFxSendGainRef.current) loopFxSendGainRef.current.connect(chainEntry);
      return chain;
    } catch {
      unavailableRef.current = true;
      return null;
    }
  }, [ensureFxAudio]);

  /** Tears down whatever a pad is mid-doing (armed or actively recording)
   *  without saving anything, back to idle. Not used for clearing a
   *  completed loop that's already playing - see clearLoopPad for that. */
  const cancelPadRecording = useCallback((padId: number) => {
    armingPadsRef.current.delete(padId);
    const slot = loopSlotsRef.current.get(padId);
    if (slot) {
      if (slot.recordNode) {
        chainRef.current?.recordTap.disconnect(slot.recordNode);
        slot.recordNode.disconnect();
        slot.recordNode.onaudioprocess = null;
        slot.recordNode = null;
      }
      slot.silence?.disconnect();
      slot.silence = null;
      slot.bufferL = null;
      slot.bufferR = null;
      slot.writeIdx = 0;
    }
    setPadStatus(padId, 'idle');
  }, [setPadStatus]);

  /** Stops a completed loop's playback and returns it to idle. Also cancels
   *  any pending hold timer for it (harmless if there wasn't one) - a pad
   *  being cleared some OTHER way (e.g. a station change never touches this,
   *  but this guards any future caller) shouldn't leave a stale timer armed
   *  to fire against a pad that's already gone. */
  const clearLoopPad = useCallback((padId: number) => {
    const pending = holdTimersRef.current.get(padId);
    if (pending !== undefined) { clearTimeout(pending.timer); holdTimersRef.current.delete(padId); }
    const slot = loopSlotsRef.current.get(padId);
    if (slot) {
      if (slot.playback) {
        try { slot.playback.stop(); } catch { /* already stopped */ }
        slot.playback.disconnect();
        slot.playback = null;
      }
      slot.gain?.disconnect();
      slot.gain = null;
      slot.audioBuffer = null;
      slot.startFrac = 0;
      slot.endFrac = 1;
      slot.reverbAmount = 0;
      slot.pitchFrac = 0.5;
    }
    if (loopPlayingRef.current.delete(padId)) setLoopPlayingState(new Map(loopPlayingRef.current));
    setPadStatus(padId, 'idle');
    setLoopBank((prev) => prev.filter((l) => l.padId !== padId));
  }, [setPadStatus]);

  /** PAN: silences every loop at once via the shared mix bus, without
   *  touching any individual loop's own gain. */
  const setLoopsMuted = useCallback((muted: boolean) => {
    loopsMutedRef.current = muted;
    const bus = loopMixBusRef.current;
    if (bus) bus.gain.setTargetAtTime(muted ? 0 : 1, bus.context.currentTime, 0.05);
  }, []);

  /** Single source of truth for what the primary element, the radio's own
   *  send into the fx chain, the loop mix's two paths, and the chain's own
   *  final gain should ALL be doing right now. Two independent things live
   *  side by side here: whether RADIO is audible through fx (unchanged from
   *  before - radioMuted wins outright, then fxMuted or not-yet-active both
   *  mean dry radio, only the ordinary case plays fx-processed radio), and
   *  whether LOOP-FX mode is engaged (exactly when radio's muted and the
   *  chain actually exists) - the loop mix's direct-to-destination path and
   *  its into-the-chain path are each other's exact complement, crossfaded
   *  the same fast way primary/chain always have been (AUDIBILITY_SWITCH_RAMP
   *  - see its own comment for why: two copies of the identical signal
   *  audible at once beats against itself). The chain's own final gain
   *  (chain.setActive) stays open whenever EITHER source is actually feeding
   *  it something worth hearing, not just for the radio case any more.
   *  Called after any change to fxStatus, radioMutedRef or fxMutedRef,
   *  instead of each call site hand-rolling its own combination of these -
   *  that's what used to let a newly-confirmed fx engagement quietly stomp
   *  an active mute. */
  const applyAudibility = useCallback(() => {
    const primary = primaryAudioRef.current;
    const chain = chainRef.current;
    const t = chain?.ctx.currentTime ?? 0;

    const radioIntoChain = !radioMutedRef.current && !fxMutedRef.current && fxStatusRef.current === 'active';
    // The dry primary element has to hide whenever EITHER radio's muted
    // outright OR the fx-processed radio has taken over (radioIntoChain) -
    // not just the first of those. Dropping the second half of this (an
    // actual regression from the loop-fx rework, not the original design)
    // is exactly what let the primary keep playing the instant fx engaged,
    // right on top of that same content now also coming through the chain -
    // the two-tracks-at-once "overdub" bug.
    if (primary) primary.muted = radioMutedRef.current || radioIntoChain;
    radioSourceGainRef.current?.gain.setTargetAtTime(radioIntoChain ? 1 : 0, t, AUDIBILITY_SWITCH_RAMP);

    const loopFxEngaged = radioMutedRef.current && !!chain;
    loopFxSendGainRef.current?.gain.setTargetAtTime(loopFxEngaged ? 1 : 0, t, AUDIBILITY_SWITCH_RAMP);
    loopDirectGainRef.current?.gain.setTargetAtTime(loopFxEngaged ? 0 : 1, t, AUDIBILITY_SWITCH_RAMP);

    chain?.setActive(radioIntoChain || loopFxEngaged, AUDIBILITY_SWITCH_RAMP);
  }, [primaryAudioRef]);

  // setRadioMuted lives further down (after startFxForCurrentUrl is
  // declared, which it needs to call) - see there.

  /** DEVICE: drops back to dry, unprocessed radio without touching any fx
   *  fader's actual position - they're still exactly where they were dialled
   *  in once this is switched off again. Independent of radioMuted (which
   *  always wins if both are on) and of the loops, which never route through
   *  the fx chain in the first place. */
  const setFxMuted = useCallback((muted: boolean) => {
    fxMutedRef.current = muted;
    applyAudibility();
  }, [applyAudibility]);

  /** SHIFT + fader 1-4 -> that column's shared gain, whatever pad(s) in it
   *  are currently looping. SHIFT + fader 5-8 (slotIndex 4-7) instead all edit
   *  whichever pad is currently selected (selectedPadRef, set by the most
   *  recent looperPadPress): 5 start trim, 6 end trim, 7 reverb send, 8
   *  pitch - see setSelectedLoopTrim, setSelectedLoopReverb, setSelectedLoopPitch. */
  const setLoopFaderVolume = useCallback((slotIndex: number, value: number) => {
    if (slotIndex < 0 || slotIndex >= 8) return;
    if (slotIndex < LOOP_COLUMNS) {
      const g = columnGainsRef.current[slotIndex];
      if (g) g.gain.value = Math.min(1, Math.max(0, value));
      return;
    }
    if (slotIndex === 4) { setSelectedLoopTrim('start', value); return; }
    if (slotIndex === 5) { setSelectedLoopTrim('end', value); return; }
    if (slotIndex === 6) { setSelectedLoopReverb(value); return; }
    setSelectedLoopPitch(value);
  }, [setSelectedLoopPitch, setSelectedLoopReverb, setSelectedLoopTrim]);

  const getLoopBuffer = useCallback((padId: number): AudioBuffer | null => {
    return loopSlotsRef.current.get(padId)?.audioBuffer ?? null;
  }, []);

  /** Turns whatever got captured into a looping AudioBufferSourceNode, mixed
   *  into the shared loop bus alongside anything else already looping. Also
   *  the auto-stop path when a recording hits LOOPER_MAX_SECONDS - see
   *  beginRecordingPad. */
  const finishRecordingAndLoopPad = useCallback((padId: number) => {
    const chain = chainRef.current;
    const slot = loopSlotsRef.current.get(padId);
    if (!slot) return;
    const node = slot.recordNode;
    const bufL = slot.bufferL;
    const bufR = slot.bufferR;
    const recorded = slot.writeIdx;
    if (node) {
      chain?.recordTap.disconnect(node);
      node.disconnect();
      node.onaudioprocess = null;
      slot.recordNode = null;
    }
    slot.silence?.disconnect();
    slot.silence = null;

    if (!chain || !bufL || !bufR || recorded < chain.ctx.sampleRate * LOOPER_MIN_SAMPLES_FACTOR) {
      // Too short to be a deliberate capture (an accidental double-tap) -
      // cancel back to idle rather than looping a near-silent sliver.
      slot.bufferL = null;
      slot.bufferR = null;
      slot.writeIdx = 0;
      setPadStatus(padId, 'idle');
      return;
    }

    const ctx = chain.ctx;
    // Fade just the last LOOP_TAIL_FADE_SECONDS down to true silence in
    // place, before this gets baked into an AudioBuffer - see its own
    // comment for why this is what actually fixes the click/glitch right at
    // the loop point rather than something wrong with looping itself.
    const fadeSamples = Math.min(recorded, Math.round(ctx.sampleRate * LOOP_TAIL_FADE_SECONDS));
    for (let i = 0; i < fadeSamples; i++) {
      const idx = recorded - fadeSamples + i;
      const g = 1 - (i + 1) / fadeSamples; // just-under-1 at the fade's start -> exactly 0 on the very last sample
      bufL[idx] *= g;
      bufR[idx] *= g;
    }
    const audioBuffer = ctx.createBuffer(2, recorded, ctx.sampleRate);
    // .slice(), not .subarray(): copyToChannel wants a Float32Array backed by
    // a real ArrayBuffer specifically, which a plain subarray view doesn't
    // type-check as (a TS lib quirk, not a functional issue).
    audioBuffer.copyToChannel(bufL.slice(0, recorded), 0);
    audioBuffer.copyToChannel(bufR.slice(0, recorded), 1);
    slot.bufferL = null;
    slot.bufferR = null;
    slot.writeIdx = 0;
    slot.audioBuffer = audioBuffer;
    // A fresh capture starts with every macro at its own rest value,
    // regardless of whatever an earlier loop on this same pad had - it's new
    // content, an old trim/reverb/pitch wouldn't necessarily mean anything
    // on it.
    slot.startFrac = 0;
    slot.endFrac = 1;
    slot.reverbAmount = 0;
    slot.pitchFrac = 0.5;

    const gain = ctx.createGain(); // fader-controlled volume (this column's SHIFT+fader)
    gain.gain.value = 1;
    routeLoopGain(ctx, padId, gain); // straight to its column, or via the shared reverb if selected
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.loop = true;
    src.playbackRate.value = pitchFracToRate(slot.pitchFrac); // 1.0, neutral - explicit for clarity
    // Into the shared loop bus via this column's gain, not the live fx chain
    // a second time - a loop is a snapshot of whatever was already dialled
    // in at capture time.
    src.connect(gain);
    src.start();
    slot.playback = src;
    slot.gain = gain;

    setPadStatus(padId, 'looping');
    setLoopPlayingFor(padId, true);
    setLoopBank((prev) => [...prev, { padId, durationSeconds: recorded / ctx.sampleRate }]);
  }, [routeLoopGain, setLoopPlayingFor, setPadStatus]);

  /** Starts capturing the fx chain's own output (post-effects, same tap point
   *  peekLevel uses) into a growing buffer for this pad. Only ever called
   *  once the chain is confirmed audible - see startFxForCurrentUrl's probe
   *  success branch and togglePadLooper below. Multiple pads can record at
   *  once, each with its own node and buffer. */
  const beginRecordingPad = useCallback((padId: number) => {
    const chain = chainRef.current;
    if (!chain) { setPadStatus(padId, 'idle'); return; }
    const slot = getOrCreateSlot(padId);
    const ctx = chain.ctx;
    const sr = ctx.sampleRate;
    const maxSamples = Math.floor(sr * LOOPER_MAX_SECONDS);
    slot.bufferL = new Float32Array(maxSamples);
    slot.bufferR = new Float32Array(maxSamples);
    slot.writeIdx = 0;

    // 512, not 4096 - same reasoning as the gate/stutter latency fix: this
    // node's own input-to-output lag would otherwise noticeably delay when
    // recording actually starts capturing relative to the pad press.
    const node = ctx.createScriptProcessor(512, 2, 2);
    const silence = ctx.createGain();
    silence.gain.value = 0;
    // A ScriptProcessorNode only reliably keeps firing onaudioprocess while
    // connected through to the destination - silenced so that connection
    // never becomes a second, unwanted audible copy of the live signal.
    node.connect(silence).connect(ctx.destination);
    chain.recordTap.connect(node);

    node.onaudioprocess = (e) => {
      const bufL = slot.bufferL;
      const bufR = slot.bufferR;
      if (!bufL || !bufR) return;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
      let idx = slot.writeIdx;
      for (let i = 0; i < inL.length && idx < bufL.length; i++, idx++) {
        bufL[idx] = inL[i];
        bufR[idx] = inR[i];
      }
      slot.writeIdx = idx;
      if (idx >= bufL.length) finishRecordingAndLoopPad(padId); // hit the cap - stop on our own
    };

    slot.recordNode = node;
    slot.silence = silence;
    setPadStatus(padId, 'recording');
  }, [finishRecordingAndLoopPad, getOrCreateSlot, setPadStatus]);

  const fallBackToPrimary = useCallback(() => {
    setFxStatus('unavailable');
    applyAudibility();
    // Nothing mid-recording (or waiting to start) can carry on - the station
    // that would have fed it never became audible.
    for (const [padId, status] of loopStatusesRef.current) {
      if (status === 'arming' || status === 'recording') cancelPadRecording(padId);
    }
    armingPadsRef.current.clear();
  }, [applyAudibility, cancelPadRecording, setFxStatus]);

  const startFxForCurrentUrl = useCallback(() => {
    const url = currentUrlRef.current;
    if (!url) return;
    const chain = ensureChain();
    if (!chain) { setFxStatus('unavailable'); return; }
    const fx = ensureFxAudio();
    const token = ++attemptTokenRef.current;
    setFxStatus('starting');
    fx.pause();
    // A handful of stations (SomaFM, NTS) never send the CORS header this
    // element's crossOrigin='anonymous' load needs - fxSourceUrl swaps those
    // specific ones for the proxy, unchanged for everything else. Same
    // audibility probe either way below; the proxy is just a different
    // source, not a different trust level.
    fx.src = fxSourceUrl(url);
    fx.load();

    // A station can fire a perfectly normal 'playing' event while still being
    // CORS-tainted (silently zeroed) through Web Audio specifically — that failure
    // raises no error event at all, so 'playing' alone is not proof of anything.
    // Confirm real signal is actually coming out before muting the primary element;
    // right up until that happens the primary stays audible, so there is never a
    // silent gap even on a station that turns out not to cooperate.
    const probeForRealSignal = async () => {
      for (let i = 0; i < AUDIBILITY_PROBE_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, AUDIBILITY_PROBE_INTERVAL_MS));
        if (attemptTokenRef.current !== token) return; // superseded by a newer attempt
        if ((radioPeekLevelRef.current?.() ?? 0) > AUDIBILITY_THRESHOLD) {
          setFxStatus('active');
          applyAudibility();
          // Any pad pressed before this station's fx stream was confirmed
          // audible is waiting on exactly this moment - start capturing each
          // of them right away rather than needing a second press.
          if (armingPadsRef.current.size > 0) {
            const pads = [...armingPadsRef.current];
            armingPadsRef.current.clear();
            for (const padId of pads) beginRecordingPad(padId);
          }
          return;
        }
      }
      if (attemptTokenRef.current === token) fallBackToPrimary();
    };

    const onPlaying = () => {
      if (attemptTokenRef.current !== token) return; // stale event from an earlier attempt
      void probeForRealSignal();
    };
    const onDrop = () => {
      if (attemptTokenRef.current !== token) return;
      fallBackToPrimary();
    };
    fx.addEventListener('playing', onPlaying, { once: true });
    fx.addEventListener('error', onDrop, { once: true });
    fx.addEventListener('pause', onDrop, { once: true }); // covers a mid-stream drop too

    fx.play().catch(() => { if (attemptTokenRef.current === token) fallBackToPrimary(); });
  }, [applyAudibility, beginRecordingPad, ensureChain, ensureFxAudio, fallBackToPrimary, primaryAudioRef, setFxStatus]);

  /** VOLUME: kills the live station outright - total radio silence. Loops
   *  keep playing regardless, but this is also what flips them over into
   *  loop-fx mode (see applyAudibility/ensureLoopMixBus): faders 1-8 mangle
   *  the loop mix instead of sitting idle while radio's silent. */
  const setRadioMuted = useCallback((muted: boolean) => {
    radioMutedRef.current = muted;
    applyAudibility();
    // Un-muting: a fader can now engage the fx chain (engagedRef becomes
    // true) purely to shape the loop mix while muted, deliberately WITHOUT
    // loading the live radio stream at all (see setEffectAmount) - so
    // fxStatus can still be sitting at 'idle' here even though engagedRef
    // is already true. Without this, un-muting would just leave the radio
    // stuck dry forever: setEffectAmount's own "first touch" guard
    // (!engagedRef.current) never fires again to start it, since it was
    // already tripped by that earlier loop-only touch.
    if (!muted && engagedRef.current && fxStatusRef.current !== 'active' && fxStatusRef.current !== 'starting') {
      startFxForCurrentUrl();
    }
  }, [applyAudibility, startFxForCurrentUrl]);

  /** Restarts an already-looping pad from the beginning without touching its
   *  fader-set volume or its buffer - a fresh AudioBufferSourceNode fed from
   *  the same audioBuffer and connected to the SAME gain node the old one
   *  used (a source can only ever be started once, so retriggering always
   *  means a new one, but reusing the gain node means the fader position
   *  survives untouched). Keeps looping from there exactly as before. */
  const retriggerLoopPad = useCallback((padId: number) => {
    const slot = loopSlotsRef.current.get(padId);
    if (!slot?.audioBuffer || !slot.gain) return;
    if (slot.playback) {
      try { slot.playback.stop(); } catch { /* already stopped */ }
      slot.playback.disconnect();
    }
    const src = slot.gain.context.createBufferSource();
    src.buffer = slot.audioBuffer;
    src.loop = true;
    src.loopStart = slot.startFrac * slot.audioBuffer.duration;
    src.loopEnd = slot.endFrac * slot.audioBuffer.duration;
    src.playbackRate.value = pitchFracToRate(slot.pitchFrac);
    src.connect(slot.gain);
    // Offset by loopStart, not the plain 0 default - otherwise the very first
    // playthrough after a retrigger would play the untrimmed head of the
    // buffer once before ever reaching the trimmed loop region.
    src.start(0, src.loopStart);
    slot.playback = src;
    setLoopPlayingFor(padId, true);
  }, [setLoopPlayingFor]);

  /** SHIFT + a looping pad, once a tap is confirmed (see looperPadPress): a
   *  toggle, not a one-shot stop. Playing -> stops it dead without clearing
   *  anything (the buffer and its fader-controlled gain node both stay
   *  exactly as they are, only the currently-running source gets torn down).
   *  Stopped -> starts it again from the top (retriggerLoopPad - there's no
   *  "paused position" to resume from once the source is torn down, so
   *  resuming and retriggering are the same thing here). Repeatable: keep
   *  SHIFT held and keep pressing the same pad to flip it back and forth. */
  const stopLoopPad = useCallback((padId: number) => {
    if (loopStatusesRef.current.get(padId) !== 'looping') return;
    const playing = loopPlayingRef.current.get(padId) ?? true;
    if (!playing) {
      retriggerLoopPad(padId);
      return;
    }
    const slot = loopSlotsRef.current.get(padId);
    if (slot?.playback) {
      try { slot.playback.stop(); } catch { /* already stopped */ }
      slot.playback.disconnect();
      slot.playback = null;
    }
    setLoopPlayingFor(padId, false);
  }, [retriggerLoopPad, setLoopPlayingFor]);

  /** A looper pad's press. Three different things can happen, and only one
   *  of them - the plain already-looping case - still acts immediately:
   *
   *  - idle/arming: unchanged, starts recording (or waits to) exactly as
   *    before; SHIFT does nothing here, it only ever means something for a
   *    pad that already has something on it.
   *  - recording: used to commit on press immediately, with a hold
   *    afterward able to clear the loop it had just committed. Now it
   *    doesn't commit on press at all - it waits: tap it (release before the
   *    hold fires) and it commits, same as before; HOLD it and the whole
   *    take is thrown away outright (cancelPadRecording, never becoming a
   *    loop at all), rather than briefly becoming one and then getting
   *    cleared a moment later.
   *  - looping, SHIFT not held: unchanged, retriggers from the start right
   *    away - it should feel instant, like hitting a drum pad - while a hold
   *    timer runs in parallel with nothing to do on a confirmed tap (the
   *    retrigger already happened); if the hold fires, clearLoopPad wins,
   *    tearing back down what was just retriggered.
   *  - looping, SHIFT held: doesn't retrigger OR stop anything on press any
   *    more. Tap it and it toggles play/stop on release, same as it always
   *    did; HOLD it and it clears outright instead, without ever having to
   *    make a stopped pad audible again just to reach the hold - the whole
   *    point of this case existing.
   *
   *  See looperPadRelease for the tap half of the last two. */
  const looperPadPress = useCallback((padId: number, shiftHeld: boolean) => {
    selectLoopPad(padId); // this pad is now the edit target for SHIFT+fader 5-8
    const status = loopStatusesRef.current.get(padId) ?? 'idle';
    switch (status) {
      case 'recording': {
        const timer = setTimeout(() => {
          holdTimersRef.current.delete(padId);
          cancelPadRecording(padId);
        }, HOLD_TO_CLEAR_MS);
        holdTimersRef.current.set(padId, { timer, onTapConfirmed: () => finishRecordingAndLoopPad(padId) });
        return;
      }
      case 'looping': {
        if (shiftHeld) {
          const timer = setTimeout(() => {
            holdTimersRef.current.delete(padId);
            clearLoopPad(padId);
          }, HOLD_TO_CLEAR_MS);
          holdTimersRef.current.set(padId, { timer, onTapConfirmed: () => stopLoopPad(padId) });
          return;
        }
        retriggerLoopPad(padId);
        const timer = setTimeout(() => {
          holdTimersRef.current.delete(padId);
          clearLoopPad(padId);
        }, HOLD_TO_CLEAR_MS);
        holdTimersRef.current.set(padId, { timer });
        return;
      }
      case 'arming':
        return; // already waiting on engagement, ignore a repeat press
      case 'idle':
        if (shiftHeld) return; // SHIFT+pad only ever means something for a pad with something on it
        // Recording is safe to start immediately - no need to wait on
        // armingPadsRef's usual "confirm the radio is actually audible
        // first" handshake - whenever recordTap is already carrying real,
        // ready-now signal: either the radio's own fx is confirmed active as
        // always, OR the radio's muted, meaning recordTap carries the loop
        // mix through the SAME chain instead (loop-fx mode, see
        // applyAudibility) - that's already live and synchronous the moment
        // the chain exists, no network buffering to wait on the way a fresh
        // radio stream load has. This is the resample gesture: press any
        // spare pad while mangling loops with the radio muted to capture the
        // mangled mix onto it, same press-to-record/press-to-commit motion
        // as recording off the radio.
        if (chainRef.current && (fxStatusRef.current === 'active' || radioMutedRef.current)) {
          beginRecordingPad(padId);
        } else {
          // recordTap only carries real signal once the chain is confirmed
          // audible - engage it first (same handshake a fader touch would
          // trigger) and record automatically the instant that succeeds.
          armingPadsRef.current.add(padId);
          setPadStatus(padId, 'arming');
          engagedRef.current = true;
          startFxForCurrentUrl();
        }
        return;
    }
  }, [beginRecordingPad, cancelPadRecording, clearLoopPad, finishRecordingAndLoopPad, retriggerLoopPad, selectLoopPad, setPadStatus, startFxForCurrentUrl, stopLoopPad]);

  /** Release resolves whatever looperPadPress deferred: if the hold timer it
   *  started already fired, it's done its own thing and there's nothing left
   *  to do here (the map entry is already gone by the time release happens).
   *  Otherwise this was a tap - cancel the timer and run onTapConfirmed if
   *  the press left one (recording -> commit it; SHIFT+looping -> toggle
   *  play/stop). No onTapConfirmed (the plain already-looping case) means
   *  the tap's own action already happened on press, nothing more to do. A
   *  release with no pending timer at all (idle/arming presses never start
   *  one) is a no-op. */
  const looperPadRelease = useCallback((padId: number) => {
    const pending = holdTimersRef.current.get(padId);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    holdTimersRef.current.delete(padId);
    pending.onTapConfirmed?.();
  }, []);

  /** Call whenever the primary element's station changes (same moment .src is set
   *  on it). Keeps the fx element following along once the user has opted in. */
  const syncStation = useCallback((url: string) => {
    currentUrlRef.current = url;
    // Invalidate any in-flight attempt from the previous station FIRST: the pause()
    // just below would otherwise fire that attempt's still-armed 'pause' listener,
    // which falls back instantly and defeats the graceful fade started right after.
    ++attemptTokenRef.current;
    // Stop feeding the old station into the chain right away (pausing the element
    // silences its dry signal immediately) but let the effects' own output fade
    // out over TAIL_FADE_SECONDS rather than cutting instantly: a delay or reverb
    // tail that was mid-decay keeps ringing out and fading naturally underneath
    // the new station coming in on the primary, instead of being chopped off.
    // If a new fx attempt below confirms real signal before the fade finishes,
    // its own fast ramp-up simply overtakes this one.
    fxAudioRef.current?.pause();
    if (!radioMutedRef.current) chainRef.current?.setActive(false, TAIL_FADE_SECONDS);
    // Carries radioMuted through the station change rather than unmuting
    // unconditionally - a muted radio should stay muted on the next station
    // too, until VOLUME is pressed again.
    if (primaryAudioRef.current) primaryAudioRef.current.muted = radioMutedRef.current;

    // Committed loops are self-contained buffers with their effects already
    // baked in - they have no dependency on the station that made them, so a
    // station change leaves them playing right through it, deliberately.
    // Only genuinely in-flight captures (still tapping the now-changing live
    // signal) get cancelled - they'd otherwise start recording the wrong
    // thing.
    for (const [padId, status] of loopStatusesRef.current) {
      if (status === 'arming' || status === 'recording') cancelPadRecording(padId);
    }
    armingPadsRef.current.clear();

    // Every station starts on a clean mix: reset every fader's PRIMARY amount back
    // to its own rest value rather than carrying whatever was dialled in for the
    // last one. Rest value, not a hardcoded 0 — filter's bypass point is its
    // fader's centre, not its bottom, so resetting it to 0 would land on a hard
    // highpass instead of silence. Runtime-only: this doesn't touch localStorage,
    // so a fresh page load still comes back at the last deliberately-set levels;
    // it's specifically an active mix riding across a station change that gets
    // cleared, not the remembered defaults. The physical faders obviously don't
    // move (nothing here is motorised), so a fader left up will disagree with the
    // software's now-reset idea of it until it's touched again — normal for this
    // class of controller.
    //
    // Secondary parameters (dub delay's feedback, fader 8) are deliberately NOT
    // reset here. Feedback isn't a wet/dry mix, it's the decay rate of whatever's
    // currently in the loop — zeroing it the instant a station changes stops the
    // loop regenerating, so at most one more echo plays before silence, killing
    // the trail almost immediately instead of letting it decay over several
    // seconds the way TAIL_FADE_SECONDS below is meant to allow. Leaving it alone
    // matches where the physical fader actually is anyway.
    //
    // All of this is skipped entirely while the radio's muted: these are the
    // SAME 8 faders shaping the loop mix instead whenever that's the case
    // (loop-fx mode, see applyAudibility), and switching stations - which the
    // user may still be doing while mangling loops, radio muted throughout -
    // has nothing to do with that mix. Resetting it out from under them here,
    // just because a station happened to change, would wipe a loop-fx setup
    // they're actively using for no reason connected to the station itself.
    if (!radioMutedRef.current) {
      for (const id of EFFECT_ORDER) {
        amountsRef.current[id] = EFFECT_REST_VALUE[id];
        chainRef.current?.setAmount(id, EFFECT_REST_VALUE[id]);
      }
      engagedRef.current = false;
      setFxStatus('idle');
    }
  }, [cancelPadRecording, primaryAudioRef, setFxStatus]);

  /** Call alongside the primary's own pause/resume so fx doesn't keep streaming
   *  silently in the background, and picks back up on resume. */
  const setPaused = useCallback((paused: boolean) => {
    if (paused) {
      ++attemptTokenRef.current; // same reasoning as syncStation: invalidate before pause() fires 'pause'
      fxAudioRef.current?.pause();
      // Same reasoning as syncStation's station-switch fade: a delay trail that
      // was mid-decay should keep ringing out on its own physics after SHIFT
      // pauses playback, not get cut the instant the fader-controlled send stops
      // feeding it. Without the slow ramp here this used the fast 0.03s default,
      // which is what made an active delay trail vanish the moment you paused.
      if (!radioMutedRef.current) chainRef.current?.setActive(false, TAIL_FADE_SECONDS);
      // Anything mid-recording (or waiting to start) would just be capturing
      // silence from here on - cancel it. Already-committed loops are left
      // alone: they're independent buffers by that point, not tied to the
      // live stream's own pause state, so there's no reason for this to
      // interrupt them.
      for (const [padId, status] of loopStatusesRef.current) {
        if (status === 'arming' || status === 'recording') cancelPadRecording(padId);
      }
      armingPadsRef.current.clear();
    } else if (engagedRef.current) {
      startFxForCurrentUrl();
    }
  }, [cancelPadRecording, startFxForCurrentUrl]);

  const setEffectAmount = useCallback((id: EffectId, value: number) => {
    const v = Math.min(1, Math.max(0, value));
    amountsRef.current[id] = v;
    saveAmount(id, v);
    chainRef.current?.setAmount(id, v);
    // Distance from THIS effect's own rest value, not from 0 — filter rests at
    // 0.5, so almost any fader position would count as "touched" under a flat
    // v > 0.001 check even with the fader untouched at its own bypass point.
    if (!engagedRef.current && Math.abs(v - EFFECT_REST_VALUE[id]) > 0.001) {
      engagedRef.current = true;
      if (radioMutedRef.current) {
        // Radio's muted, so these faders are shaping the loop mix instead
        // (loop-fx mode, see applyAudibility) - there's no reason to spin up
        // a live radio stream in the background just to keep it silently
        // muted. ensureChain() alone gets the shared fx graph running (it
        // already applies amountsRef, same as startFxForCurrentUrl would via
        // ensureChain internally) without touching the radio element -
        // applyAudibility right after covers the one edge case this skips
        // past: the chain being brand new here (no loop recorded yet to have
        // triggered it earlier), which otherwise leaves its own masterGain
        // sitting closed with nothing yet having opened it.
        if (ensureChain()) applyAudibility(); else setFxStatus('unavailable');
      } else {
        startFxForCurrentUrl();
      }
    }
  }, [applyAudibility, ensureChain, setFxStatus, startFxForCurrentUrl]);

  // Deliberately doesn't trigger engagement the way setEffectAmount does: touching
  // dub delay's feedback alone, before its own wet fader has ever been raised,
  // wouldn't be audible anyway (there's nothing in the wet path to feed back), so
  // spinning up the fx stream for it would just waste bandwidth for no audible
  // difference. Still recorded and persisted, so it's there the moment the primary
  // fader does engage.
  const setEffectSecondary = useCallback((id: EffectId, value: number) => {
    const v = Math.min(1, Math.max(0, value));
    secondaryAmountsRef.current[id] = v;
    saveSecondary(id, v);
    chainRef.current?.setSecondary(id, v);
  }, []);

  /** SHIFT + DEVICE: a deliberate full reset, every fx fader (primary AND
   *  secondary, so this also kills a delay's feedback rather than leaving it
   *  regenerating) back to its own rest/bypass value. Unlike syncStation's
   *  own quieter per-station reset, this touches localStorage too via
   *  setEffectAmount/setEffectSecondary - you asked for it outright, it
   *  should stick, not just apply to the current station. */
  const resetAllFx = useCallback(() => {
    for (const id of EFFECT_ORDER) {
      setEffectAmount(id, EFFECT_REST_VALUE[id]);
      setEffectSecondary(id, EFFECT_SECONDARY_REST_VALUE[id] ?? 0);
    }
  }, [setEffectAmount, setEffectSecondary]);

  // The master volume fader only ever set the primary element's .volume. Once fx
  // takes over as the audible source that had no effect at all on what you could
  // actually hear — the fx element's own volume was never touched. Element .volume
  // is applied to the decoded audio before it reaches the Web Audio graph, so
  // mirroring it here is enough; no gain node needed. Loops are deliberately left
  // out of this - they run through their own gain/bus, not the fx element, so the
  // master fader only ever affects live radio, matching how it always worked.
  const setVolume = useCallback((v: number) => {
    if (fxAudioRef.current) fxAudioRef.current.volume = Math.min(1, Math.max(0, v));
  }, []);

  return {
    syncStation, setPaused, setEffectAmount, setEffectSecondary, resetAllFx, setVolume, fxStatus,
    looperPadPress, looperPadRelease, loopStatuses, loopPlaying, loopBank, getLoopBuffer,
    setLoopsMuted, setRadioMuted, setFxMuted, setLoopFaderVolume, resetSelectedLoopMacro,
  };
}
