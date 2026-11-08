import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-center",
        compact ? "px-6 py-8" : "px-8 py-14",
      )}
    >
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-400">
        <Icon size={20} />
      </div>
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
