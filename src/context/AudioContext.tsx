import { createContext, useContext, type ReactNode } from 'react';
import { useAudioEngine } from '../hooks/useAudioEngine';

type AudioEngineReturn = ReturnType<typeof useAudioEngine>;

const AudioEngineContext = createContext<AudioEngineReturn | null>(null);

export function AudioEngineProvider({ children }: { children: ReactNode }) {
  const engine = useAudioEngine();
  return (
    <AudioEngineContext.Provider value={engine}>
      {children}
    </AudioEngineContext.Provider>
  );
}

export function useAudioEngineContext(): AudioEngineReturn {
  const ctx = useContext(AudioEngineContext);
  if (!ctx) throw new Error('useAudioEngineContext must be used inside AudioEngineProvider');
  return ctx;
}
