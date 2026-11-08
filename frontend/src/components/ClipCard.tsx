import { Link } from "react-router-dom";
import clsx from "clsx";
import { Clock3, Download, Film, Sparkles } from "lucide-react";
import type { Clip } from "../api/types";
import { formatDuration, truncate } from "../lib/format";
import { ScoreRing } from "./ScoreRing";
import { StatusBadge } from "./StatusBadge";

export function ClipCard({
  clip,
  selected,
  onToggle,
}: {
  clip: Clip;
  selected?: boolean;
  onToggle?: (clip: Clip) => void;
}) {
  return (
    <div
      className={clsx(
        "group relative overflow-hidden rounded-xl border bg-base-850 transition duration-200",
        selected
          ? "border-accent-500/60 ring-1 ring-accent-500/25"
          : "border-white/[0.06] hover:border-white/[0.13]",
      )}
    >
      {onToggle && (
        <button
          type="button"
          onClick={() => onToggle(clip)}
          aria-label={selected ? "Deselect clip" : "Select clip"}
          className={clsx(
            "absolute left-3 top-3 z-20 flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold transition",
            selected
              ? "border-accent-300 bg-accent-500 text-white"
              : "border-white/30 bg-black/45 text-transparent backdrop-blur hover:border-white/70",
          )}
        >
          ✓
        </button>
      )}
      <Link to={`/clips/${clip.id}`} className="block">
        <div className="relative aspect-video overflow-hidden bg-base-800">
          {clip.thumbnail_url ? (
            <img
              src={clip.thumbnail_url}
              alt=""
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-600">
              <Film size={26} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
          <div className="absolute right-2.5 top-2.5 rounded-full bg-black/45 p-0.5 backdrop-blur">
            <ScoreRing score={clip.score} size={38} stroke={3} />
          </div>
          <div className="absolute bottom-2.5 left-3 flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              <Clock3 size={10} />
              {formatDuration(clip.duration)}
            </span>
            {clip.has_render && (
              <span className="flex items-center gap-1 rounded-md bg-mint-500/25 px-1.5 py-0.5 text-[11px] font-medium text-mint-300 backdrop-blur">
                <Download size={10} />
                Rendered
              </span>
            )}
          </div>
        </div>
        <div className="p-3.5">
          <h3 className="line-clamp-2 min-h-[2.4rem] text-[13px] font-semibold leading-snug text-white">
            {clip.title}
          </h3>
          <p className="mt-1 line-clamp-2 min-h-[2rem] text-[12px] leading-relaxed text-slate-400">
            {truncate(clip.reason || clip.hook || clip.description, 130)}
          </p>
          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/[0.05] pt-2.5">
            <span className="badge-neutral max-w-[100px] truncate capitalize">
              <Sparkles size={9} />
              {clip.category}
            </span>
            <span className="shrink-0 text-[11px] text-slate-500">
              {clip.aspect_ratio === "original" ? "Original" : clip.aspect_ratio}
            </span>
          </div>
        </div>
      </Link>
      {clip.render_status !== "none" && (
        <span className="absolute right-2.5 top-[56px]">
          <StatusBadge status={clip.render_status} />
        </span>
      )}
    </div>
  );
}
