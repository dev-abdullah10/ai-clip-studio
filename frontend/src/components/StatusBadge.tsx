import clsx from "clsx";
import { statusLabel } from "../lib/format";

const STYLES: Record<string, string> = {
  draft: "badge-neutral",
  processing: "badge-violet",
  ready: "badge-green",
  completed: "badge-green",
  approved: "badge-green",
  error: "badge-rose",
  failed: "badge-rose",
  rejected: "badge-rose",
  queued: "badge-neutral",
  running: "badge-violet",
  cancellation: "badge-amber",
  cancelled: "badge-neutral",
  stale: "badge-amber",
  rendering: "badge-violet",
  none: "badge-neutral",
  suggested: "badge-neutral",
};

const DOTS: Record<string, string> = {
  processing: "bg-accent-300 animate-pulse",
  running: "bg-accent-300 animate-pulse",
  rendering: "bg-accent-300 animate-pulse",
  ready: "bg-mint-400",
  completed: "bg-mint-400",
  approved: "bg-mint-400",
  error: "bg-rose-400",
  failed: "bg-rose-400",
  rejected: "bg-rose-400",
  stale: "bg-gold-400",
  queued: "bg-slate-400",
  cancelled: "bg-slate-500",
  none: "bg-slate-500",
  draft: "bg-slate-400",
  suggested: "bg-slate-400",
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  return (
    <span className={clsx(STYLES[status] || "badge-neutral", className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", DOTS[status] || "bg-slate-400")} />
      {label || statusLabel(status)}
    </span>
  );
}
