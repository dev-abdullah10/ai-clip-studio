import { useMemo, useRef } from "react";
import clsx from "clsx";
import { Crop, Focus } from "lucide-react";
import { aspectValue, clamp } from "../lib/format";

export function CropFramePreview({
  imageUrl,
  sourceWidth,
  sourceHeight,
  aspectRatio,
  cropMode,
  cropOffset,
  onOffsetChange,
  className,
}: {
  imageUrl: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  aspectRatio: string;
  cropMode: string;
  cropOffset: number;
  onOffsetChange?: (value: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sourceAspect =
    sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 16 / 9;
  const targetAspect = aspectRatio === "original" ? sourceAspect : aspectValue(aspectRatio);

  const rect = useMemo(() => {
    if (cropMode === "original") {
      return { x: 0, y: 0, w: 1, h: 1, cropped: false, axis: "none" as const };
    }
    if (sourceAspect > targetAspect) {
      const w = clamp(targetAspect / sourceAspect, 0.05, 1);
      const center = cropMode === "center" ? 0.5 : clamp(cropOffset, 0, 1);
      const x = clamp(center - w / 2, 0, 1 - w);
      return { x, y: 0, w, h: 1, cropped: w < 0.999, axis: "x" as const };
    }
    if (sourceAspect < targetAspect) {
      const h = clamp(sourceAspect / targetAspect, 0.05, 1);
      const center = cropMode === "center" ? 0.5 : clamp(cropOffset, 0, 1);
      const y = clamp(center - h / 2, 0, 1 - h);
      return { x: 0, y, w: 1, h, cropped: h < 0.999, axis: "y" as const };
    }
    return { x: 0, y: 0, w: 1, h: 1, cropped: false, axis: "none" as const };
  }, [sourceAspect, targetAspect, cropMode, cropOffset]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onOffsetChange || !rect.cropped) return;
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return;
    const nx = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const ny = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    onOffsetChange(rect.axis === "x" ? nx : ny);
  };

  return (
    <div className={clsx("space-y-2", className)}>
      <div
        ref={ref}
        className={clsx(
          "relative w-full overflow-hidden rounded-lg border border-white/[0.08] bg-base-900",
          onOffsetChange && rect.cropped && "cursor-crosshair",
        )}
        style={{ aspectRatio: sourceAspect }}
        onClick={handleClick}
        role={onOffsetChange ? "button" : undefined}
        tabIndex={onOffsetChange ? 0 : undefined}
        title={onOffsetChange ? "Click to place the subject inside the crop" : undefined}
        onKeyDown={(event) => {
          if (!onOffsetChange || !rect.cropped) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const delta = event.key === "ArrowLeft" ? -0.02 : 0.02;
            onOffsetChange(clamp(cropOffset + delta, 0, 1));
          }
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Source frame"
            className="h-full w-full select-none object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            No preview frame available
          </div>
        )}

        {rect.cropped && (
          <div
            className="absolute border-2 border-accent-300 shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
          >
            <span className="absolute inset-x-0 top-0 flex justify-between px-1.5 py-1">
              <Corner />
              <Corner flip />
            </span>
            <span className="absolute inset-x-0 bottom-0 flex justify-between px-1.5 py-1">
              <Corner bottom />
              <Corner bottom flip />
            </span>
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-black/55 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
              {aspectRatio === "original" ? "Original" : aspectRatio}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white/90 backdrop-blur">
          <Crop size={11} />
          {cropMode === "original"
            ? "Blurred pad"
            : cropMode === "face"
              ? "Face aware"
              : cropMode === "manual"
                ? "Manual crop"
                : "Center crop"}
        </div>
        <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white/80 backdrop-blur">
          <Focus size={11} />
          {sourceWidth && sourceHeight ? `${sourceWidth}×${sourceHeight}` : "Source"}
        </div>
      </div>
      {rect.cropped && (
        <p className="text-xs leading-relaxed text-slate-400">
          {onOffsetChange
            ? "Click or use the arrow keys to position the subject. The crop follows your subject, not the frame."
            : "The selected aspect ratio crops the source to keep the subject in frame."}
        </p>
      )}
    </div>
  );
}

function Corner({ flip = false, bottom = false }: { flip?: boolean; bottom?: boolean }) {
  return (
    <span
      className="block"
      style={{
        width: 10,
        height: 10,
        borderTop: bottom ? undefined : "2px solid #B9A7FF",
        borderBottom: bottom ? "2px solid #B9A7FF" : undefined,
        borderLeft: flip ? undefined : "2px solid #B9A7FF",
        borderRight: flip ? "2px solid #B9A7FF" : undefined,
      }}
    />
  );
}
