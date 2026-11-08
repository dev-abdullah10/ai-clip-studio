import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CheckSquare, Download, Package, Square, TriangleAlert } from "lucide-react";
import { api } from "../api/client";
import type { AppSettings, Clip, ExportSettings, Job } from "../api/types";
import {
  ASPECT_RATIOS,
  FPS_OPTIONS,
  QUALITIES,
  RESOLUTIONS,
} from "../lib/constants";
import { exportSettingsFor } from "../lib/defaults";
import { formatDuration, plural } from "../lib/format";
import { toast } from "../store/ui";
import { Modal } from "./Modal";
import { Toggle } from "./Toggle";

export function ExportDialog({
  open,
  onClose,
  projectId,
  projectName,
  clips,
  initialSelection,
  appSettings,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  clips: Clip[];
  initialSelection?: string[];
  appSettings?: AppSettings | null;
  onStarted?: (job: Job) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<ExportSettings>(() => exportSettingsFor(undefined));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ids =
      initialSelection && initialSelection.length
        ? initialSelection
        : clips.map((clip) => clip.id);
    setSelected(ids);
    const first = clips.find((clip) => clip.id === ids[0]) || clips[0];
    const base = exportSettingsFor(first, {
      resolution: appSettings?.video.resolution || "1080p",
      fps: appSettings?.video.fps || 30,
      quality: appSettings?.video.quality || "high",
      subtitle_settings: appSettings?.subtitles || exportSettingsFor(first).subtitle_settings,
    });
    setSettings(base);
  }, [open, clips, initialSelection, appSettings]);

  const selectedClips = useMemo(
    () => clips.filter((clip) => selected.includes(clip.id)),
    [clips, selected],
  );
  const totalDuration = selectedClips.reduce((sum, clip) => sum + clip.duration, 0);
  const aspectConflict = new Set(selectedClips.map((clip) => clip.aspect_ratio)).size > 1;

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const update = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const start = async () => {
    if (!selected.length) {
      toast.warning("Choose at least one clip", "Select the clips you want to export.");
      return;
    }
    setBusy(true);
    try {
      const job = await api.exportProject(projectId, selected, settings, true);
      toast.success("Export queued", `${plural(selected.length, "clip")} will render in the background.`);
      onStarted?.(job);
      onClose();
    } catch (error) {
      toast.error("Could not start the export", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Export clips"
      description={`Package moments from “${projectName}” as finished videos.`}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={start} disabled={busy || !selected.length}>
            <Download size={15} />
            {busy ? "Starting…" : `Export ${plural(selected.length, "clip")}`}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <section>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-white">Clips to export</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {selected.length} selected · {formatDuration(totalDuration)} of video
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() =>
                setSelected(selected.length === clips.length ? [] : clips.map((clip) => clip.id))
              }
            >
              {selected.length === clips.length ? "Clear all" : "Select all"}
            </button>
          </div>

          <div className="mt-2.5 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-base-925/40 p-1.5">
            {clips.map((clip) => {
              const checked = selected.includes(clip.id);
              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => toggle(clip.id)}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition",
                    checked
                      ? "border-accent-400/35 bg-accent-500/[0.1]"
                      : "border-transparent hover:bg-white/[0.03]",
                  )}
                >
                  <span
                    className={clsx("shrink-0", checked ? "text-accent-300" : "text-slate-500")}
                  >
                    {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-slate-200">
                      {clip.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {formatDuration(clip.duration)} · {clip.aspect_ratio} · score{" "}
                      {Math.round(clip.score)}
                    </span>
                  </span>
                  {clip.has_render && <span className="badge-green shrink-0">Rendered</span>}
                </button>
              );
            })}
          </div>
        </section>

        {aspectConflict && (
          <p className="flex items-start gap-2 rounded-lg border border-gold-400/20 bg-gold-400/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-gold-300">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            The selected clips use different aspect ratios. This export applies one framing to all
            of them; edit a clip to change its own framing before exporting.
          </p>
        )}

        <section className="border-t border-white/[0.06] pt-5">
          <h3 className="text-[14px] font-semibold text-white">Output settings</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <span className="label">Aspect ratio</span>
              <select
                className="select"
                value={settings.aspect_ratio}
                onChange={(event) => update("aspect_ratio", event.target.value)}
              >
                {ASPECT_RATIOS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} · {option.value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Resolution</span>
              <select
                className="select"
                value={settings.resolution}
                onChange={(event) => update("resolution", event.target.value)}
              >
                {RESOLUTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Frame rate</span>
              <select
                className="select"
                value={settings.fps}
                onChange={(event) => update("fps", Number(event.target.value))}
              >
                {FPS_OPTIONS.map((fps) => (
                  <option key={fps} value={fps}>
                    {fps} fps
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Quality</span>
              <select
                className="select"
                value={settings.quality}
                onChange={(event) => update("quality", event.target.value)}
              >
                {QUALITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <span className="label">Filename pattern</span>
              <input
                className="input"
                value={settings.filename_pattern}
                onChange={(event) => update("filename_pattern", event.target.value)}
                placeholder="{project}_Clip_{index:02d}"
              />
              <p className="mt-1.5 text-[11px] text-slate-500">
                Tokens: {"{project}"}, {"{clip}"}, {"{index}"}, {"{date}"}, {"{score}"}.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-white/[0.06] pt-5">
          <h3 className="text-[14px] font-semibold text-white">Finishing</h3>
          <div className="panel-soft mt-3 space-y-3.5 p-4">
            <Toggle
              checked={settings.subtitles}
              onChange={(next) => update("subtitles", next)}
              label="Burn in captions"
              description="Each clip uses its own saved caption style when available."
            />
            <Toggle
              checked={settings.create_zip}
              onChange={(next) => update("create_zip", next)}
              label="Create a ZIP archive"
              description="Bundle every finished file into one download."
            />
            <Toggle
              checked={settings.audio_normalize}
              onChange={(next) => update("audio_normalize", next)}
              label="Normalize audio loudness"
              description="Two-pass EBU R128 loudness levelling while rendering."
            />
            <Toggle
              checked={settings.fade}
              onChange={(next) => update("fade", next)}
              label="Audio fade in / out"
              description="Short fades at the start and end of every clip."
            />
          </div>
        </section>

        <div className="flex items-start gap-2 rounded-lg border border-accent-400/15 bg-accent-500/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-accent-200/90">
          <Package size={14} className="mt-0.5 shrink-0" />
          Rendering runs locally in the background. You can keep editing while it works; the files
          appear under Exports when finished.
        </div>
      </div>
    </Modal>
  );
}
