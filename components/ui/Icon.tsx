import type { ReactNode } from "react";

/**
 * Stroke-icon set (no emoji anywhere in the product). Filled glyphs (play,
 * sparkle) render with `fill`; the rest are 1.9px strokes. Pass `label` for a
 * meaningful icon (renders `role="img"`), omit it for decorative icons
 * (renders `aria-hidden`).
 */
const PATHS = {
  play: <path d="M8 5v14l11-7z" />,
  sparkle: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="1.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M19 12H5M11 6l-6 6 6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5h13a3 3 0 0 1 3 3v11H7a3 3 0 0 0-3 3z" />
      <path d="M4 5v14" />
    </>
  ),
  class: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" />
      <path d="M17 7a3 3 0 0 1 0 6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3H9l-.3 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.5 7.5 0 0 0 1.7 1L9 21h6l.3-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.5z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  label,
  size = 20,
  className,
}: {
  name: IconName;
  label?: string;
  size?: number;
  className?: string;
}) {
  const filled = name === "play" || name === "sparkle";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
