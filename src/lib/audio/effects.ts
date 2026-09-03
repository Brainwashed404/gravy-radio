// Live effects chain for the radio stream. Pure Web Audio, no React here.
//
// Each effect is a small factory returning { input, output, setAmount }: a single
// 0-1 knob per effect, matching one APC mini fader each. At amount 0 every effect
// must be a true transparent bypass (unity gain, no coloration) — that's what keeps
// the app sounding identical to today for anyone not touching the faders.
//
// ScriptProcessorNode is used for bitcrush and beat repeat rather than an
// AudioWorklet. It's deprecated but universally supported and far simpler to reason
// about; worklets need an async module load (workable via a Blob URL, but adds a
// failure mode with no real upside for a non-latency-critical effect like this).

export type EffectId =
  | 'vinyl'
  | 'filter'
  | 'bitcrush'
  | 'distortion'
  | 'flanger'
  | 'beatRepeat'
  | 'delay'
  | 'reverb';

// Signal chain order: subtle colouration first, glitch effects in the middle,
// time-based space effects last, so a repeated slice can still trail into a delay
// or reverb tail rather than cutting off dry.
export const EFFECT_ORDER: EffectId[] = [
  'vinyl', 'filter', 'bitcrush', 'distortion', 'flanger', 'beatRepeat', 'delay', 'reverb',
];

export const EFFECT_LABELS: Record<EffectId, string> = {
  vinyl: 'Vinyl',
  filter: 'Filter',
  bitcrush: 'Bitcrush',
  distortion: 'Distortion',
  flanger: 'Flanger',
  beatRepeat: 'Beat repeat',
  delay: 'Delay',
  reverb: 'Reverb',
};

interface EffectUnit {
  input: AudioNode;
  output: AudioNode;
  setAmount: (v: number) => void;
}

const RAMP = 0.02; // seconds — short smoothing so fader moves don't click

function createFilterEffect(ctx: AudioContext): EffectUnit {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.9;
  filter.frequency.value = 20000; // fully open at rest — inaudible
  const setAmount = (v: number) => {
    const minHz = 150;
    const maxHz = 20000;
    const freq = maxHz * Math.pow(minHz / maxHz, v);
    filter.frequency.setTargetAtTime(freq, ctx.currentTime, RAMP);
  };
  return { input: filter, output: filter, setAmount };
}

function createBitcrushEffect(ctx: AudioContext): EffectUnit {
  const node = ctx.createScriptProcessor(4096, 2, 2);
  let amount = 0;
  let phase = 0;
  let lastL = 0;
  let lastR = 0;
  node.onaudioprocess = (e) => {
    const inL = e.inputBuffer.getChannelData(0);
    const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);
    if (amount <= 0.001) {
      outL.set(inL);
      outR.set(inR);
      return;
    }
    const holdSamples = 1 + Math.round(amount * 24); // sample-rate reduction
    const bitDepth = Math.max(2, 16 - Math.round(amount * 13)); // bit-depth reduction
    const step = Math.pow(2, bitDepth);
    for (let i = 0; i < inL.length; i++) {
      if (phase % holdSamples === 0) {
        lastL = Math.round(inL[i] * step) / step;
        lastR = Math.round(inR[i] * step) / step;
      }
      outL[i] = lastL;
      outR[i] = lastR;
      phase++;
    }
  };
  return { input: node, output: node, setAmount: (v) => { amount = v; } };
}

function makeDistortionCurve(amount: number): Float32Array {
  const n = 4096;
  const curve = new Float32Array(n);
  const k = amount * 50;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function createDistortionEffect(ctx: AudioContext): EffectUnit {
  const preGain = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const postGain = ctx.createGain();
  shaper.curve = makeDistortionCurve(0) as unknown as Float32Array<ArrayBuffer>;
  shaper.oversample = '2x';
  preGain.connect(shaper);
  shaper.connect(postGain);
  const setAmount = (v: number) => {
    preGain.gain.setTargetAtTime(1 + v * 3, ctx.currentTime, RAMP);
    shaper.curve = makeDistortionCurve(v) as unknown as Float32Array<ArrayBuffer>;
    postGain.gain.setTargetAtTime(1 / (1 + v * 1.5), ctx.currentTime, RAMP); // tame the loudness jump from clipping
  };
  return { input: preGain, output: postGain, setAmount };
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

function createDelayEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.35;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  const wetFilter = ctx.createBiquadFilter(); // keeps the repeats from getting harsh
  wetFilter.type = 'lowpass';
  wetFilter.frequency.value = 4000;

  input.connect(dry).connect(output);
  input.connect(delay);
  delay.connect(wetFilter);
  wetFilter.connect(feedback).connect(delay);
  wetFilter.connect(wet).connect(output);

  dry.gain.value = 1;
  wet.gain.value = 0;
  const setAmount = (v: number) => wet.gain.setTargetAtTime(v * 0.8, ctx.currentTime, RAMP);
  return { input, output, setAmount };
}

function generateImpulseResponse(ctx: AudioContext, duration = 2.5, decay = 3): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function createReverbEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = generateImpulseResponse(ctx);
  convolver.normalize = true;

  input.connect(dry).connect(output);
  input.connect(convolver).connect(wet).connect(output);

  dry.gain.value = 1;
  wet.gain.value = 0;
  const setAmount = (v: number) => wet.gain.setTargetAtTime(v * 0.9, ctx.currentTime, RAMP);
  return { input, output, setAmount };
}

function generateCrackleBuffer(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = rate * 4;
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() < 0.002 ? Math.random() * 2 - 1 : 0; // sparse pops, not constant hiss
  }
  return buffer;
}

function createVinylEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();

  // Wow (slow) + flutter (fast) pitch wobble via modulated delay time.
  const wobbleDelay = ctx.createDelay(0.05);
  wobbleDelay.delayTime.value = 0.01;
  const wow = ctx.createOscillator();
  wow.type = 'sine';
  wow.frequency.value = 0.6;
  const wowDepth = ctx.createGain();
  wowDepth.gain.value = 0;
  const flutter = ctx.createOscillator();
  flutter.type = 'sine';
  flutter.frequency.value = 6;
  const flutterDepth = ctx.createGain();
  flutterDepth.gain.value = 0;
  wow.connect(wowDepth).connect(wobbleDelay.delayTime);
  flutter.connect(flutterDepth).connect(wobbleDelay.delayTime);
  wow.start();
  flutter.start();
  input.connect(wobbleDelay).connect(output);

  // Sparse crackle, band-passed so it sits like dust on a record rather than static.
  const crackleFilter = ctx.createBiquadFilter();
  crackleFilter.type = 'bandpass';
  crackleFilter.frequency.value = 3000;
  crackleFilter.Q.value = 0.7;
  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0;
  const crackleSource = ctx.createBufferSource();
  crackleSource.buffer = generateCrackleBuffer(ctx);
  crackleSource.loop = true;
  crackleSource.connect(crackleFilter).connect(crackleGain).connect(output);
  crackleSource.start();

  const setAmount = (v: number) => {
    wowDepth.gain.setTargetAtTime(v * 0.004, ctx.currentTime, 0.05);
    flutterDepth.gain.setTargetAtTime(v * 0.0015, ctx.currentTime, 0.05);
    crackleGain.gain.setTargetAtTime(v * 0.15, ctx.currentTime, 0.05);
  };
  return { input, output, setAmount };
}

const FACTORIES: Record<EffectId, (ctx: AudioContext) => EffectUnit> = {
  vinyl: createVinylEffect,
  filter: createFilterEffect,
  bitcrush: createBitcrushEffect,
  distortion: createDistortionEffect,
  flanger: createFlangerEffect,
  beatRepeat: createBeatRepeatEffect,
  delay: createDelayEffect,
  reverb: createReverbEffect,
};

export interface EffectsChain {
  ctx: AudioContext;
  setAmount: (id: EffectId, value: number) => void;
  resume: () => void;
  /** Ramps the chain's final output to silent or full. Used to hand off cleanly
   *  between this graph and the plain playback element it's shadowing: silenced
   *  the instant a station switch starts, brought back only once this graph's own
   *  element confirms it's actually playing the new station. */
  setActive: (active: boolean) => void;
}

/** Builds the full serial chain from `source` to `ctx.destination` and returns a
 *  single setAmount(id, value) to drive any of the 8 faders. */
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

  return {
    ctx,
    setAmount: (id, value) => units[id]?.setAmount(Math.min(1, Math.max(0, value))),
    resume: () => { if (ctx.state === 'suspended') void ctx.resume(); },
    setActive: (active) => masterGain.gain.setTargetAtTime(active ? 1 : 0, ctx.currentTime, 0.03),
  };
}
