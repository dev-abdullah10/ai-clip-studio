import { useMemo } from "react";
import clsx from "clsx";
import { Info, Wand2 } from "lucide-react";
import type { AnalysisSettings, ProviderInfo } from "../api/types";
import { DISCOVERY_MODES } from "../lib/constants";
import { clamp } from "../lib/format";
import { Toggle } from "./Toggle";

const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "tr", label: "Turkish" },
  { value: "ru", label: "Russian" },
  { value: "uk", label: "Ukrainian" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "id", label: "Indonesian" },
  { value: "vi", label: "Vietnamese" },
  { value: "th", label: "Thai" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
];

const WEIGHT_LABELS: Record<string, string> = {
  interesting: "Interesting",
  hook: "Hook strength",
  standalone: "Stand-alone",
  value: "Value",
  emotion: "Emotion",
  payoff: "Payoff",
  clarity: "Clarity",
};

const DEFAULT_WEIGHTS: Record<string, number> = {
  interesting: 0.2,
  hook: 0.2,
  standalone: 0.2,
  value: 0.15,
  emotion: 0.1,
  payoff: 0.1,
  clarity: 0.05,
};

function ProviderBadge({ provider }: { provider?: ProviderInfo }) {
  if (!provider) return null;
  return (
    <span
      className={clsx("badge shrink-0", provider.configured ? "badge-green" : "badge-amber")}
      title={provider.free_tier}
    >
      {provider.configured ? "Ready" : "Needs setup"}
    </span>
  );
}

export function AnalysisSettingsForm({
  value,
  onChange,
  speechProviders,
  llmProviders,
}: {
  value: AnalysisSettings;
  onChange: (next: AnalysisSettings) => void;
  speechProviders: ProviderInfo[];
  llmProviders: ProviderInfo[];
}) {
  const speech = speechProviders.find((provider) => provider.id === value.speech_provider);
  const llm = llmProviders.find((provider) => provider.id === value.llm_provider);
  const speechModels = speech?.models?.length ? speech.models : [];
  const llmModels = llm?.models?.length ? llm.models : [];

  const weightTotal = useMemo(
    () => Object.values(value.scoring_weights).reduce((sum, weight) => sum + weight, 0),
    [value.scoring_weights],
  );

  const update = <K extends keyof AnalysisSettings>(key: K, next: AnalysisSettings[K]) =>
    onChange({ ...value, [key]: next });

  const setMin = (next: number) => {
    const min = clamp(next, 5, 300);
    onChange({
      ...value,
      min_duration: min,
      max_duration: Math.max(min + 5, value.max_duration),
    });
  };

  const setMax = (next: number) => {
    const max = clamp(next, 10, 600);
    onChange({
      ...value,
      max_duration: max,
      min_duration: Math.min(value.min_duration, max - 5),
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="label">What should the AI look for?</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DISCOVERY_MODES.map((mode) => {
            const active = value.discovery_mode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => update("discovery_mode", mode.value)}
                className={clsx(
                  "rounded-lg border px-3 py-2.5 text-left transition",
                  active
                    ? "border-accent-400/50 bg-accent-500/[0.12]"
                    : "border-white/[0.06] bg-white/[0.018] hover:border-white/[0.13] hover:bg-white/[0.03]",
                )}
              >
                <span
                  className={clsx(
                    "block text-[12px] font-semibold",
                    active ? "text-white" : "text-slate-200",
                  )}
                >
                  {mode.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                  {mode.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="label">
          Custom instructions {value.discovery_mode === "custom" ? "(required)" : "(optional)"}
        </label>
        <textarea
          className="input min-h-[78px] resize-y"
          placeholder="Example: Prefer moments where the guest tells a personal story, avoid politics, keep the strongest punchline at the start."
          value={value.custom_instructions}
          maxLength={4000}
          onChange={(event) => update("custom_instructions", event.target.value)}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          {value.discovery_mode === "custom"
            ? "Required for custom mode: describe exactly what a great clip is for this video."
            : "Added on top of the selected discovery mode."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-medium text-slate-300">Clips to find</span>
            <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[11px] tabular-nums text-slate-300">
              {value.clip_count}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            value={value.clip_count}
            onChange={(event) => update("clip_count", Number(event.target.value))}
            className="w-full"
          />
        </div>
        <div className="panel-soft px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-300">
            <Info size={12} className="text-accent-300" />
            Output length
          </p>
          <p className="mt-1 text-[12px] tabular-nums text-slate-200">
            {value.min_duration}s – {value.max_duration}s per clip
          </p>
        </div>
        <div>
          <span className="label">Minimum duration (seconds)</span>
          <input
            type="number"
            className="input"
            min={5}
            max={300}
            value={value.min_duration}
            onChange={(event) => setMin(Number(event.target.value))}
          />
        </div>
        <div>
          <span className="label">Maximum duration (seconds)</span>
          <input
            type="number"
            className="input"
            min={10}
            max={600}
            value={value.max_duration}
            onChange={(event) => setMax(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-slate-300">Speech-to-text provider</span>
            <ProviderBadge provider={speech} />
          </div>
          <select
            className="select"
            value={value.speech_provider}
            onChange={(event) =>
              onChange({
                ...value,
                speech_provider: event.target.value,
                speech_model: null,
              })
            }
          >
            {speechProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          {speechModels.length > 0 && (
            <select
              className="select mt-1.5"
              value={value.speech_model || ""}
              onChange={(event) => update("speech_model", event.target.value || null)}
            >
              <option value="">Provider default ({speech?.default_model || "auto"})</option>
              {speechModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          )}
          {speech && !speech.configured && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-gold-300">
              {speech.requires_key
                ? "No API key saved for this provider yet."
                : "This provider is not available on this PC yet."}{" "}
              Configure it in Settings.
            </p>
          )}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-slate-300">Clip-analysis provider</span>
            <ProviderBadge provider={llm} />
          </div>
          <select
            className="select"
            value={value.llm_provider}
            onChange={(event) =>
              onChange({ ...value, llm_provider: event.target.value, llm_model: null })
            }
          >
            {llmProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          {llmModels.length > 0 && (
            <select
              className="select mt-1.5"
              value={value.llm_model || ""}
              onChange={(event) => update("llm_model", event.target.value || null)}
            >
              <option value="">Provider default ({llm?.default_model || "auto"})</option>
              {llmModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          )}
          {llm && !llm.configured && value.llm_provider !== "local" && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-gold-300">
              This analysis provider is not configured. Enable “fall back to local heuristics”
              below, or set it up in Settings.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="label">Spoken language</label>
        <select
          className="select"
          value={value.language}
          onChange={(event) => update("language", event.target.value)}
        >
          {LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-slate-500">
          Auto-detect lets the speech provider decide. Set it when a provider mislabels the
          language.
        </p>
      </div>

      <div className="panel-soft space-y-3.5 p-4">
        <Toggle
          checked={value.visual_analysis}
          onChange={(next) => update("visual_analysis", next)}
          label="Align clips to scene changes"
          description="Detects real cut points with FFmpeg locally and nudges clip boundaries onto them. No frames are uploaded."
        />
        <Toggle
          checked={value.use_faces}
          onChange={(next) => update("use_faces", next)}
          label="Detect faces for smarter cropping"
          description="Samples frames locally with OpenCV to position the subject in vertical crops."
        />
        <Toggle
          checked={value.allow_llm_fallback}
          onChange={(next) => update("allow_llm_fallback", next)}
          label="Fall back to local scoring if AI fails"
          description="Keeps the pipeline working when a cloud provider is rate-limited or offline. Warnings are shown honestly in the analysis summary."
        />
      </div>

      <details className="rounded-lg border border-white/[0.06] bg-white/[0.018]">
        <summary className="cursor-pointer px-4 py-3 text-[12px] font-medium text-slate-300 transition hover:text-white">
          Advanced scoring weights
        </summary>
        <div className="space-y-2.5 border-t border-white/[0.06] px-4 py-4">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Relative importance of each signal. The analyzer normalizes them to 1.0. The local
            heuristic score is always calculated too, so you can compare.
          </p>
          {Object.entries(value.scoring_weights).map(([key, weight]) => (
            <div key={key} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-[11px] text-slate-400">
                {WEIGHT_LABELS[key] || key}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={weight}
                onChange={(event) =>
                  update("scoring_weights", {
                    ...value.scoring_weights,
                    [key]: Number(event.target.value),
                  })
                }
                className="flex-1"
              />
              <span className="w-9 text-right text-[11px] tabular-nums text-slate-500">
                {Math.round((weight / (weightTotal || 1)) * 100)}%
              </span>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={() => update("scoring_weights", { ...DEFAULT_WEIGHTS })}
          >
            <Wand2 size={12} />
            Reset weights
          </button>
        </div>
      </details>
    </div>
  );
}
