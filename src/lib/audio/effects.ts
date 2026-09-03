// Live effects chain for the radio stream. Pure Web Audio, no React here.
//
// Each effect is a small factory returning { input, output, setAmount }: a single
// 0-1 knob per effect, matching one APC mini fader each. Every effect must have a
// true transparent bypass (unity gain, no coloration) SOMEWHERE in its 0-1 range —
// that's what keeps the app sounding identical to today for anyone not touching the
// faders — but that point is 0 for six of the seven and 0.5 for filter. See
// EFFECT_REST_VALUE below rather than assuming 0 universally.
//
// ScriptProcessorNode is used for beat repeat rather than an AudioWorklet. It's
// deprecated but universally supported and far simpler to reason about; worklets
// need an async module load (workable via a Blob URL, but adds a failure mode with
// no real upside for a non-latency-critical effect like this).

export type EffectId =
  | 'filter'
  | 'phaser'
  | 'flanger'
  | 'gate'
  | 'beatRepeat'
  | 'pingPongDelay'
  | 'dubDelay';

// Signal chain order matches the fader order left to right on the hardware.
export const EFFECT_ORDER: EffectId[] = [
  'filter', 'phaser', 'flanger', 'gate', 'beatRepeat', 'pingPongDelay', 'dubDelay',
];

export const EFFECT_LABELS: Record<EffectId, string> = {
  filter: 'Filter',
  phaser: 'Phaser',
  flanger: 'Flanger',
  gate: 'Gate',
  beatRepeat: 'Beat repeat',
  pingPongDelay: 'Ping pong delay',
  dubDelay: 'Dub delay',
};

/** Where each effect's fader has to sit to be a true bypass. 0 for everything
 *  except filter, which sweeps highpass below its centre and lowpass above it —
 *  the DJ-mixer convention, wide open at the middle rather than at either end.
 *  Anything that wants to "reset to a clean mix" (station changes, first load
 *  with nothing saved yet) needs this, not a hardcoded 0, or filter would reset
 *  into a hard highpass instead of silence. */
export const EFFECT_REST_VALUE: Record<EffectId, number> = {
  filter: 0.5,
  phaser: 0,
  flanger: 0,
  gate: 0,
  beatRepeat: 0,
  pingPongDelay: 0,
  dubDelay: 0,
};

/** Rest value for each effect's optional secondary parameter (see setSecondary on
 *  EffectUnit). Only dub delay has one right now (its feedback, fader 8). This is
 *  NOT 0: with feedback at 0 the loop can't regenerate, so touching only the wet
 *  fader (7) gets one bare echo that reads as the trail "cutting off" the instant
 *  a station changes, instead of ringing out. 0.5 here (real feedback ~0.4, see
 *  DUB_DELAY_MAX_FEEDBACK) gives a proper multi-repeat decaying trail out of the
 *  box from fader 7 alone, matching ping pong delay's always-on feedback — fader 8
 *  still adjusts it from there, and once touched that becomes the new default via
 *  localStorage. */
export const EFFECT_SECONDARY_REST_VALUE: Partial<Record<EffectId, number>> = {
  dubDelay: 0.5,
};

interface EffectUnit {
  input: AudioNode;
  output: AudioNode;
  setAmount: (v: number) => void;
  /** Optional second 0-1 knob, for the one effect (currently dub delay's feedback)
   *  that wants a parameter beyond the wet/dry mix setAmount already covers. */
  setSecondary?: (v: number) => void;
}

const RAMP = 0.02; // seconds — short smoothing so fader moves don't click

// One knob, two filter types: below the midpoint sweeps a highpass up from wide
// open (thins the sound out, classic build-up move), above it sweeps a lowpass
// down from wide open (muffles it, classic breakdown move). Exactly at the
// midpoint both types sit essentially at the edge of the audible range, so
// switching .type there doesn't produce an audible click.
function createFilterEffect(ctx: AudioContext): EffectUnit {
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.Q.value = 0.85;
  filter.frequency.value = 20; // wide open
  const setAmount = (v: number) => {
    if (v <= 0.5) {
      filter.type = 'highpass';
      const t = v / 0.5; // 1 (open) -> 0 (closed) as v goes 0.5 -> 0
      const freq = 20 * Math.pow(2000 / 20, 1 - t);
      filter.frequency.setTargetAtTime(freq, ctx.currentTime, RAMP);
    } else {
      filter.type = 'lowpass';
      const t = (v - 0.5) / 0.5; // 0 (open) -> 1 (closed) as v goes 0.5 -> 1
      const freq = 20000 * Math.pow(150 / 20000, t);
      filter.frequency.setTargetAtTime(freq, ctx.currentTime, RAMP);
    }
  };
  return { input: filter, output: filter, setAmount };
}

// Four cascaded allpass stages swept by a shared slow LFO, with a touch of
// feedback around the cascade for a stronger, more resonant sweep.
function createPhaserEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();

  const stageCount = 4;
  const stages: BiquadFilterNode[] = [];
  let node: AudioNode = input;
  for (let i = 0; i < stageCount; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = 800;
    ap.Q.value = 0.6;
    node.connect(ap);
    node = ap;
    stages.push(ap);
  }
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  node.connect(feedback);
  feedback.connect(stages[0]);
  node.connect(wet);

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.3;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 600; // Hz swept around each stage's base frequency
  lfo.connect(lfoDepth);
  for (const stage of stages) lfoDepth.connect(stage.frequency);
  lfo.start();

  input.connect(dry).connect(output);
  wet.connect(output);
  dry.gain.value = 1;
  wet.gain.value = 0;
  const setAmount = (v: number) => wet.gain.setTargetAtTime(v * 0.85, ctx.currentTime, RAMP);
  return { input, output, setAmount };
}

function createFlangerEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(0.02);
  delay.delayTime.value = 0.005;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.4;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.25;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.003;

  input.connect(dry).connect(output);
  input.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(output);
  lfo.connect(lfoDepth).connect(delay.delayTime);
  lfo.start();

  dry.gain.value = 1;
  wet.gain.value = 0;
  const setAmount = (v: number) => wet.gain.setTargetAtTime(v * 0.9, ctx.currentTime, RAMP);
  return { input, output, setAmount };
}

// Rhythmic volume chop via a square-wave LFO. No tempo sync (nothing to sync to on
// live radio), so the rate is fixed-ish; amount controls both how deep the chop
// cuts and how fast it runs, so it reads as one knob going from subtle pumping to
// a hard trance-gate stutter.
function createGateEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const gateGain = ctx.createGain();
  gateGain.gain.value = 0; // pure sum of the two modulation sources below
  input.connect(gateGain).connect(output);

  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 3;
  const lfoScale = ctx.createGain();
  lfoScale.gain.value = 0;
  lfo.connect(lfoScale).connect(gateGain.gain);

  const offset = ctx.createConstantSource();
  offset.offset.value = 1;
  offset.connect(gateGain.gain);
  offset.start();
  lfo.start();

  const setAmount = (v: number) => {
    // square wave alternates -1/+1; gain ends up toggling between 1 and (1 - v)
    lfoScale.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.01);
    offset.offset.setTargetAtTime(1 - v * 0.5, ctx.currentTime, 0.01);
    lfo.frequency.setTargetAtTime(2 + v * 6, ctx.currentTime, 0.05);
  };
  return { input, output, setAmount };
}

function createBeatRepeatEffect(ctx: AudioContext): EffectUnit {
  const node = ctx.createScriptProcessor(4096, 2, 2);
  const sr = ctx.sampleRate;
  const maxSliceSamples = Math.floor(sr * 0.5);
  const ringL = new Float32Array(maxSliceSamples);
  const ringR = new Float32Array(maxSliceSamples);
  let writeIdx = 0;
  let amount = 0;
  let engaged = false;
  let sliceStart = 0;
  let readPos = 0;

  node.onaudioprocess = (e) => {
    const inL = e.inputBuffer.getChannelData(0);
    const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);
    // Recomputed once per block (not per sample): higher amount = shorter slice,
    // so the roll gets tighter/more glitchy as the fader goes up. Re-reading this
    // every block, even while already engaged, is what makes moving the fader mid
    // roll audibly retrigger — that's the point, it's meant to be played with live.
    const sliceLen = Math.max(Math.floor(sr * 0.03), Math.floor(sr * 0.4 * (1 - amount) + sr * 0.03));

    for (let i = 0; i < inL.length; i++) {
      ringL[writeIdx] = inL[i];
      ringR[writeIdx] = inR[i];
      writeIdx = (writeIdx + 1) % maxSliceSamples;

      if (amount <= 0.001) {
        engaged = false;
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }
      if (!engaged) {
        engaged = true;
        sliceStart = (writeIdx - sliceLen + maxSliceSamples) % maxSliceSamples;
        readPos = 0;
      }
      const idx = (sliceStart + (readPos % sliceLen)) % maxSliceSamples;
      outL[i] = ringL[idx];
      outR[i] = ringR[idx];
      readPos++;
    }
  };
  return { input: node, output: node, setAmount: (v) => { amount = v; } };
}

// Classic ping pong: one delay line feeding hard left, whose feedback crosses into
// a second delay line feeding hard right (and back again), so repeats alternate
// side to side rather than staying centred.
//
// Send and return are deliberately two different gain nodes, not one: the fader
// (setAmount) only ever touches `send`, which is how much NEW signal is allowed
// into the delay lines. `wetReturn` — how much of whatever's already circulating
// reaches the output — stays fixed. Pull the fader down fast and the repeats
// already in flight keep bouncing and decaying on their own via the feedback
// loop's own physics, rather than being cut off the instant the fader moves; the
// fader is a gate on new echoes starting, not a real-time volume on the ones
// already going. This is what a mixing console would call post-fader routing.
function createPingPongDelayEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const send = ctx.createGain();
  const wetReturn = ctx.createGain();

  const delayL = ctx.createDelay(1.0);
  const delayR = ctx.createDelay(1.0);
  delayL.delayTime.value = 0.28;
  delayR.delayTime.value = 0.28;
  const feedbackL = ctx.createGain();
  const feedbackR = ctx.createGain();
  feedbackL.gain.value = 0.45;
  feedbackR.gain.value = 0.45;
  const pannerL = ctx.createStereoPanner();
  pannerL.pan.value = -1;
  const pannerR = ctx.createStereoPanner();
  pannerR.pan.value = 1;

  input.connect(send).connect(delayL);
  delayL.connect(pannerL).connect(wetReturn);
  delayL.connect(feedbackL).connect(delayR);
  delayR.connect(pannerR).connect(wetReturn);
  delayR.connect(feedbackR).connect(delayL);

  input.connect(dry).connect(output);
  wetReturn.connect(output);
  dry.gain.value = 1;
  send.gain.value = 0;
  wetReturn.gain.value = 0.85; // fixed — nothing reaches it until send lets signal in anyway
  const setAmount = (v: number) => send.gain.setTargetAtTime(v, ctx.currentTime, RAMP);
  return { input, output, setAmount };
}

// King Tubby style dub echo: long feedback trail, each repeat a little darker
// (lowpass) and thinner (highpass) than the last. No saturator in the loop (see
// the comment on `feedback` below for why), but "purely linear means any feedback
// under 1 is stable" turned out to be wrong in practice: measured directly via
// getFrequencyResponse(), the loop's own lowpass+highpass pair peaks around 1.22x
// gain in the middle of its passband (~330Hz) rather than sitting flat at 1x, no
// matter what Q they're given (checked all the way down to Q=0.01) — so the real
// per-pass loop gain is feedback times that peak, not feedback alone. 0.85 was
// tried first and audibly ran away instead of decaying (confirmed by rendering it
// and watching the level climb, not fall); the actual instability threshold is
// close to 1/1.22 =~ 0.82. 0.75 sits with real margin under that, verified by the
// same rendering test to decay smoothly and stay inaudible after ~20+ seconds at
// max, versus the old 0.6's measured 3-5 seconds.
const DUB_DELAY_MAX_FEEDBACK = 0.75;

function createDubDelayEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  // Send and return are two different gain nodes, same reasoning as ping pong
  // delay above: the fader (setAmount) only ever touches `send`, gating whether
  // new signal gets into the loop. `wetReturn` — how much of what's already
  // circulating reaches the output — stays fixed, so pulling the fader down fast
  // doesn't cut off a trail already in flight; it decays on the loop's own
  // feedback physics instead. Post-fader routing, not a real-time wet volume.
  const send = ctx.createGain();
  const wetReturn = ctx.createGain();
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  // Raw creation-time value only; ensureChain() immediately calls setSecondary
  // with the real rest value (EFFECT_SECONDARY_REST_VALUE.dubDelay, see there for
  // why it isn't 0) or whatever was saved, so this never stays at 0 in practice.
  feedback.gain.value = 0;
  // No saturator in this loop, deliberately — a soft-clip curve here initially
  // looked like a safe "subtle warmth" addition (its slope at the origin was
  // comfortably under 1/feedback), but that's only a small-signal analysis. Once
  // actually driven for a while, the loop settled into a sustained, non-decaying
  // oscillation instead of fading — confirmed by rendering it offline and watching
  // the level hold steady rather than decay. A purely linear loop (just filters
  // and a feedback gain, both provably <=1 in the frequency band that matters)
  // has no such equilibrium to get stuck at: total loop gain is feedback alone,
  // capped at DUB_DELAY_MAX_FEEDBACK, so it decays predictably from anywhere.
  const loopLowpass = ctx.createBiquadFilter();
  loopLowpass.type = 'lowpass';
  loopLowpass.frequency.value = 2200;
  loopLowpass.Q.value = 0.7; // Butterworth-flat — no resonant peak adding gain of its own
  const loopHighpass = ctx.createBiquadFilter();
  loopHighpass.type = 'highpass';
  loopHighpass.frequency.value = 250;
  loopHighpass.Q.value = 0.7;

  input.connect(dry).connect(output);
  input.connect(send).connect(delay);
  delay.connect(loopLowpass).connect(loopHighpass);
  loopHighpass.connect(feedback).connect(delay);
  loopHighpass.connect(wetReturn).connect(output);

  dry.gain.value = 1;
  send.gain.value = 0;
  wetReturn.gain.value = 0.85; // fixed — nothing reaches it until send lets signal in anyway
  const setAmount = (v: number) => send.gain.setTargetAtTime(v, ctx.currentTime, RAMP);
  const setSecondary = (v: number) => feedback.gain.setTargetAtTime(v * DUB_DELAY_MAX_FEEDBACK, ctx.currentTime, RAMP);
  return { input, output, setAmount, setSecondary };
}

const FACTORIES: Record<EffectId, (ctx: AudioContext) => EffectUnit> = {
  filter: createFilterEffect,
  phaser: createPhaserEffect,
  flanger: createFlangerEffect,
  gate: createGateEffect,
  beatRepeat: createBeatRepeatEffect,
  pingPongDelay: createPingPongDelayEffect,
  dubDelay: createDubDelayEffect,
};

export interface EffectsChain {
  ctx: AudioContext;
  setAmount: (id: EffectId, value: number) => void;
  /** No-ops for any effect that doesn't have one (see EffectUnit.setSecondary). */
  setSecondary: (id: EffectId, value: number) => void;
  resume: () => void;
  /** Ramps the chain's final output to silent or full. Used to hand off cleanly
   *  between this graph and the plain playback element it's shadowing: silenced
   *  the instant a station switch starts, brought back only once this graph's own
   *  element confirms it's actually playing the new station. */
  setActive: (active: boolean, rampSeconds?: number) => void;
  /** Instantaneous peak amplitude of the chain's own decoded audio, tapped before
   *  the active/inactive gain so it reads correctly either way. A station can fire
   *  a completely normal 'playing' event while still being CORS-tainted (silently
   *  zeroed) through Web Audio specifically — that failure produces no error event
   *  at all, so this is the only way to actually confirm real signal is present
   *  before committing to a handoff away from the untainted playback element. */
  peekLevel: () => number;
}

/** Builds the full serial chain from `source` to `ctx.destination` and returns a
 *  single setAmount(id, value) to drive any of the faders. */
export function createEffectsChain(ctx: AudioContext, source: MediaElementAudioSourceNode): EffectsChain {
  const units = {} as Record<EffectId, EffectUnit>;
  let prev: AudioNode = source;
  for (const id of EFFECT_ORDER) {
    const unit = FACTORIES[id](ctx);
    prev.connect(unit.input);
    prev = unit.output;
    units[id] = unit;
  }
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0; // silent until setActive(true) is explicitly called
  prev.connect(masterGain);
  masterGain.connect(ctx.destination);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  prev.connect(analyser); // parallel tap, ahead of masterGain so this works even while inactive
  const analyserBuffer = new Float32Array(analyser.fftSize);
  const peekLevel = () => {
    analyser.getFloatTimeDomainData(analyserBuffer);
    let peak = 0;
    for (let i = 0; i < analyserBuffer.length; i++) {
      const a = Math.abs(analyserBuffer[i]);
      if (a > peak) peak = a;
    }
    return peak;
  };

  return {
    peekLevel,
    ctx,
    setAmount: (id, value) => units[id]?.setAmount(Math.min(1, Math.max(0, value))),
    setSecondary: (id, value) => units[id]?.setSecondary?.(Math.min(1, Math.max(0, value))),
    resume: () => { if (ctx.state === 'suspended') void ctx.resume(); },
    // rampSeconds defaults fast (bringing a confirmed station in, or an explicit
    // pause). Pass a slower one to let a delay tail ring out and decay naturally
    // instead of cutting it off, e.g. when the station underneath it changes — the
    // effect nodes themselves keep decaying on their own once their input goes
    // quiet; this just avoids stepping on that by force-zeroing early.
    setActive: (active, rampSeconds = 0.03) => masterGain.gain.setTargetAtTime(active ? 1 : 0, ctx.currentTime, rampSeconds),
  };
}
