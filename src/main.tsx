import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AudioEngineProvider } from './context/AudioContext.tsx';

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration is optional — don't break the app
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioEngineProvider>
      <App />
    </AudioEngineProvider>
  </StrictMode>,
);
