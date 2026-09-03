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
 *  buffer. looping: captured buffer is playing back on repeat, live station
 *  silenced underneath it. */
export type LooperStatus = 'idle' | 'arming' | 'recording' | 'looping';

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

/** Hard cap on a loop's length. 30s comfortably covers a break, a vocal
 *  snippet, a drum hit - the kind of thing this is for - without letting a
 *  forgotten recording grow unbounded (stereo Float32 at 44.1kHz: 30s is
 *  about 10.6MB, negligible; there just needs to be SOME ceiling). */
const LOOPER_MAX_SECONDS = 30;
/** Below this, a "recording" is almost certainly an accidental double-tap
 *  rather than a real capture - cancel back to idle instead of looping a
 *  near-silent sliver. */
const LOOPER_MIN_SAMPLES_FACTOR = 0.1; // seconds

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
  const [fxStatus, setFxStatus] = useState<FxStatus>('idle');

  // ─── Looper ────────────────────────────────────────────────────────────────
  const [looperStatus, setLooperStatusState] = useState<LooperStatus>('idle');
  const looperStatusRef = useRef<LooperStatus>('idle');
  const setLooperStatus = useCallback((s: LooperStatus) => {
    looperStatusRef.current = s;
    setLooperStatusState(s);
  }, []);
  const looperArmedRef = useRef(false); // pad pressed while fx wasn't active yet; record once it is
  const looperRecordNodeRef = useRef<ScriptProcessorNode | null>(null);
  const looperSilenceRef = useRef<GainNode | null>(null); // keeps the record node's process event firing without being audible
  const looperBufferLRef = useRef<Float32Array | null>(null);
  const looperBufferRRef = useRef<Float32Array | null>(null);
  const looperWriteIdxRef = useRef(0);
  const looperPlaybackRef = useRef<AudioBufferSourceNode | null>(null);

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

  /** Tears down whatever the looper is mid-doing (armed or actively
   *  recording) without saving anything, back to idle. Not used for clearing
   *  a completed loop that's already playing - see clearLoop for that. */
  const cancelLooperRecording = useCallback(() => {
    looperArmedRef.current = false;
    if (looperRecordNodeRef.current) {
      chainRef.current?.recordTap.disconnect(looperRecordNodeRef.current);
      looperRecordNodeRef.current.disconnect();
      looperRecordNodeRef.current.onaudioprocess = null;
      looperRecordNodeRef.current = null;
    }
    looperSilenceRef.current?.disconnect();
    looperSilenceRef.current = null;
    looperBufferLRef.current = null;
    looperBufferRRef.current = null;
    looperWriteIdxRef.current = 0;
    if (looperStatusRef.current !== 'idle') setLooperStatus('idle');
  }, [setLooperStatus]);

  /** Stops a completed loop's playback and returns to idle. */
  const clearLoop = useCallback(() => {
    if (looperPlaybackRef.current) {
      try { looperPlaybackRef.current.stop(); } catch { /* already stopped */ }
      looperPlaybackRef.current.disconnect();
      looperPlaybackRef.current = null;
    }
    // Bring the live fx chain back - it kept updating in the background the
    // whole time the loop was playing (fader moves still landed on it, just
    // silenced), so this is a plain unmute, not a fresh engagement.
    chainRef.current?.setActive(true);
    setLooperStatus('idle');
  }, [setLooperStatus]);

  /** Turns whatever got captured into a looping AudioBufferSourceNode and
   *  silences the live continuation underneath it. Also the auto-stop path
   *  when a recording hits LOOPER_MAX_SECONDS - see beginRecording. */
  const finishRecordingAndLoop = useCallback(() => {
    const chain = chainRef.current;
    const node = looperRecordNodeRef.current;
    const bufL = looperBufferLRef.current;
    const bufR = looperBufferRRef.current;
    const recorded = looperWriteIdxRef.current;
    if (node) {
      chain?.recordTap.disconnect(node);
      node.disconnect();
      node.onaudioprocess = null;
      looperRecordNodeRef.current = null;
    }
    looperSilenceRef.current?.disconnect();
    looperSilenceRef.current = null;

    if (!chain || !bufL || !bufR || recorded < chain.ctx.sampleRate * LOOPER_MIN_SAMPLES_FACTOR) {
      // Too short to be a deliberate capture (an accidental double-tap) -
      // cancel back to idle rather than looping a near-silent sliver.
      looperBufferLRef.current = null;
      looperBufferRRef.current = null;
      looperWriteIdxRef.current = 0;
      setLooperStatus('idle');
      return;
    }

    const ctx = chain.ctx;
    const audioBuffer = ctx.createBuffer(2, recorded, ctx.sampleRate);
    // .slice(), not .subarray(): copyToChannel wants a Float32Array backed by
    // a real ArrayBuffer specifically, which a plain subarray view doesn't
    // type-check as (a TS lib quirk, not a functional issue) - slice() also
    // conveniently decouples this from the recording buffer we're about to
    // null out below anyway.
    audioBuffer.copyToChannel(bufL.slice(0, recorded), 0);
    audioBuffer.copyToChannel(bufR.slice(0, recorded), 1);
    looperBufferLRef.current = null;
    looperBufferRRef.current = null;
    looperWriteIdxRef.current = 0;

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.loop = true;
    // Straight to destination, deliberately not back through the effects
    // chain - a loop is a snapshot of whatever was already dialled in at
    // capture time, not something to reprocess a second time. Independent of
    // the chain's own masterGain, so the chain's own state (or the primary
    // element pausing) never touches a loop that's already playing.
    src.connect(ctx.destination);
    src.start();
    looperPlaybackRef.current = src;

    // Silence the live continuation underneath it - the loop replaces what
    // you'd otherwise be hearing rather than layering on top of it.
    chain.setActive(false, 0.05);
    setLooperStatus('looping');
  }, [setLooperStatus]);

  /** Starts capturing the fx chain's own output (post-effects, same tap point
   *  peekLevel uses) into a growing buffer. Only ever called once the chain
   *  is confirmed audible - see startFxForCurrentUrl's probe success branch
   *  and toggleLooperPad below. */
  const beginRecording = useCallback(() => {
    const chain = chainRef.current;
    if (!chain) { setLooperStatus('idle'); return; }
    const ctx = chain.ctx;
    const sr = ctx.sampleRate;
    const maxSamples = Math.floor(sr * LOOPER_MAX_SECONDS);
    looperBufferLRef.current = new Float32Array(maxSamples);
    looperBufferRRef.current = new Float32Array(maxSamples);
    looperWriteIdxRef.current = 0;

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
      const bufL = looperBufferLRef.current;
      const bufR = looperBufferRRef.current;
      if (!bufL || !bufR) return;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
      let idx = looperWriteIdxRef.current;
      for (let i = 0; i < inL.length && idx < bufL.length; i++, idx++) {
        bufL[idx] = inL[i];
        bufR[idx] = inR[i];
      }
      looperWriteIdxRef.current = idx;
      if (idx >= bufL.length) finishRecordingAndLoop(); // hit the cap - stop on our own
    };

    looperRecordNodeRef.current = node;
    looperSilenceRef.current = silence;
    setLooperStatus('recording');
  }, [finishRecordingAndLoop, setLooperStatus]);

  const fallBackToPrimary = useCallback(() => {
    chainRef.current?.setActive(false);
    if (primaryAudioRef.current) primaryAudioRef.current.muted = false;
    setFxStatus('unavailable');
    // The looper can't record from a station that never became audible - if
    // it was waiting on (or mid-way through, if the stream dropped) this
    // engagement, there's nothing left to record from.
    if (looperStatusRef.current === 'arming' || looperStatusRef.current === 'recording') {
      cancelLooperRecording();
    }
  }, [cancelLooperRecording, primaryAudioRef]);

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
          chain.setActive(true);
          if (primaryAudioRef.current) primaryAudioRef.current.muted = true;
          setFxStatus('active');
          // If the looper pad was pressed before this station's fx stream
          // was confirmed audible, this is the moment it actually can be -
          // start capturing right away rather than needing a second press.
          if (looperArmedRef.current) {
            looperArmedRef.current = false;
            beginRecording();
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
  }, [beginRecording, ensureChain, ensureFxAudio, fallBackToPrimary, primaryAudioRef]);

  /** The looper pad's single entry point: what it does depends entirely on
   *  looperStatus, cycling idle -> (arming ->) recording -> looping -> idle. */
  const toggleLooperPad = useCallback(() => {
    switch (looperStatusRef.current) {
      case 'recording':
        finishRecordingAndLoop();
        return;
      case 'looping':
        clearLoop();
        return;
      case 'arming':
        return; // already waiting on engagement, ignore a repeat press
      case 'idle':
        if (fxStatus === 'active' && chainRef.current) {
          beginRecording();
        } else {
          // recordTap only carries real signal once the chain is confirmed
          // audible - engage it first (same handshake a fader touch would
          // trigger) and record automatically the instant that succeeds.
          looperArmedRef.current = true;
          setLooperStatus('arming');
          engagedRef.current = true;
          startFxForCurrentUrl();
        }
        return;
    }
  }, [beginRecording, clearLoop, finishRecordingAndLoop, fxStatus, setLooperStatus, startFxForCurrentUrl]);

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
    chainRef.current?.setActive(false, TAIL_FADE_SECONDS);
    if (primaryAudioRef.current) primaryAudioRef.current.muted = false;

    // Same "clean mix" principle extended to the looper: a loop already
    // playing would otherwise keep going forever regardless of what station
    // is now selected, and a recording in progress would start capturing the
    // wrong (fading-out, soon silent) station instead of the new one.
    if (looperStatusRef.current === 'looping') clearLoop();
    else if (looperStatusRef.current === 'arming' || looperStatusRef.current === 'recording') cancelLooperRecording();

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
  }, [cancelLooperRecording, clearLoop, primaryAudioRef]);

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
      chainRef.current?.setActive(false, TAIL_FADE_SECONDS);
      // A recording in progress would just be capturing silence from here on
      // - cancel it. A loop already playing is left alone: it's an
      // independent buffer by that point, not tied to the live stream's own
      // pause state, so there's no reason for SHIFT to interrupt it.
      if (looperStatusRef.current === 'arming' || looperStatusRef.current === 'recording') {
        cancelLooperRecording();
      }
    } else if (engagedRef.current) {
      startFxForCurrentUrl();
    }
  }, [cancelLooperRecording, startFxForCurrentUrl]);

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

  // The master volume fader only ever set the primary element's .volume. Once fx
  // takes over as the audible source that had no effect at all on what you could
  // actually hear — the fx element's own volume was never touched. Element .volume
  // is applied to the decoded audio before it reaches the Web Audio graph, so
  // mirroring it here is enough; no gain node needed.
  const setVolume = useCallback((v: number) => {
    if (fxAudioRef.current) fxAudioRef.current.volume = Math.min(1, Math.max(0, v));
  }, []);

  return {
    syncStation, setPaused, setEffectAmount, setEffectSecondary, setVolume, fxStatus,
    toggleLooperPad, looperStatus,
  };
}
