import { useEffect, useRef } from 'react';

/** Open sheets, oldest first: Escape closes only the top one. */
const stack: { current: () => void }[] = [];

function onKey(e: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (e.key === 'Escape' && top) {
    e.preventDefault();
    top.current();
  }
}

/**
 * Close-on-Escape for the full-window sheets. A desktop window has no back
 * gesture, so Escape is the only dismissal a keyboard user has — the Close
 * button is a pointer affordance. Sheets can stack (Upgrade over Settings),
 * so one press closes only the sheet on top.
 */
export function useEscape(onEscape: () => void): void {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (stack.length === 0) {
      window.addEventListener('keydown', onKey);
    }
    stack.push(ref);
    return () => {
      stack.splice(stack.indexOf(ref), 1);
      if (stack.length === 0) {
        window.removeEventListener('keydown', onKey);
      }
    };
  }, []);
}
