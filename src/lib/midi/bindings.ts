// Button bindings for the transport style actions.
//
// The defaults are the documented mk2 note numbers. Anything that does not match this
// particular unit gets rebound through Learn mode in the MIDI panel and persisted, so
// a wrong default is a thirty second fix rather than a code change.

import { SCENE_BUTTON_NOTES, TRACK_BUTTON_NOTES, TRACK_FADER_CCS, MASTER_FADER_CC } from './apcMiniMk2';
import type { EffectId } from '../audio/effects';

// Play/pause is not in this list: it lives on SHIFT (tap it to toggle), which is
// read specially before the generic bindings lookup rather than through a
// rebindable note, so there's nothing here for Learn mode to attach to.
export type MidiActionId =
  | 'fwd'
  | 'rwd'
  | 'shuffle'
  | 'favs'
  | 'favouriteCurrent'
  | 'index'
  | 'dark'
  | 'info'
  | 'closeViz'
  | 'fullscreenViz'
  | 'clearAll'
  | 'nextGenre'
  | 'prevGenre'
  | 'volume'
  | 'fxFilter'
  | 'fxPhaser'
  | 'fxFlanger'
  | 'fxGate'
  | 'fxBeatRepeat'
  | 'fxPingPongDelay'
  | 'fxDubDelay';

export interface ActionMeta {
  id: MidiActionId;
  label: string;
  /** Where the default lives on the hardware, for the panel to show. */
  where: string;
  /** Volume wants a fader, everything else wants a button. */
  control: 'button' | 'fader';
}

export const ACTIONS: ActionMeta[] = [
  { id: 'info',              label: 'Info',            where: 'CLIP STOP',      control: 'button' },
  { id: 'index',             label: 'Station index',   where: 'REC ARM',        control: 'button' },
  { id: 'closeViz',          label: 'Exit visualiser', where: 'STOP ALL CLIPS', control: 'button' },
  { id: 'favouriteCurrent',  label: 'Heart station',   where: 'SOLO',           control: 'button' },
  { id: 'clearAll',          label: 'Clear genre',     where: 'MUTE',           control: 'button' },
  // Round track button row: VOLUME PAN SEND DEVICE, then the arrows.
  { id: 'fullscreenViz',     label: 'Fullscreen viz',  where: 'VOLUME',         control: 'button' },
  { id: 'dark',              label: 'Dark mode',       where: 'PAN',            control: 'button' },
  { id: 'favs',              label: 'Favs mode',       where: 'SEND',           control: 'button' },
  { id: 'shuffle',           label: 'Shuffle / All',   where: 'DEVICE',         control: 'button' },
  { id: 'nextGenre',         label: 'Next genre',      where: '▲ (up)',    control: 'button' },
  { id: 'prevGenre',         label: 'Previous genre',  where: '▼ (down)',  control: 'button' },
  { id: 'rwd',               label: 'Rewind',          where: '◄ (left)',  control: 'button' },
  { id: 'fwd',               label: 'Forward',         where: '► (right)', control: 'button' },
  { id: 'volume',            label: 'Volume',          where: 'Master fader',   control: 'fader' },
  // Faders 1-7, one effect each, left to right in signal-chain order. Fader 8 is
  // spare for now.
  { id: 'fxFilter',          label: 'FX: Filter',           where: 'Fader 1', control: 'fader' },
  { id: 'fxPhaser',          label: 'FX: Phaser',           where: 'Fader 2', control: 'fader' },
  { id: 'fxFlanger',         label: 'FX: Flanger',          where: 'Fader 3', control: 'fader' },
  { id: 'fxGate',            label: 'FX: Gate',             where: 'Fader 4', control: 'fader' },
  { id: 'fxBeatRepeat',      label: 'FX: Beat repeat',      where: 'Fader 5', control: 'fader' },
  { id: 'fxPingPongDelay',   label: 'FX: Ping pong delay',  where: 'Fader 6', control: 'fader' },
  { id: 'fxDubDelay',        label: 'FX: Dub delay',        where: 'Fader 7', control: 'fader' },
];

export type Binding =
  | { kind: 'note'; note: number }
  | { kind: 'cc'; cc: number };

export const DEFAULT_BINDINGS: Record<MidiActionId, Binding> = {
  // Scene launch column, top to bottom: CLIP STOP, SOLO, MUTE, REC ARM, SELECT,
  // DRUM, NOTE, STOP ALL CLIPS. Only 5 of the 8 are spoken for right now (info,
  // index, closeViz unchanged; favouriteCurrent and clearAll moved in here to
  // make room below) — SELECT, DRUM and NOTE sit open until the rest of this
  // column gets redesigned.
  info:             { kind: 'note', note: SCENE_BUTTON_NOTES[0] },
  favouriteCurrent: { kind: 'note', note: SCENE_BUTTON_NOTES[1] },
  clearAll:         { kind: 'note', note: SCENE_BUTTON_NOTES[2] },
  index:            { kind: 'note', note: SCENE_BUTTON_NOTES[3] },
  closeViz:         { kind: 'note', note: SCENE_BUTTON_NOTES[7] },
  // Round track button row: VOLUME PAN SEND DEVICE, then the arrows (▲▼◄►).
  fullscreenViz:    { kind: 'note', note: TRACK_BUTTON_NOTES[0] },
  dark:             { kind: 'note', note: TRACK_BUTTON_NOTES[1] },
  favs:             { kind: 'note', note: TRACK_BUTTON_NOTES[2] },
  shuffle:          { kind: 'note', note: TRACK_BUTTON_NOTES[3] },
  nextGenre:        { kind: 'note', note: TRACK_BUTTON_NOTES[4] },
  prevGenre:        { kind: 'note', note: TRACK_BUTTON_NOTES[5] },
  rwd:              { kind: 'note', note: TRACK_BUTTON_NOTES[6] },
  fwd:              { kind: 'note', note: TRACK_BUTTON_NOTES[7] },
  volume:           { kind: 'cc',   cc: MASTER_FADER_CC },
  // Faders 1-7, same order as EFFECT_ORDER in lib/audio/effects.ts. Fader 8
  // (TRACK_FADER_CCS[7]) is spare, not bound to anything yet.
  fxFilter:         { kind: 'cc', cc: TRACK_FADER_CCS[0] },
  fxPhaser:         { kind: 'cc', cc: TRACK_FADER_CCS[1] },
  fxFlanger:        { kind: 'cc', cc: TRACK_FADER_CCS[2] },
  fxGate:           { kind: 'cc', cc: TRACK_FADER_CCS[3] },
  fxBeatRepeat:     { kind: 'cc', cc: TRACK_FADER_CCS[4] },
  fxPingPongDelay:  { kind: 'cc', cc: TRACK_FADER_CCS[5] },
  fxDubDelay:       { kind: 'cc', cc: TRACK_FADER_CCS[6] },
};

/** MidiActionId -> EffectId for the fx faders, so the dispatcher in App.tsx
 *  doesn't need to hand-maintain a second copy of this mapping. */
export const FX_ACTION_EFFECT: Partial<Record<MidiActionId, EffectId>> = {
  fxFilter: 'filter',
  fxPhaser: 'phaser',
  fxFlanger: 'flanger',
  fxGate: 'gate',
  fxBeatRepeat: 'beatRepeat',
  fxPingPongDelay: 'pingPongDelay',
  fxDubDelay: 'dubDelay',
};

const STORAGE_KEY = 'lucky-breaks-midi-bindings';

export function loadBindings(): Record<MidiActionId, Binding> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    return { ...DEFAULT_BINDINGS, ...(JSON.parse(raw) as Record<MidiActionId, Binding>) };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings: Record<MidiActionId, Binding>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {}
}

export function describeBinding(b: Binding): string {
  return b.kind === 'note' ? `Note ${b.note}` : `CC ${b.cc}`;
}
