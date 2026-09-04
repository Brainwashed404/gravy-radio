import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  createEffectsChain,
  EFFECT_ORDER,
  EFFECT_REST_VALUE,
  EFFECT_SECONDARY_REST_VALUE,
  type EffectId,
  type EffectsChain,
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
}

export function useFxAudioBridge(primaryAudioRef: RefObject<HTMLAudioElement | null>) {
  const fxAudioRef = useRef<HTMLAudioElement | null>(null);
  const chainRef = useRef<EffectsChain | null>(null);
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
        playback: null, gain: null, audioBuffer: null,
      };
      loopSlotsRef.current.set(padId, slot);
    }
    return slot;
  }, []);

  /** Pads waiting on the fx chain to become audible before they can start
   *  recording (mirrors the old single-pad looperArmedRef, just a set now
   *  since more than one pad can be pressed before that happens). */
  const armingPadsRef = useRef<Set<number>>(new Set());

  /** Pending "is this press a hold?" timers for pads currently mid-press
   *  while already looping - see looperPadPress/looperPadRelease. */
  const holdTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  /** One persistent gain node per column (padId % 4), each fed by every
   *  looping pad in that column and feeding the shared loop bus in turn -
   *  this is what SHIFT+fader 1-4 actually controls. Created lazily, same
   *  pattern as the bus itself. */
  const columnGainsRef = useRef<(GainNode | null)[]>(new Array(LOOP_COLUMNS).fill(null));

  /** Every committed loop sums into this one bus, which goes straight to
   *  destination - loops bypass the live fx chain entirely, since their
   *  effects are already baked in at record time. Also doubles as the "mute
   *  loops" control (PAN): one gain ramp silences every loop at once without
   *  touching any individual loop's own volume. */
  const loopMixBusRef = useRef<GainNode | null>(null);
  const loopsMutedRef = useRef(false);
  const ensureLoopMixBus = useCallback((ctx: AudioContext): GainNode => {
    if (loopMixBusRef.current) return loopMixBusRef.current;
    const bus = ctx.createGain();
    bus.gain.value = loopsMutedRef.current ? 0 : 1;
    bus.connect(ctx.destination);
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

  const radioMutedRef = useRef(false); // VOLUME: live radio silenced outright
  const fxMutedRef = useRef(false); // DEVICE: dry radio, fx chain's processed output silenced

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
      const chain = createEffectsChain(ctx, source);
      for (const id of EFFECT_ORDER) {
        chain.setAmount(id, amountsRef.current[id]);
        chain.setSecondary(id, secondaryAmountsRef.current[id]);
      }
      chainRef.current = chain;
      chain.resume();
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
   *  any pending hold-to-clear timer for it (harmless if there wasn't one). */
  const clearLoopPad = useCallback((padId: number) => {
    const timer = holdTimersRef.current.get(padId);
    if (timer !== undefined) { clearTimeout(timer); holdTimersRef.current.delete(padId); }
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

  /** Single source of truth for what the primary element and the fx chain's
   *  own gain should be doing right now, given the three things that can
   *  each override the plain "fx engaged or not" state: radioMuted (VOLUME)
   *  wins outright - total silence from the radio side, loops keep playing
   *  regardless of anything else. Otherwise fxMuted (DEVICE) or simply not
   *  being engaged yet both mean dry, unprocessed radio. Only when neither
   *  override is active and fx is genuinely engaged does the fx chain's own
   *  processed output actually play. Called after any change to fxStatus,
   *  radioMutedRef or fxMutedRef, instead of each call site hand-rolling its
   *  own primary.muted/chain.setActive combination - that's what used to let
   *  a newly-confirmed fx engagement quietly stomp an active mute. */
  const applyAudibility = useCallback(() => {
    const primary = primaryAudioRef.current;
    const chain = chainRef.current;
    // primary and the fx chain are two independently-buffered copies of the
    // exact same live stream, not phase-aligned with each other - any window
    // where both are audible at once (even briefly) beats against itself and
    // sounds like skipping/jitter, not a clean crossfade. primary.muted flips
    // instantly (a plain property set), so the chain's own gain needs to
    // switch essentially as fast, not the multi-hundred-ms ramp used
    // elsewhere for actually-different content (see TAIL_FADE_SECONDS).
    // AUDIBILITY_SWITCH_RAMP is just enough to avoid a hard-cut click, far
    // too short for the overlap to be perceptible as doubled audio.
    if (radioMutedRef.current) {
      if (primary) primary.muted = true;
      chain?.setActive(false, AUDIBILITY_SWITCH_RAMP);
      return;
    }
    if (fxMutedRef.current || fxStatusRef.current !== 'active') {
      if (primary) primary.muted = false;
      chain?.setActive(false, AUDIBILITY_SWITCH_RAMP);
      return;
    }
    if (primary) primary.muted = true;
    chain?.setActive(true, AUDIBILITY_SWITCH_RAMP);
  }, [primaryAudioRef]);

  /** VOLUME: kills the live station outright - total radio silence, loops
   *  (on their own separate bus) keep playing regardless. */
  const setRadioMuted = useCallback((muted: boolean) => {
    radioMutedRef.current = muted;
    applyAudibility();
  }, [applyAudibility]);

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
   *  are currently looping. Faders 5-8 (slotIndex 4-7) are unused now - no-op. */
  const setLoopFaderVolume = useCallback((slotIndex: number, value: number) => {
    if (slotIndex < 0 || slotIndex >= LOOP_COLUMNS) return;
    const g = columnGainsRef.current[slotIndex];
    if (g) g.gain.value = Math.min(1, Math.max(0, value));
  }, []);

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

    const columnGain = ensureColumnGain(ctx, padId % LOOP_COLUMNS);
    const gain = ctx.createGain(); // fader-controlled volume (this column's SHIFT+fader)
    gain.gain.value = 1;
    gain.connect(columnGain);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.loop = true;
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
  }, [ensureColumnGain, setLoopPlayingFor, setPadStatus]);

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
        if (chain.peekLevel() > AUDIBILITY_THRESHOLD) {
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
    src.connect(slot.gain);
    src.start();
    slot.playback = src;
    setLoopPlayingFor(padId, true);
  }, [setLoopPlayingFor]);

  /** SHIFT + a looping pad: stops it dead without clearing it - the buffer
   *  and its fader-controlled gain node both stay exactly as they are, only
   *  the currently-running source gets torn down. A plain press afterward
   *  (retriggerLoopPad) starts it playing again from the top, same as it
   *  would from any other stopped-but-loaded state. Distinct from
   *  clearLoopPad (hold 1s+), which throws the recording away entirely. */
  const stopLoopPad = useCallback((padId: number) => {
    if (loopStatusesRef.current.get(padId) !== 'looping') return;
    const slot = loopSlotsRef.current.get(padId);
    if (slot?.playback) {
      try { slot.playback.stop(); } catch { /* already stopped */ }
      slot.playback.disconnect();
      slot.playback = null;
    }
    setLoopPlayingFor(padId, false);
  }, [setLoopPlayingFor]);

  /** A looper pad's press: idle arms/records, recording commits and starts
   *  looping - both unchanged, act immediately on press. An already-looping
   *  pad retriggers from the start right away too - it should feel instant,
   *  like hitting a drum pad - while a hold timer runs in parallel to catch
   *  a long press; if that fires, looperPadRelease's cancellation never
   *  happens and clearLoopPad wins, wiping out whatever the retrigger just
   *  started. Volume/muting a loop is the column's SHIFT+fader's job, not
   *  the pad's - there's no separate on/off gesture here any more. */
  const looperPadPress = useCallback((padId: number) => {
    const status = loopStatusesRef.current.get(padId) ?? 'idle';
    switch (status) {
      case 'recording':
        finishRecordingAndLoopPad(padId);
        return;
      case 'looping': {
        retriggerLoopPad(padId);
        const timer = setTimeout(() => {
          holdTimersRef.current.delete(padId);
          clearLoopPad(padId);
        }, HOLD_TO_CLEAR_MS);
        holdTimersRef.current.set(padId, timer);
        return;
      }
      case 'arming':
        return; // already waiting on engagement, ignore a repeat press
      case 'idle':
        if (fxStatusRef.current === 'active' && chainRef.current) {
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
  }, [beginRecordingPad, clearLoopPad, finishRecordingAndLoopPad, retriggerLoopPad, setPadStatus, startFxForCurrentUrl]);

  /** Release just cancels the hold-to-clear timer if the press above started
   *  one (i.e. it was a tap, not a hold that ran past HOLD_TO_CLEAR_MS) -
   *  the retrigger itself already happened on press, there's nothing left to
   *  do here. A release with no pending timer (idle/recording/arming presses
   *  never start one) is a no-op. */
  const looperPadRelease = useCallback((padId: number) => {
    const timer = holdTimersRef.current.get(padId);
    if (timer === undefined) return;
    clearTimeout(timer);
    holdTimersRef.current.delete(padId);
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
    for (const id of EFFECT_ORDER) {
      amountsRef.current[id] = EFFECT_REST_VALUE[id];
      chainRef.current?.setAmount(id, EFFECT_REST_VALUE[id]);
    }
    engagedRef.current = false;
    setFxStatus('idle');
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
      startFxForCurrentUrl();
    }
  }, [startFxForCurrentUrl]);

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
    looperPadPress, looperPadRelease, stopLoopPad, loopStatuses, loopPlaying, loopBank, getLoopBuffer,
    setLoopsMuted, setRadioMuted, setFxMuted, setLoopFaderVolume,
  };
}
