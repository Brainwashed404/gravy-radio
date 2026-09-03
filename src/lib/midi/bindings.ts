// Button bindings for the transport style actions.
//
// The defaults are the documented mk2 note numbers. Anything that does not match this
// particular unit gets rebound through Learn mode in the MIDI panel and persisted, so
// a wrong default is a thirty second fix rather than a code change.

import { SCENE_BUTTON_NOTES, TRACK_BUTTON_NOTES, MASTER_FADER_CC } from './apcMiniMk2';

export type MidiActionId =
  | 'playPause'
  | 'fwd'
  | 'rwd'
  | 'shuffle'
  | 'favs'
  | 'favouriteCurrent'
  | 'index'
  | 'dark'
  | 'clearAll'
  | 'volume';

export interface ActionMeta {
  id: MidiActionId;
  label: string;
  /** Where the default lives on the hardware, for the panel to show. */
  where: string;
  /** Volume wants a fader, everything else wants a button. */
  control: 'button' | 'fader';
}

export const ACTIONS: ActionMeta[] = [
  { id: 'playPause',        label: 'Play / Pause',   where: 'CLIP STOP',     control: 'button' },
  { id: 'fwd',              label: 'Forward',        where: 'SOLO',          control: 'button' },
  { id: 'rwd',              label: 'Rewind',         where: 'MUTE',          control: 'button' },
  { id: 'shuffle',          label: 'Shuffle / All',  where: 'REC ARM',       control: 'button' },
  { id: 'favs',             label: 'Favs mode',      where: 'SELECT',        control: 'button' },
  { id: 'favouriteCurrent', label: 'Heart station',  where: 'DRUM',          control: 'button' },
  { id: 'index',            label: 'Station index',  where: 'NOTE',          control: 'button' },
  { id: 'dark',             label: 'Dark mode',      where: 'STOP ALL CLIPS', control: 'button' },
  { id: 'clearAll',         label: 'Clear genre',    where: 'DEVICE',        control: 'button' },
  { id: 'volume',           label: 'Volume',         where: 'Master fader',  control: 'fader' },
];

export type Binding =
  | { kind: 'note'; note: number }
  | { kind: 'cc'; cc: number };

export const DEFAULT_BINDINGS: Record<MidiActionId, Binding> = {
  playPause:        { kind: 'note', note: SCENE_BUTTON_NOTES[0] },
  fwd:              { kind: 'note', note: SCENE_BUTTON_NOTES[1] },
  rwd:              { kind: 'note', note: SCENE_BUTTON_NOTES[2] },
  shuffle:          { kind: 'note', note: SCENE_BUTTON_NOTES[3] },
  favs:             { kind: 'note', note: SCENE_BUTTON_NOTES[4] },
  favouriteCurrent: { kind: 'note', note: SCENE_BUTTON_NOTES[5] },
  index:            { kind: 'note', note: SCENE_BUTTON_NOTES[6] },
  dark:             { kind: 'note', note: SCENE_BUTTON_NOTES[7] },
  clearAll:         { kind: 'note', note: TRACK_BUTTON_NOTES[3] },
  volume:           { kind: 'cc',   cc: MASTER_FADER_CC },
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
