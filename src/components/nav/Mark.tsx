/** The monogram: three slabs of glass, the middle one lit (the site's object). */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mark">
      <defs>
        <linearGradient id="mark-di" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8fe3f2" />
          <stop offset=".35" stopColor="#b9a8ff" />
          <stop offset=".7" stopColor="#ffbfa0" />
          <stop offset="1" stopColor="#f3d98a" />
        </linearGradient>
      </defs>
      <rect x="3" y="4.5" width="18" height="3" rx="1.5" fill="currentColor" opacity=".45" />
      <rect x="3" y="10.5" width="18" height="3" rx="1.5" fill="url(#mark-di)" />
      <rect x="3" y="16.5" width="18" height="3" rx="1.5" fill="currentColor" opacity=".85" />
    </svg>
  );
}
