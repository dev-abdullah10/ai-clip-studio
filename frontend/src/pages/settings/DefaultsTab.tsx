import { useMemo, useState } from "react";
import clsx from "clsx";
import { Captions, Loader2, Save, Sparkles, TriangleAlert } from "lucide-react";
import { api } from "../../api/client";
import type { AppSettings, Cue, SettingsResponse, SubtitleSettings } from "../../api/types";
import { SubtitleOverlay } from "../../components/SubtitleOverlay";
import { SubtitleStyleEditor } from "../../components/SubtitleStyleEditor";
import { Toggle } from "../../components/Toggle";
import {
  ASPECT_RATIOS,
  FPS_OPTIONS,
  QUALITIES,
  RESOLUTIONS,
  SAMPLE_SUBTITLE_TEXT,
} from "../../lib/constants";
import { clamp } from "../../lib/format";
import { toast } from "../../store/ui";

function sampleCues(text: string): Cue[] {
  const words = text.split(/\s+/).filter(Boolean);
  const step = 0.34;
  return [
    {
      start: 0,
      end: 10,
      text,
      words: words.map((word, index) => ({
        start: index * step,
        end: (index + 1) * step,
        word,
      })),
    },
  ];
}

export function DefaultsTab({
  data,
  draft,
  setDraft,
  onRefresh,
}: {
  data: SettingsResponse;
  draft: AppSettings;
  setDraft: (updater: (current: AppSettings) => AppSettings) => void;
  onRefresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const cues = useMemo(() => sampleCues(SAMPLE_SUBTITLE_TEXT), []);
  const sampleTime = 1.35;
  const targetWidth = draft.video.aspect_ratio === "16:9" ? 1920 : 1080;
  const targetHeight =
    draft.video.aspect_ratio === "16:9"
      ? 1080
      : draft.video.aspect_ratio === "1:1"
        ? 1080
        : draft.video.aspect_ratio === "4:5"
          ? 1350
          : 1920;

  const updateVideo = (partial: Partial<AppSettings["video"]>) =>
    setDraft((current) => ({ ...current, video: { ...current.video, ...partial } }));

  const updatePerformance = (partial: Partial<AppSettings["performance"]>) =>
    setDraft((current) => ({
      ...current,
      performance: { ...current.performance, ...partial },
    }));

  const updateSubtitles = (next: SubtitleSettings) =>
    setDraft((current) => ({ ...current, subtitles: next }));

  const save = async () => {
    setSaving(true);
    try {
      await api.patchSettings({
        video: draft.video,
        subtitles: draft.subtitles,
        performance: draft.performance,
        visual_analysis_default: draft.visual_analysis_default,
      });
      await onRefresh();
      toast.success("Defaults saved", "New imports and exports will use these settings.");
    } catch (caught) {
      toast.error("Could not save defaults", caught instanceof Error ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="text-[16px] font-semibold text-white">Video defaults</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
              The starting point for new projects and exports. Every clip can override these.
            </p>
          </div>
          <span className="chip shrink-0">
            <Sparkles size={11} />
            {data.limits.max_upload_mb} MB import limit
          </span>
        </div>

        <div className="p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Aspect ratio</label>
              <select
                className="select"
                value={draft.video.aspect_ratio}
                onChange={(event) => updateVideo({ aspect_ratio: event.target.value })}
              >
                {ASPECT_RATIOS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} · {option.value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Resolution</label>
              <select
                className="select"
                value={draft.video.resolution}
                onChange={(event) => updateVideo({ resolution: event.target.value })}
              >
                {RESOLUTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Frame rate</label>
              <select
                className="select"
                value={draft.video.fps}
                onChange={(event) => updateVideo({ fps: Number(event.target.value) })}
              >
                {FPS_OPTIONS.map((fps) => (
                  <option key={fps} value={fps}>
                    {fps} fps
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Quality</label>
              <select
                className="select"
                value={draft.video.quality}
                onChange={(event) => updateVideo({ quality: event.target.value })}
              >
                {QUALITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Clips to find</label>
              <input
                type="number"
                className="input"
                min={1}
                max={50}
                value={draft.video.clip_count}
                onChange={(event) =>
                  updateVideo({ clip_count: clamp(Number(event.target.value), 1, 50) })
                }
              />
            </div>
            <div>
              <label className="label">Minimum clip length</label>
              <input
                type="number"
                className="input"
                min={5}
                max={300}
                value={draft.video.min_duration}
                onChange={(event) => {
                  const min = clamp(Number(event.target.value), 5, 300);
                  updateVideo({
                    min_duration: min,
                    max_duration: Math.max(min + 5, draft.video.max_duration),
                  });
                }}
              />
            </div>
            <div>
              <label className="label">Maximum clip length</label>
              <input
                type="number"
                className="input"
                min={10}
                max={600}
                value={draft.video.max_duration}
                onChange={(event) => {
                  const max = clamp(Number(event.target.value), 10, 600);
                  updateVideo({
                    max_duration: max,
                    min_duration: Math.min(draft.video.min_duration, max - 5),
                  });
                }}
              />
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-lg border border-white/[0.06] bg-base-925/60 px-3 py-2.5 text-[12px] leading-relaxed text-slate-400">
                {draft.video.min_duration}s–{draft.video.max_duration}s each ·{" "}
                {draft.video.clip_count} requested
              </div>
            </div>
          </div>

          <div className="panel-soft mt-4 p-3.5">
            <Toggle
              checked={draft.visual_analysis_default}
              onChange={(next) =>
                setDraft((current) => ({ ...current, visual_analysis_default: next }))
              }
              label="Enable scene alignment on new projects"
              description="Uses FFmpeg scene detection locally to snap clip boundaries to real cuts."
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-300">
              <Captions size={16} />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold text-white">Default caption style</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
                Used for new clips and when rendering without a saved per-clip style.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <SubtitleStyleEditor
            value={draft.subtitles}
            onChange={updateSubtitles}
            presets={data.subtitle_presets}
            fonts={data.fonts}
          />
          <div className="lg:sticky lg:top-24 lg:h-fit">
            <p className="label">Live preview</p>
            <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-black">
              <div
                className="relative"
                style={{ aspectRatio: `${targetWidth} / ${targetHeight}` }}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(137,101,245,0.28),transparent_55%),radial-gradient(circle_at_75%_80%,rgba(96,165,250,0.12),transparent_50%),linear-gradient(160deg,#15151c,#08080c)]" />
                <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
                <SubtitleOverlay
                  settings={draft.subtitles}
                  cues={cues}
                  time={sampleTime}
                  targetWidth={targetWidth}
                  targetHeight={targetHeight}
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Preview uses the same layout maths as the ASS burn-in. Fonts must be installed on
              this PC for the final render.
            </p>
            <div className="panel-soft mt-3 px-3 py-2.5">
              <p className="text-[12px] font-medium text-slate-300">Font availability</p>
              <div className="mt-1.5 space-y-1">
                {data.fonts
                  .filter((font) => ["Arial", "Segoe UI", "Verdana", "Impact"].includes(font.name))
                  .map((font) => (
                    <p
                      key={font.name}
                      className="flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="text-slate-400">{font.name}</span>
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1 font-medium",
                          font.available ? "text-mint-400" : "text-gold-300",
                        )}
                      >
                        <span
                          className={clsx(
                            "h-1.5 w-1.5 rounded-full",
                            font.available ? "bg-mint-400" : "bg-gold-400",
                          )}
                        />
                        {font.available ? "installed" : "missing"}
                      </span>
                    </p>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="text-[16px] font-semibold text-white">Performance</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
              Wired directly into the job runner and FFmpeg. Concurrency changes take effect after
              restarting the studio.
            </p>
          </div>
        </div>
        <div className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Concurrent jobs</label>
              <select
                className="select"
                value={draft.performance.max_concurrent_jobs}
                onChange={(event) =>
                  updatePerformance({ max_concurrent_jobs: Number(event.target.value) })
                }
              >
                {[1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? "job" : "jobs"}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-slate-500">Applies after a backend restart.</p>
            </div>
            <div>
              <label className="label">FFmpeg threads</label>
              <input
                type="number"
                className="input"
                min={0}
                max={64}
                value={draft.performance.ffmpeg_threads}
                onChange={(event) =>
                  updatePerformance({
                    ffmpeg_threads: clamp(Number(event.target.value), 0, 64),
                  })
                }
              />
              <p className="mt-1.5 text-[11px] text-slate-500">
                0 lets FFmpeg choose automatically.
              </p>
            </div>
            <div className="panel-soft sm:col-span-2 p-3.5">
              <Toggle
                checked={draft.performance.prefer_gpu_encoding}
                onChange={(next) => updatePerformance({ prefer_gpu_encoding: next })}
                label="Prefer NVIDIA GPU encoding (NVENC)"
                description={
                  data.tools.nvenc
                    ? "NVENC is available in this FFmpeg build. It falls back to libx264 automatically if the driver refuses the job."
                    : "NVENC was not detected in this FFmpeg build. Rendering will use libx264 until a GPU-capable build is installed."
                }
              />
              {!data.tools.nvenc && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-gold-300">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                  The bundled FFmpeg build may list NVENC but no compatible NVIDIA driver was found.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">
          Changes apply to new imports and renders. Existing clips keep their saved settings.
        </p>
        <button className="btn-primary shrink-0" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save defaults
        </button>
      </div>
    </div>
  );
}
