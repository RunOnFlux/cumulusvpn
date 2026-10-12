import { useEffect } from 'react';

/**
 * Close-on-Escape for the full-window sheets. A desktop window has no back
 * gesture, so Escape is the only dismissal a keyboard user has — the Close
 * button is a pointer affordance.
 */
export function useEscape(onEscape: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape]);
}
