import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { browserShell } from './shell';

// Each shell is its own chunk with its own stylesheet (spec §20.3): the phone's
// CSS never reaches the desk, and the desk's renderer never ships to a phone.
const shell = browserShell();
const Shell = shell === 'desk' ? lazy(() => import('./desk/DeskApp')) : lazy(() => import('./phone/PhoneApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Shell />
    </Suspense>
  </StrictMode>,
);
