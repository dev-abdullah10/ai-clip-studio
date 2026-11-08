import clsx from "clsx";

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        "flex cursor-pointer items-start justify-between gap-4",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-200">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-400">
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative mt-0.5 h-[22px] w-[40px] shrink-0 rounded-full border transition-colors",
          checked
            ? "border-accent-500/60 bg-accent-500"
            : "border-white/10 bg-white/[0.09]",
        )}
      >
        <span
          className={clsx(
            "absolute top-[2px] rounded-full bg-white shadow transition-all duration-200",
            checked ? "left-[20px]" : "left-[2px]",
          )}
          style={{ width: 16, height: 16 }}
        />
      </button>
    </label>
  );
}
