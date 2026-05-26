/**
 * Tab-style period switcher for the stats dashboard.
 *
 * Renders four pill buttons (7 days / 30 days / 90 days / 1 year) and
 * notifies the parent via `onChange`. Implemented with Radix `Tabs.Root`
 * so keyboard arrow navigation and focus management come for free.
 */

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Period } from "@/lib/date";

interface PeriodSelectorProps {
  value: Period;
  onChange: (period: Period) => void;
}

const OPTIONS: { value: Period; label: string }[] = [
  { value: "7d", label: "7 j" },
  { value: "30d", label: "30 j" },
  { value: "90d", label: "90 j" },
  { value: "365d", label: "1 an" },
];

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        onChange(next as Period);
      }}
      aria-label="Période"
    >
      <TabsList>
        {OPTIONS.map((opt) => (
          <TabsTrigger key={opt.value} value={opt.value}>
            {opt.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
