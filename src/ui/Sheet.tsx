// One container, two presentations (§20, clean-sheet pass): under 800px a
// menu rises as a bottom sheet in the thumb's reach; above it the same
// content rides the world-anchored popover. The content components never
// know which they are in.

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

const PHONE_QUERY = '(max-width: 799px)';

/** The one breakpoint, as a hook. CSS keys off the same 800px line. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="sheet"
      // Stop everything reaching the map shell: a drag inside the sheet
      // scrolls the sheet (never pans the camera), and a tap inside it must
      // not fall through to the shell's hit-test — which reads "empty marsh"
      // and closes the very menu the tap was using.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="sheet-handle" title="Put the card away" onClick={onClose}>
        <span />
      </button>
      <div className="sheet-body">{children}</div>
    </div>
  );
}
