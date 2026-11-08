import clsx from "clsx";

export function ProgressBar({
  value,
  className,
  tone = "violet",
  showGlow = false,
}: {
  value: number;
  className?: string;
  tone?: "violet" | "green" | "amber" | "rose" | "slate";
  showGlow?: boolean;
}) {
  const tones: Record<string, string> = {
    violet: "bg-accent-500",
    green: "bg-mint-500",
    amber: "bg-gold-400",
    rose: "bg-rose-500",
    slate: "bg-slate-600",
  };
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}>
      <div
        className={clsx(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          tones[tone],
          showGlow && "shadow-[0_0_10px_rgba(137,101,245,0.45)]",
        )}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
