import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { Cue, SubtitleSettings } from "../api/types";
import { clamp } from "../lib/format";

function hexToRgba(value: string, alpha: number): string {
  const hex = value.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function activeCue(cues: Cue[], time: number): Cue | null {
  for (const cue of cues) {
    if (time >= cue.start - 0.02 && time <= cue.end) return cue;
  }
  return null;
}

function activeWordIndex(cue: Cue, time: number): number {
  if (!cue.words.length) return -1;
  let index = -1;
  for (let i = 0; i < cue.words.length; i += 1) {
    const word = cue.words[i];
    if (time >= word.start - 0.03) index = i;
    if (time <= word.end + 0.06 && time >= word.start - 0.06) return i;
  }
  return time >= cue.end ? index : index;
}

/**
 * Approximate WYSIWYG caption preview. The final burn-in is rendered by FFmpeg
 * with the exact same settings; this preview exists so styling is not guesswork.
 */
export function SubtitleOverlay({
  settings,
  cues,
  time,
  targetWidth,
  targetHeight,
  className,
}: {
  settings: SubtitleSettings;
  cues: Cue[];
  time: number;
  targetWidth: number;
  targetHeight: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  const cue = activeCue(cues, time);
  const scale = width > 0 ? width / Math.max(1, targetWidth) : 0.4;
  const fontSize = Math.max(6, settings.font_size * scale);
  const outline = Math.max(0, settings.outline_width * scale);
  const shadow = Math.max(0, settings.shadow * scale);
  const marginV = settings.margin_v * scale;
  const marginH = settings.margin_h * scale;
  const activeIndex = cue ? activeWordIndex(cue, time) : -1;
  const age = cue ? Math.max(0, time - cue.start) : 0;
  const enter = cue && settings.animation !== "none" ? clamp(age / 0.18, 0, 1) : 1;
  const words = cue ? cue.text.split(/\s+/).filter(Boolean) : [];
  const uppercase = settings.uppercase;
  const text = uppercase ? cue?.text.toUpperCase() : cue?.text;

  const transform =
    settings.animation === "pop"
      ? `scale(${1.1 - 0.1 * enter})`
      : settings.animation === "slide"
        ? `translateY(${(1 - enter) * 10}px)`
        : undefined;
  const opacity = settings.animation === "fade" ? enter : 1;

  return (
    <div
      ref={ref}
      className={clsx(
        "pointer-events-none absolute inset-0 flex flex-col overflow-hidden",
        settings.position === "top"
          ? "justify-start"
          : settings.position === "center"
            ? "justify-center"
            : "justify-end",
        className,
      )}
      style={{
        paddingLeft: marginH,
        paddingRight: marginH,
        paddingTop: settings.position === "top" ? marginV : 0,
        paddingBottom: settings.position === "bottom" ? marginV : 0,
      }}
      aria-hidden
    >
      {cue && (
        <div
          key={`${cue.start}-${cue.end}`}
          className={clsx(
            "w-full",
            settings.alignment === "left"
              ? "text-left"
              : settings.alignment === "right"
                ? "text-right"
                : "text-center",
          )}
          style={{
            fontFamily: `${settings.font_family}, Arial, sans-serif`,
            fontWeight: settings.font_weight === "bold" ? 800 : 500,
            fontSize,
            lineHeight: 1.12,
            letterSpacing: "0.01em",
            color: settings.primary_color,
            WebkitTextStroke: outline > 0 ? `${outline}px ${settings.outline_color}` : undefined,
            textShadow:
              shadow > 0
                ? `0 ${Math.max(1, shadow * 0.8)}px ${Math.max(2, shadow * 1.4)}px rgba(0,0,0,0.72)`
                : undefined,
            opacity,
            transform,
            transformOrigin:
              settings.alignment === "left"
                ? "left bottom"
                : settings.alignment === "right"
                  ? "right bottom"
                  : "center bottom",
            transition: "opacity 80ms linear, transform 80ms linear",
          }}
        >
          {settings.background_opacity > 0 && (
            <span
              className="inline-block max-w-full rounded-lg"
              style={{
                backgroundColor: hexToRgba(
                  settings.background_color,
                  settings.background_opacity,
                ),
                padding: `${fontSize * 0.12}px ${fontSize * 0.28}px`,
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }}
            >
              {renderWords(words, text, activeIndex, settings)}
            </span>
          )}
          {settings.background_opacity <= 0 && renderWords(words, text, activeIndex, settings)}
        </div>
      )}
    </div>
  );
}

function renderWords(
  words: string[],
  text: string | undefined,
  activeIndex: number,
  settings: SubtitleSettings,
) {
  if (!settings.highlight_words || activeIndex < 0 || words.length === 0) {
    return <span>{text}</span>;
  }
  return (
    <>
      {words.map((word, index) => (
        <span
          key={`${word}-${index}`}
          style={{
            color: index === activeIndex ? settings.highlight_color : settings.primary_color,
            display: "inline-block",
            margin: "0 0.16em",
            transform: index === activeIndex ? "translateY(-0.02em)" : undefined,
          }}
        >
          {word}
        </span>
      ))}
    </>
  );
}
