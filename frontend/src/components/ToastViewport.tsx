import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastStore, type ToastKind } from "../store/ui";

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} satisfies Record<ToastKind, typeof Info>;

const TONES: Record<ToastKind, string> = {
  success: "text-mint-400",
  error: "text-rose-400",
  warning: "text-gold-400",
  info: "text-accent-300",
};

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,390px)] flex-col gap-2">
      {toasts.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={item.id}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-white/[0.09] bg-base-800 p-3.5 shadow-raised animate-slide-in"
          >
            <Icon size={17} className={`mt-0.5 shrink-0 ${TONES[item.kind]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-white">{item.title}</p>
              {item.message && (
                <p className="mt-0.5 text-[12px] leading-relaxed text-slate-400">{item.message}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(item.id)}
              className="rounded p-0.5 text-slate-500 transition hover:text-white"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
