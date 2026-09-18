export function WatercolorMemoryScene({ stats }: { stats: string }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden border-t border-[#d4c7b4] bg-[#faf6ed]">
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full"
        preserveAspectRatio="none"
        viewBox="0 0 340 210"
      >
        <defs>
          <filter id="watercolor-bleed">
            <feTurbulence baseFrequency="0.018 0.055" numOctaves="2" seed="8" />
            <feDisplacementMap in="SourceGraphic" scale="12" />
            <feGaussianBlur stdDeviation="0.7" />
          </filter>
        </defs>
        <circle cx="266" cy="58" fill="#c98265" opacity="0.42" r="24" />
        <path
          d="M-18 145 Q58 77 130 123 T356 92 V222 H-18Z"
          fill="#91a697"
          filter="url(#watercolor-bleed)"
          opacity="0.46"
        />
        <path
          d="M-22 166 Q76 114 165 151 T362 126 V222 H-22Z"
          fill="#81959d"
          filter="url(#watercolor-bleed)"
          opacity="0.3"
        />
        <path
          d="M171 210 C170 176 215 164 212 128 C210 103 237 91 270 82"
          fill="none"
          opacity="0.34"
          stroke="#b2745d"
          strokeLinecap="round"
          strokeWidth="8"
        />
      </svg>
      <div className="absolute inset-x-7 bottom-5 flex items-end justify-between border-t border-[#887e70]/70 pt-3 text-[9px] tracking-[0.14em] text-[#6e665c] uppercase">
        <span>Watercolor memory</span>
        <span>{stats}</span>
      </div>
    </div>
  );
}
