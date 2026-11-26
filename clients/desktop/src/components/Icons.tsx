import type { JSX, ReactNode } from 'react';

/**
 * Small line icons drawn as SVG instead of symbol characters (⏻ ⋯ ✓ ★ ☆ ↻).
 * Those characters come from whatever font the OS falls back to, and Linux
 * desktops often have none that carries them: ⏻ left the Connect button empty
 * on Ubuntu and Fedora. Each icon is 1em square in `currentColor`, so it sizes
 * and colours exactly like the text it replaced. Plain punctuation (— … · ‹ ›
 * → ↑ ↓) and colour emoji stay as text: every desktop font set has those.
 */
function Icon({
  children,
  filled = false,
  className,
}: {
  readonly children: ReactNode;
  readonly filled?: boolean;
  readonly className?: string;
}): JSX.Element {
  return (
    <svg
      className={className ? `ico ${className}` : 'ico'}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function PowerIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M12 2.5v9" />
      <path d="M18.36 6.64a9 9 0 1 1-12.72 0" />
    </Icon>
  );
}

/** Three dots: "working on it" (was ⋯). */
export function DotsIcon(): JSX.Element {
  return (
    <Icon filled>
      <circle cx="5" cy="12" r="1.9" stroke="none" />
      <circle cx="12" cy="12" r="1.9" stroke="none" />
      <circle cx="19" cy="12" r="1.9" stroke="none" />
    </Icon>
  );
}

export function CheckIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4.5 12.5l5 5 10-11" />
    </Icon>
  );
}

/** Favourite star: filled when pinned (was ★ / ☆). */
export function StarIcon({ filled }: { readonly filled: boolean }): JSX.Element {
  return (
    <Icon filled={filled}>
      <path
        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
        strokeWidth="1.8"
      />
    </Icon>
  );
}

/** Clockwise arrow: re-test / refresh (was ↻). */
export function RetryIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M18 2.5v4h-4" />
    </Icon>
  );
}
