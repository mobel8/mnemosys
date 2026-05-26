/**
 * Generic loading skeleton primitives.
 *
 * These are intentionally style-light so any route can swap them in for
 * its initial render without committing to a layout. Used by Settings
 * today; B2/B3/B4 can adopt them in Session 2.
 *
 * Three building blocks:
 *   - <Skeleton />        : plain animated block (use for one-off shapes)
 *   - <SkeletonCard />    : card-sized block (h-32)
 *   - <SkeletonList />    : N stacked lines
 *   - <SkeletonStat />    : small stat card placeholder
 */

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
  );
}

export function SkeletonCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Skeleton className={cn("h-32 w-full", className)} {...props} />;
}

interface SkeletonListProps extends HTMLAttributes<HTMLDivElement> {
  items?: number;
  rowClassName?: string;
}

export function SkeletonList({ items = 5, className, rowClassName, ...props }: SkeletonListProps) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      {Array.from({ length: items }).map((_, i) => (
        <Skeleton
          // Index is acceptable for a fixed-length skeleton list (no reorder).
          // biome-ignore lint/suspicious/noArrayIndexKey: <static placeholders>
          key={i}
          className={cn("h-10 w-full", rowClassName)}
        />
      ))}
    </div>
  );
}

export function SkeletonStat({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-sm", className)} {...props}>
      <Skeleton className="mb-3 h-3 w-20" />
      <Skeleton className="h-7 w-16" />
    </div>
  );
}
