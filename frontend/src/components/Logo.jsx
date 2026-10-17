export const Logo = ({ className = "h-9", testId = "app-logo" }) => (
  <svg viewBox="0 0 168 48" className={className} xmlns="http://www.w3.org/2000/svg" data-testid={testId} aria-label="GSB31">
    <defs>
      <filter id="gsb-glow" x="-20%" y="-40%" width="140%" height="180%">
        <feGaussianBlur stdDeviation="1.6" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <g filter="url(#gsb-glow)" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="40" letterSpacing="1">
      <text x="2" y="40" fill="#0B1120" stroke="#1E3A5F" strokeWidth="5">GSB31</text>
      <text x="2" y="40" fill="none" stroke="#00F0FF" strokeWidth="1.4">GSB31</text>
    </g>
  </svg>
);

export const LogoMark = ({ className = "h-8 w-8" }) => (
  <svg viewBox="0 0 40 40" className={className} xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="1.5" width="37" height="37" rx="9" fill="#070D19" stroke="#00F0FF" strokeOpacity=".5" />
    <text x="20" y="27" textAnchor="middle" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="16" fill="none" stroke="#00F0FF" strokeWidth="1">G31</text>
  </svg>
);
