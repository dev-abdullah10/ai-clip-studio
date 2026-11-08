import { useEffect, useState } from "react";
import clsx from "clsx";
import { RotateCcw, Type } from "lucide-react";
import type { SubtitlePreset, SubtitleSettings } from "../api/types";
import {
  SUBTITLE_ANIMATIONS,
  SUBTITLE_POSITIONS,
} from "../lib/constants";
import { FONT_FALLBACKS, SUBTITLE_PRESETS } from "../lib/presets";
import { Toggle } from "./Toggle";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          {label}
        </span>
        <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-xs tabular-nums text-slate-300">
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
      {hint && <p className="mt-1 text-xs leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase text-slate-400">{value}</span>
        <input
          type="color"
          value={value.length === 9 ? value.slice(0, 7) : value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-6 w-7 rounded-md"
          aria-label={label}
        />
      </span>
    </label>
  );
}

export function SubtitleStyleEditor({
  value,
  onChange,
  presets,
  fonts,
}: {
  value: SubtitleSettings;
  onChange: (value: SubtitleSettings) => void;
  presets?: Record<string, SubtitlePreset>;
  fonts?: Array<{ name: string; available: boolean }>;
}) {
  const presetMap = presets && Object.keys(presets).length ? presets : SUBTITLE_PRESETS;
  const [fontOptions, setFontOptions] = useState<string[]>(FONT_FALLBACKS);

  useEffect(() => {
    const available = (fonts || [])
      .filter((font) => font.available)
      .map((font) => font.name);
    if (available.length) {
      setFontOptions(Array.from(new Set([...available, ...FONT_FALLBACKS])));
    }
  }, [fonts]);

  const update = <K extends keyof SubtitleSettings>(key: K, next: SubtitleSettings[K]) => {
    onChange({ ...value, [key]: next, preset: key === "preset" ? value.preset : "custom" });
  };

  const applyPreset = (presetId: string) => {
    const preset = presetMap[presetId];
    if (!preset) return;
    const { label: _label, ...values } = preset;
    onChange({ ...value, ...values, preset: presetId } as SubtitleSettings);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label mb-0">Style presets</span>
          <span className="text-xs text-slate-400">
            {presetMap[value.preset]?.label || "Custom style"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {Object.entries(presetMap).map(([id, preset]) => (
            <button
              key={id}
              type="button"
              onClick={() => applyPreset(id)}
              className={clsx(
                "rounded-lg border px-2 py-2 text-left text-xs font-medium transition",
                value.preset === id
                  ? "border-accent-400/60 bg-accent-500/15 text-white"
                  : "border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-white/15 hover:text-slate-200",
              )}
            >
              <span className="flex items-center gap-1.5">
                <Type size={11} className="shrink-0" />
                <span className="truncate">{preset.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Font family">
          <select
            className="select"
            value={value.font_family}
            onChange={(event) => update("font_family", event.target.value)}
          >
            {fontOptions.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weight">
          <select
            className="select"
            value={value.font_weight}
            onChange={(event) => update("font_weight", event.target.value)}
          >
            <option value="normal">Regular</option>
            <option value="bold">Bold</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <RangeField
          label="Font size"
          value={value.font_size}
          min={16}
          max={200}
          suffix="px"
          onChange={(next) => update("font_size", next)}
          hint="Relative to the 1080px short side of the output."
        />
        <RangeField
          label="Outline"
          value={value.outline_width}
          min={0}
          max={12}
          step={0.5}
          onChange={(next) => update("outline_width", next)}
        />
        <RangeField
          label="Shadow"
          value={value.shadow}
          min={0}
          max={12}
          step={0.5}
          onChange={(next) => update("shadow", next)}
        />
        <RangeField
          label="Background opacity"
          value={value.background_opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(next) => update("background_opacity", next)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ColorField
          label="Text"
          value={value.primary_color}
          onChange={(next) => update("primary_color", next)}
        />
        <ColorField
          label="Highlight"
          value={value.highlight_color}
          onChange={(next) => update("highlight_color", next)}
        />
        <ColorField
          label="Outline"
          value={value.outline_color}
          onChange={(next) => update("outline_color", next)}
        />
        <ColorField
          label="Background"
          value={value.background_color}
          onChange={(next) => update("background_color", next)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Position">
          <div className="grid grid-cols-3 gap-1">
            {SUBTITLE_POSITIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => update("position", option.value as SubtitleSettings["position"])}
                className={clsx(
                  "rounded-lg border px-2 py-2 text-xs font-medium transition",
                  value.position === option.value
                    ? "border-accent-400/60 bg-accent-500/15 text-white"
                    : "border-white/[0.07] bg-white/[0.02] text-slate-400 hover:text-slate-200",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Alignment">
          <div className="grid grid-cols-3 gap-1">
            {(["left", "center", "right"] as const).map((alignment) => (
              <button
                key={alignment}
                type="button"
                onClick={() => update("alignment", alignment)}
                className={clsx(
                  "rounded-lg border px-2 py-2 text-xs font-medium capitalize transition",
                  value.alignment === alignment
                    ? "border-accent-400/60 bg-accent-500/15 text-white"
                    : "border-white/[0.07] bg-white/[0.02] text-slate-400 hover:text-slate-200",
                )}
              >
                {alignment}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <RangeField
          label="Vertical margin"
          value={value.margin_v}
          min={0}
          max={700}
          suffix="px"
          onChange={(next) => update("margin_v", next)}
        />
        <RangeField
          label="Horizontal margin"
          value={value.margin_h}
          min={0}
          max={400}
          suffix="px"
          onChange={(next) => update("margin_h", next)}
        />
        <RangeField
          label="Max words per line"
          value={value.max_words_per_line}
          min={1}
          max={14}
          onChange={(next) => update("max_words_per_line", next)}
        />
        <RangeField
          label="Max characters per line"
          value={value.max_chars_per_line}
          min={8}
          max={80}
          onChange={(next) => update("max_chars_per_line", next)}
        />
      </div>

      <Field label="Animation">
        <select
          className="select"
          value={value.animation}
          onChange={(event) =>
            update("animation", event.target.value as SubtitleSettings["animation"])
          }
        >
          {SUBTITLE_ANIMATIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="panel-soft space-y-3 p-3.5">
        <Toggle
          checked={value.uppercase}
          onChange={(next) => update("uppercase", next)}
          label="Uppercase captions"
          description="Transform every caption to capitals."
        />
        <Toggle
          checked={value.highlight_words}
          onChange={(next) => update("highlight_words", next)}
          label="Highlight the spoken word"
          description="Colour the active word for karaoke-style captions."
        />
      </div>

      <button
        type="button"
        className="btn-ghost btn-xs"
        onClick={() => applyPreset("bold_creator")}
      >
        <RotateCcw size={12} />
        Reset to Bold Creator
      </button>
    </div>
  );
}
