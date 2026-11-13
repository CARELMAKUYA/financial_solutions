import { cn } from "@/lib/utils";

/** The TQ monogram with its gold swoosh. `onDark` draws the letters light for the black sidebar. */
export function TqMark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  const ink = onDark ? "#F5EFE2" : "currentColor";
  return (
    <svg viewBox="0 0 64 48" className={cn("h-8 w-auto", className)} aria-hidden>
      <text x="1" y="38" fontFamily="var(--font-display), Georgia, serif" fontWeight="800" fontSize="40" fill={ink} letterSpacing="-4">
        TQ
      </text>
      <path d="M6 34 C 22 22, 42 20, 60 25 C 44 23, 26 26, 10 38 Z" fill="url(#tq-gold)" />
      <defs>
        <linearGradient id="tq-gold" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#9C7A2E" />
          <stop offset="0.5" stopColor="#E3C47A" />
          <stop offset="1" stopColor="#B8913A" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Monogram + "TEE QUE / Financial Solutions" wordmark. */
export function Brand({ onDark = false, compact = false, className }: { onDark?: boolean; compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <TqMark onDark={onDark} className={compact ? "h-7" : "h-9"} />
      <div className="leading-none">
        <div className={cn("font-display text-[15px] font-bold tracking-[0.22em]", onDark ? "text-[#F5EFE2]" : "text-foreground")}>TEE QUE</div>
        <div className="mt-1 text-[9px] font-medium tracking-[0.2em] text-gold uppercase">Financial Solutions</div>
      </div>
    </div>
  );
}
