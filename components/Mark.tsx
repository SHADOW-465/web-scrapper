/** The Scrape Studio mark: a chisel-tip highlighter stroke across a ruled line. */
export default function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="8.5" width="19" height="7" rx="1.5" transform="rotate(-6 12 12)" fill="#f7e733" />
      <path d="M4 12.6h16M4 16.6h11" stroke="#1d1f22" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 8.6h9" stroke="#1d1f22" strokeWidth="1.6" strokeLinecap="round" opacity=".35" />
    </svg>
  );
}
