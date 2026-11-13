"use client";

import { useState } from "react";
import { formatDate, formatRand } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Daily collections: one series (single gold hue), so no legend. Bars are anchored to the
 * baseline with rounded data-ends, a 2px gap between bars, a recessive grid and a hover tooltip
 * on a hit area taller than the bar. Every date in the range gets a slot so gaps read as zero days.
 */
export function DailyBars({ from, to, data }: { from: string; to: string; data: { date: string; cents: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 400; ) {
    days.push(d);
    const n = new Date(`${d}T00:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
  }
  const map = new Map(data.map((d) => [d.date, d.cents]));
  const values = days.map((d) => map.get(d) ?? 0);
  const max = Math.max(1, ...values);
  // A "nice" top for the axis so gridlines land on round numbers.
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i).filter((v, i, a) => a.indexOf(v) === i);

  if (!data.length) return <p className="py-8 text-center text-sm text-muted-foreground">No payments in this period.</p>;

  return (
    <div className="relative">
      <div className="flex h-48 gap-2">
        <div className="relative w-14 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: `${(t / top) * 100}%`, transform: "translateY(50%)" }}>
              {formatRand(t, { whole: true })}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div key={t} className={cn("absolute inset-x-0 border-t", t === 0 ? "border-foreground/30" : "border-border/60")} style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {values.map((v, i) => (
              <div
                key={days[i]}
                className="relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={v ? 0 : -1}
                aria-label={`${formatDate(days[i])}: ${formatRand(v)}`}
              >
                {v > 0 && (
                  <div
                    className={cn("w-full rounded-t-[4px] bg-chart-1 transition-opacity", hover !== null && hover !== i && "opacity-60")}
                    style={{ height: `${Math.max((v / top) * 100, 1.5)}%` }}
                  />
                )}
              </div>
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
              style={{ left: `${((hover + 0.5) / values.length) * 100}%` }}
            >
              <div className="text-muted-foreground">{formatDate(days[hover])}</div>
              <div className="font-semibold tabular-nums">{formatRand(values[hover])}</div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 ml-16 flex justify-between text-[10px] text-muted-foreground">
        <span>{formatDate(days[0])}</span>
        {days.length > 2 && <span>{formatDate(days[Math.floor(days.length / 2)])}</span>}
        <span>{formatDate(days[days.length - 1])}</span>
      </div>
    </div>
  );
}

function niceStep(raw: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Part-to-whole as labelled horizontal bars (one hue, magnitude only): each row names its
 * category in text and shows the value and share, so nothing depends on colour.
 */
export function ShareBars({ rows }: { rows: { label: string; cents: number; sub?: string }[] }) {
  const total = rows.reduce((s, r) => s + r.cents, 0);
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <div className="grid gap-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>
              {r.label}
              {r.sub && <span className="ml-1 text-xs text-muted-foreground">{r.sub}</span>}
            </span>
            <span className="font-medium tabular-nums">
              {formatRand(r.cents)} <span className="text-xs font-normal text-muted-foreground">{total ? Math.round((r.cents / total) * 100) : 0}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            {r.cents > 0 && <div className="h-2 rounded-full bg-chart-1" style={{ width: `${(r.cents / max) * 100}%` }} />}
          </div>
        </div>
      ))}
    </div>
  );
}
