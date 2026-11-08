import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import {
  ArrowLeft,
  Captions,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Film,
  Image,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Save,
  ScanFace,
  Scissors,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
  XCircle,
} from "lucide-react";
import { api, triggerDownload } from "../api/client";
import type {
  Clip,
  Job,
  ProjectDetail,
  RenderSettings,
  SettingsResponse,
  SubtitlePreview,
  SubtitleSettings,
} from "../api/types";
import { ConfirmDialog } from "../components/Modal";
import { CropFramePreview } from "../components/CropFramePreview";
import { ExportDialog } from "../components/ExportDialog";
import { JobMonitor } from "../components/JobMonitor";
import { PageHeader } from "../components/PageHeader";
import { ScoreRing } from "../components/ScoreRing";
import { StatusBadge } from "../components/StatusBadge";
import { SubtitleOverlay } from "../components/SubtitleOverlay";
import { SubtitleStyleEditor } from "../components/SubtitleStyleEditor";
import { Toggle } from "../components/Toggle";
import { isTerminal, useDocumentTitle, useJob } from "../hooks/useJob";
import {
  ASPECT_RATIOS,
  CROP_MODES,
  FPS_OPTIONS,
  QUALITIES,
  RESOLUTIONS,
} from "../lib/constants";
import {
  DEFAULT_RENDER,
  DEFAULT_SUBTITLE,
  renderSettingsForClip,
} from "../lib/defaults";
import {
  clamp,
  formatDuration,
  formatTimecode,
  parseTimecode,
  plural,
  titleCase,
} from "../lib/format";
import { toast } from "../store/ui";

interface Draft {
  title: string;
  description: string;
  category: string;
  status: string;
  start: number;
  end: number;
  aspect_ratio: string;
  crop_mode: string;
  crop_offset: number;
  subtitle_enabled: boolean;
}

function draftFromClip(clip: Clip): Draft {
  return {
    title: clip.title,
    description: clip.description,
    category: clip.category,
    status: clip.status,
    start: clip.start,
    end: clip.end,
    aspect_ratio: clip.aspect_ratio,
    crop_mode: clip.crop_mode,
    crop_offset: clip.crop_offset,
    subtitle_enabled: clip.subtitle_enabled,
  };
}

function TimeInput({
  label,
  value,
  max,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  max: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => formatTimecode(value));
  useEffect(() => setText(formatTimecode(value)), [value]);
  const commit = () => {
    const parsed = parseTimecode(text);
    if (parsed === null) {
      setText(formatTimecode(value));
      return;
    }
    onCommit(clamp(parsed, 0, max));
  };
  return (
    <div>
      <span className="label">{label}</span>
      <input
        className="input font-mono text-xs"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        placeholder="mm:ss.t"
      />
      <p className="mt-1 text-xs text-slate-400">mm:ss.t or seconds · max {formatTimecode(max)}</p>
    </div>
  );
}

export function ClipEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [clip, setClip] = useState<Clip | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [settingsResponse, setSettingsResponse] = useState<SettingsResponse | null>(null);
  const [preview, setPreview] = useState<SubtitlePreview | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subtitleSettings, setSubtitleSettings] =
    useState<SubtitleSettings>(DEFAULT_SUBTITLE);
  const [renderSettings, setRenderSettings] = useState<RenderSettings>(DEFAULT_RENDER);
  const [tab, setTab] = useState<"edit" | "captions" | "render">("edit");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monitorJobId, setMonitorJobId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [faceBusy, setFaceBusy] = useState(false);
  const [reframeBusy, setReframeBusy] = useState(false);
  const [reframePlan, setReframePlan] = useState<Record<string, unknown> | null>(null);
  const [renderBusy, setRenderBusy] = useState(false);
  const [thumbVersion, setThumbVersion] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const clipData = await api.getClip(id);
      setClip(clipData);
      setDraft(draftFromClip(clipData));
      const [projectResult, settingsResult, previewResult] = await Promise.allSettled([
        api.getProject(clipData.project_id),
        api.getSettings(),
        api.subtitlePreview(id),
      ]);
      if (projectResult.status === "fulfilled") {
        setProject(projectResult.value);
        const active = projectResult.value.jobs.find(
          (job) =>
            (job.status === "running" || job.status === "queued") &&
            job.kind === "render_clip" &&
            (job.params as { clip_id?: string } | null)?.clip_id === id,
        );
        if (active) setMonitorJobId(active.id);
      }
      if (settingsResult.status === "fulfilled") setSettingsResponse(settingsResult.value);
      if (previewResult.status === "fulfilled") setPreview(previewResult.value);
      setError(null);

      const app = settingsResult.status === "fulfilled" ? settingsResult.value.settings : null;
      setSubtitleSettings(
        clipData.subtitle_settings || app?.subtitles || DEFAULT_SUBTITLE,
      );
      setRenderSettings(
        renderSettingsForClip(clipData, {
          resolution: app?.video.resolution || DEFAULT_RENDER.resolution,
          fps: app?.video.fps || DEFAULT_RENDER.fps,
          quality: app?.video.quality || DEFAULT_RENDER.quality,
          aspect_ratio: clipData.aspect_ratio,
          crop_mode: clipData.crop_mode,
          crop_offset: clipData.crop_offset,
          subtitles: clipData.subtitle_enabled,
          subtitle_settings: clipData.subtitle_settings || app?.subtitles || DEFAULT_SUBTITLE,
        }),
      );
      setDirty(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This clip could not load.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useDocumentTitle(clip?.title || "Clip editor");

  const liveJob = useJob(monitorJobId, (job) => {
    if (job.status === "completed") {
      toast.success(
        job.kind === "render_clip" ? "Clip rendered" : "Job finished",
        job.message || undefined,
      );
      load(true);
      setRenderBusy(false);
    } else if (job.status === "failed") {
      toast.error("Render failed", job.error || job.message || undefined);
      load(true);
      setRenderBusy(false);
    } else if (job.status === "cancelled") {
      toast.info("Render cancelled");
      load(true);
      setRenderBusy(false);
    }
  });

  const sourceUrl = project ? `/api/media/projects/${project.id}/source` : null;
  const renderedUrl = clip?.has_render ? clip.render_url : null;
  const previewRendered = Boolean(renderedUrl);
  const videoSrc = renderedUrl || sourceUrl;
  const maxDuration = project?.duration || 0;

  const previewTime = useMemo(() => {
    if (!clip) return 0;
    return previewRendered ? currentTime : currentTime - (draft?.start ?? 0);
  }, [clip, previewRendered, currentTime, draft?.start]);

  const sourceTime = previewRendered ? (draft?.start ?? clip?.start ?? 0) + currentTime : currentTime;

  const activeJob = liveJob && !isTerminal(liveJob.status) ? liveJob : null;
  const compactPreview = tab !== "edit";

  const seekToClipStart = () => {
    const video = videoRef.current;
    if (!video || !draft) return;
    if (!previewRendered) video.currentTime = draft.start + 0.02;
    else video.currentTime = 0;
    video.play().catch(() => undefined);
  };

  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    if (key === "aspect_ratio" || key === "crop_mode" || key === "crop_offset") {
      setRenderSettings((current) => ({ ...current, [key]: value }));
    }
    if (key === "subtitle_enabled") {
      setRenderSettings((current) => ({ ...current, subtitles: Boolean(value) }));
    }
  };

  const persistDraft = async (): Promise<Clip | null> => {
    if (!clip || !draft) return null;
    if (!draft.title.trim()) {
      toast.warning("The clip needs a title");
      return null;
    }
    if (draft.end <= draft.start) {
      toast.warning("The end must be after the start");
      return null;
    }
    if (draft.end - draft.start < 1) {
      toast.warning("Clips must be at least 1 second long");
      return null;
    }
    if (maxDuration && draft.end > maxDuration + 0.25) {
      toast.warning("The clip end is past the end of the source video");
      return null;
    }
    setSaving(true);
    try {
      const updated = await api.updateClip(clip.id, {
        title: draft.title.trim(),
        description: draft.description,
        category: draft.category,
        status: draft.status,
        start: draft.start,
        end: draft.end,
        aspect_ratio: draft.aspect_ratio,
        crop_mode: draft.crop_mode,
        crop_offset: draft.crop_offset,
        subtitle_enabled: draft.subtitle_enabled,
        subtitle_settings: subtitleSettings,
      });
      setClip(updated);
      setDraft(draftFromClip(updated));
      setDirty(false);
      const refreshed = await api.subtitlePreview(updated.id).catch(() => null);
      if (refreshed) setPreview(refreshed);
      return updated;
    } catch (caught) {
      toast.error("Could not save the clip", caught instanceof Error ? caught.message : undefined);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const updated = await persistDraft();
    if (updated) toast.success("Clip saved");
  };

  const detectFaces = async () => {
    if (!clip) return;
    setFaceBusy(true);
    try {
      const result = await api.detectFaces(clip.id);
      setClip(result.clip);
      setDraft((current) =>
        current
          ? {
              ...current,
              crop_mode: result.clip.crop_mode,
              crop_offset: result.clip.crop_offset,
            }
          : current,
      );
      setRenderSettings((current) => ({
        ...current,
        crop_mode: result.clip.crop_mode,
        crop_offset: result.clip.crop_offset,
      }));
      setDirty(false);
      setThumbVersion((value) => value + 1);
      if (result.analysis.detected) {
        toast.success(
          "Face detected",
          `Subject placed at ${Math.round(result.analysis.offset_x * 100)}% across the frame · ${Math.round(result.analysis.confidence * 100)}% confidence.`,
        );
      } else {
        toast.info(
          "No face found",
          `Checked ${result.analysis.frames_checked} frames. The crop was centred.`,
        );
      }
    } catch (caught) {
      toast.error("Face detection failed", caught instanceof Error ? caught.message : undefined);
    } finally {
      setFaceBusy(false);
    }
  };

  const analyzeReframe = async () => {
    if (!clip) return;
    setReframeBusy(true);
    try {
      const result = await api.analyzeReframe(clip.id, {
        mode: renderSettings.crop_mode,
        target_aspect: draft?.aspect_ratio || clip.aspect_ratio,
      });
      const plan = result.plan as Record<string, unknown>;
      const keyframes = (plan.keyframes as Array<{ x?: number; y?: number }> | undefined) || [];
      const centerX =
        keyframes.length > 0
          ? keyframes.reduce((sum, item) => sum + Number(item.x ?? 0.5), 0) / keyframes.length
          : 0.5;
      const centerY =
        keyframes.length > 0
          ? keyframes.reduce((sum, item) => sum + Number(item.y ?? 0.5), 0) / keyframes.length
          : 0.5;
      const nextMode = String(plan.crop_mode || renderSettings.crop_mode);
      setReframePlan(plan);
      setRenderSettings((current) => ({
        ...current,
        crop_mode: nextMode,
        crop_offset: centerX,
        reframe_plan: plan,
      }));
      setDraft((current) =>
        current ? { ...current, crop_mode: nextMode, crop_offset: centerX } : current,
      );
      setDirty(true);
      const quality = (plan.quality as Record<string, unknown> | undefined) || {};
      const score = quality.score;
      toast.success(
        "Reframe analyzed",
        `${String(plan.content_type || "general")} · ${score ?? "n/a"}/100 · ${String(
          quality.recommendation || "Review the preview before rendering.",
        )}`,
      );
    } catch (caught) {
      toast.error("Reframe analysis failed", caught instanceof Error ? caught.message : undefined);
    } finally {
      setReframeBusy(false);
    }
  };

  const startRender = async () => {
    if (!clip) return;
    const saved = dirty ? await persistDraft() : clip;
    if (!saved) return;
    setRenderBusy(true);
    try {
      const job = await api.renderClip(saved.id, renderSettings);
      setMonitorJobId(job.id);
      setTab("render");
      toast.info("Render queued", "FFmpeg runs locally; progress is real and cancellable.");
    } catch (caught) {
      toast.error("Could not start the render", caught instanceof Error ? caught.message : undefined);
      setRenderBusy(false);
    }
  };

  const duplicate = async () => {
    if (!clip) return;
    setDialogBusy(true);
    try {
      const copy = await api.duplicateClip(clip.id);
      toast.success("Clip duplicated");
      navigate(`/clips/${copy.id}`);
    } catch (caught) {
      toast.error("Could not duplicate", caught instanceof Error ? caught.message : undefined);
      setDialogBusy(false);
    }
  };

  const deleteClip = async () => {
    if (!clip) return;
    setDialogBusy(true);
    try {
      await api.deleteClip(clip.id);
      toast.success("Clip deleted");
      navigate(`/projects/${clip.project_id}`);
    } catch (caught) {
      toast.error("Could not delete", caught instanceof Error ? caught.message : undefined);
      setDialogBusy(false);
    }
  };

  const regenerateThumbnail = async () => {
    if (!clip) return;
    try {
      const result = await api.regenerateClipThumbnail(clip.id);
      setClip(result.clip);
      setThumbVersion((value) => value + 1);
      toast.success("Thumbnail regenerated");
    } catch (caught) {
      toast.error("Could not regenerate", caught instanceof Error ? caught.message : undefined);
    }
  };

  if (loading && !clip) {
    return (
      <div>
        <PageHeader title="Loading clip…" />
        <div className="skeleton h-96" />
      </div>
    );
  }

  if (error || !clip) {
    return (
      <div>
        <PageHeader title="Clip unavailable" breadcrumbs={[{ label: "Projects", to: "/projects" }]} />
        <div className="panel flex flex-col items-center px-6 py-14 text-center">
          <TriangleAlert size={26} className="mb-3 text-rose-400" />
          <h2 className="text-base font-semibold text-white">This clip could not be opened</h2>
          <p className="mt-1.5 max-w-md text-sm text-slate-400">
            {error || "It may have been deleted."}
          </p>
          <Link to="/projects" className="btn-secondary mt-5">
            <ArrowLeft size={15} />
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const frameTime = draft ? draft.start + Math.max(0.3, (draft.end - draft.start) / 2) : clip.start;
  const frameUrl = project
    ? `/api/media/projects/${project.id}/frame?t=${Math.max(0, frameTime).toFixed(2)}&width=720&v=${thumbVersion}`
    : clip.thumbnail_url;
  const fonts = settingsResponse?.fonts;
  const presets = settingsResponse?.subtitle_presets;

  return (
    <div>
      <PageHeader
        title={clip.title}
        eyebrow="Clip editor"
        breadcrumbs={[
          { label: "Projects", to: "/projects" },
          { label: project?.name || "Project", to: `/projects/${clip.project_id}` },
          { label: "Clip" },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={clip.status} />
            <StatusBadge status={clip.render_status} />
            <span className="text-xs text-slate-400">
              {formatDuration(clip.duration)} · {clip.aspect_ratio} · score {Math.round(clip.score)}
            </span>
            {dirty && <span className="badge-amber">Unsaved changes</span>}
          </span>
        }
        actions={
          <>
            <button className="btn-ghost btn-xs text-slate-400" onClick={duplicate} disabled={dialogBusy}>
              <Copy size={14} />
              <span className="hidden sm:inline">Duplicate</span>
            </button>
            <button
              className="btn-ghost btn-xs text-slate-400 hover:text-rose-300"
              onClick={() => setDeleteOpen(true)}
              aria-label="Delete clip"
              title="Delete clip"
            >
              <Trash2 size={14} />
            </button>
            <button className="btn-secondary" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>
            <button
              className="btn-secondary"
              onClick={() => setExportOpen(true)}
              disabled={Boolean(activeJob)}
            >
              <Download size={14} />
              Export
            </button>
            <button
              className="btn-primary"
              onClick={startRender}
              disabled={Boolean(activeJob) || renderBusy || !project?.source_exists}
            >
              {renderBusy || activeJob ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Scissors size={14} />
              )}
              {activeJob ? "Rendering…" : "Render clip"}
            </button>
          </>
        }
      />

      {liveJob && <JobMonitor job={liveJob} className="mb-4" />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="panel overflow-hidden">
            <div className="relative bg-black">
              <div
                className={clsx(
                  "relative mx-auto overflow-hidden",
                  compactPreview ? "max-h-[38vh]" : "max-h-[64vh]",
                  draft?.aspect_ratio === "9:16"
                    ? clsx("aspect-[9/16]", compactPreview ? "max-w-[214px]" : "max-w-[420px]")
                    : draft?.aspect_ratio === "4:5"
                      ? clsx("aspect-[4/5]", compactPreview ? "max-w-[304px]" : "max-w-[500px]")
                      : draft?.aspect_ratio === "1:1"
                        ? clsx("aspect-square", compactPreview ? "max-w-[380px]" : "max-w-[560px]")
                        : clsx("aspect-video", compactPreview && "max-w-[676px]"),
                )}
              >
                {videoSrc && project?.source_exists ? (
                  <>
                    <video
                      ref={videoRef}
                      key={videoSrc}
                      src={videoSrc}
                      poster={clip.thumbnail_url || undefined}
                      controls
                      preload="metadata"
                      className={clsx(
                        "h-full w-full bg-black",
                        previewRendered ||
                          !draft ||
                          draft.aspect_ratio === "original" ||
                          draft.crop_mode === "blurred_pad"
                          ? "object-contain"
                          : "object-cover",
                      )}
                      style={{
                        objectPosition: `${Math.round((draft?.crop_offset ?? 0.5) * 100)}% 50%`,
                      }}
                      onLoadedMetadata={() => {
                        const video = videoRef.current;
                        if (!video || !draft) return;
                        video.currentTime = previewRendered ? 0 : draft.start + 0.02;
                        setCurrentTime(video.currentTime);
                      }}
                      onTimeUpdate={() => {
                        const video = videoRef.current;
                        if (!video) return;
                        setCurrentTime(video.currentTime);
                        if (!previewRendered && draft && video.currentTime >= draft.end) {
                          video.pause();
                        }
                      }}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onEnded={() => setPlaying(false)}
                    />
                    {!compactPreview && !previewRendered && draft?.subtitle_enabled && preview && (
                      <SubtitleOverlay
                        settings={subtitleSettings}
                        cues={preview.cues}
                        time={previewTime}
                        targetWidth={preview.target_width}
                        targetHeight={preview.target_height}
                      />
                    )}
                    {!playing && (
                      <button
                        type="button"
                        onClick={seekToClipStart}
                        className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-accent-500/80"
                        aria-label="Play the clip"
                      >
                        <Play size={22} fill="currentColor" className="ml-0.5" />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-slate-400">
                    <TriangleAlert size={24} className="text-gold-400" />
                    <p className="text-xs">The source video is not available.</p>
                  </div>
                )}
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5">
                  <span className="rounded-md bg-black/60 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                    {previewRendered ? "Rendered preview" : "Source preview"}
                  </span>
                  {previewRendered && (
                    <span className="rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 backdrop-blur">
                      captions are burned in
                    </span>
                  )}
                </div>
                <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-1 font-mono text-xs tabular-nums text-white/85 backdrop-blur">
                  {formatTimecode(Math.max(0, previewRendered ? currentTime : previewTime))} /{" "}
                  {formatTimecode(clip.duration)}
                </div>
              </div>
            </div>

            <div className={clsx("border-t border-white/[0.06] px-4", compactPreview ? "py-2" : "py-3")}>
              {!compactPreview && (
                <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-500">
                  <span>{formatTimecode(0)}</span>
                  <span>{previewRendered ? "Rendered preview" : "Source timeline"}</span>
                  <span>{formatTimecode(maxDuration || clip.duration)}</span>
                </div>
              )}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Seek through the source video"
                aria-valuemin={0}
                aria-valuemax={Math.round(maxDuration || clip.duration)}
                aria-valuenow={Math.round(sourceTime)}
                className={clsx(
                  "relative h-7 cursor-pointer overflow-hidden rounded-md border border-white/[0.06] bg-base-925",
                  !compactPreview && "mt-1.5",
                )}
                onClick={(event) => {
                  const video = videoRef.current;
                  if (!video || !project) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                  video.currentTime = previewRendered
                    ? ratio * clip.duration
                    : ratio * (maxDuration || project.duration);
                }}
                onKeyDown={(event) => {
                  const video = videoRef.current;
                  if (!video || !project) return;
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const step = event.key === "ArrowRight" ? 1 : -1;
                  video.currentTime = clamp(
                    video.currentTime + step,
                    0,
                    previewRendered ? clip.duration : maxDuration || project.duration,
                  );
                }}
              >
                <div
                  className="absolute inset-y-1 rounded-sm border border-accent-300/50 bg-accent-500/45"
                  style={{
                    left: `${Math.min(99.5, ((draft?.start ?? clip.start) / Math.max(maxDuration || clip.duration, 1)) * 100)}%`,
                    width: `${Math.max(
                      0.6,
                      (((draft?.end ?? clip.end) - (draft?.start ?? clip.start)) /
                        Math.max(maxDuration || clip.duration, 1)) *
                        100,
                    )}%`,
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/90"
                  style={{
                    left: `${Math.min(
                      100,
                      (sourceTime / Math.max(maxDuration || clip.duration, 1)) * 100,
                    )}%`,
                  }}
                />
              </div>
              {!compactPreview && (
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>
                    Selected range {formatTimecode(draft?.start ?? clip.start)} –{" "}
                    {formatTimecode(draft?.end ?? clip.end)}
                  </span>
                  <span className="tabular-nums">
                    Playhead {formatTimecode(Math.max(0, sourceTime))}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip">
                  <Clock3 size={11} />
                  {formatTimecode(clip.start)} → {formatTimecode(clip.end)}
                </span>
                <span className="chip">
                  <Sparkles size={11} />
                  {titleCase(clip.category)}
                </span>
                {clip.crop_confidence !== null && (
                  <span className="chip">
                    <ScanFace size={11} />
                    face {Math.round(clip.crop_confidence * 100)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {clip.has_render && (
                  <button
                    className="btn-secondary btn-xs"
                    onClick={() => triggerDownload(clip.render_url || "")}
                  >
                    <Download size={12} />
                    Download MP4
                  </button>
                )}
                <button className="btn-ghost btn-xs" onClick={regenerateThumbnail}>
                  <Image size={12} />
                  Thumbnail
                </button>
              </div>
            </div>
          </section>

          <div className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.06] no-scrollbar">
            {[
              { id: "edit" as const, label: "Edit", icon: Scissors },
              { id: "captions" as const, label: "Captions", icon: Captions },
              { id: "render" as const, label: "Render & export", icon: Settings2 },
            ].map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  className={clsx(
                    "relative flex shrink-0 items-center gap-2 px-3.5 pb-3 pt-1 text-[13px] font-medium transition",
                    active ? "text-white" : "text-slate-400 hover:text-slate-200",
                  )}
                  onClick={() => setTab(item.id)}
                >
                  <item.icon size={14} className={active ? "text-accent-300" : "text-slate-500"} />
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-500" />
                  )}
                </button>
              );
            })}
          </div>

          {tab === "edit" && draft && (
            <div className="space-y-4">
              <section className="panel space-y-4 p-5">
                <div>
                  <label className="label">Title</label>
                  <input
                    className="input"
                    value={draft.title}
                    maxLength={300}
                    onChange={(event) => updateDraft("title", event.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Description / caption for the editor</label>
                  <textarea
                    className="input min-h-[80px] resize-y"
                    value={draft.description}
                    maxLength={4000}
                    onChange={(event) => updateDraft("description", event.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="label">Category</label>
                    <input
                      className="input"
                      value={draft.category}
                      maxLength={60}
                      onChange={(event) => updateDraft("category", event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select
                      className="select"
                      value={draft.status}
                      onChange={(event) => updateDraft("status", event.target.value)}
                    >
                      <option value="suggested">Suggested</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      className="btn-secondary btn-xs flex-1 text-mint-300"
                      onClick={() => updateDraft("status", "approved")}
                    >
                      <CheckCircle2 size={12} />
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-xs flex-1 text-rose-300"
                      onClick={() => updateDraft("status", "rejected")}
                    >
                      <XCircle size={12} />
                      Reject
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <TimeInput
                    label="Clip start"
                    value={draft.start}
                    max={maxDuration || draft.end}
                    onCommit={(value) => updateDraft("start", value)}
                  />
                  <TimeInput
                    label="Clip end"
                    value={draft.end}
                    max={maxDuration || draft.end}
                    onCommit={(value) => updateDraft("end", value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      const value = clamp(
                        previewRendered ? 0 : video.currentTime,
                        0,
                        Math.max(0, draft.end - 1),
                      );
                      updateDraft("start", value);
                    }}
                    disabled={previewRendered}
                  >
                    Set start to playhead
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      const value = clamp(
                        previewRendered ? clip.duration : video.currentTime,
                        draft.start + 1,
                        maxDuration || video.duration || draft.end,
                      );
                      updateDraft("end", value);
                    }}
                    disabled={previewRendered}
                  >
                    Set end to playhead
                  </button>
                  <span className="text-xs text-slate-400">
                    Current clip length {formatDuration(Math.max(0, draft.end - draft.start))}
                  </span>
                </div>
              </section>

              <section className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Framing</h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Crop the source to the target aspect. Face detection positions the subject
                      instead of the frame centre.
                    </p>
                  </div>
                  <button
                    className="btn-secondary btn-xs"
                    onClick={detectFaces}
                    disabled={faceBusy || !project?.source_exists}
                  >
                    {faceBusy ? <Loader2 size={12} className="animate-spin" /> : <ScanFace size={12} />}
                    Detect face
                  </button>
                  <button
                    className="btn-secondary btn-xs"
                    onClick={analyzeReframe}
                    disabled={reframeBusy || !project?.source_exists}
                  >
                    {reframeBusy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                    Analyze reframe
                  </button>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <CropFramePreview
                    imageUrl={frameUrl}
                    sourceWidth={project?.width || null}
                    sourceHeight={project?.height || null}
                    aspectRatio={draft.aspect_ratio}
                    cropMode={draft.crop_mode}
                    cropOffset={draft.crop_offset}
                    onOffsetChange={(value) => {
                      updateDraft("crop_offset", value);
                      if (draft.crop_mode === "center") updateDraft("crop_mode", "manual");
                    }}
                  />
                  <div className="space-y-3">
                    <div>
                      <label className="label">Aspect ratio</label>
                      <select
                        className="select"
                        value={draft.aspect_ratio}
                        onChange={(event) => updateDraft("aspect_ratio", event.target.value)}
                      >
                        {ASPECT_RATIOS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label} · {option.value}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Crop mode</label>
                      <select
                        className="select"
                        value={draft.crop_mode}
                        onChange={(event) => updateDraft("crop_mode", event.target.value)}
                      >
                        {CROP_MODES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[12px] font-medium text-slate-300">
                          Subject position
                        </span>
                        <span className="text-xs tabular-nums text-slate-400">
                          {Math.round(draft.crop_offset * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={draft.crop_offset}
                        onChange={(event) =>
                          updateDraft("crop_offset", Number(event.target.value))
                        }
                        className="w-full"
                      />
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        0% left/top · 50% centre · 100% right/bottom. Face detection sets this
                        from real sampled frames.
                      </p>
                    </div>
                  </div>
                </div>
                {reframePlan && (
                  <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-slate-300">
                    <p className="font-semibold text-white">
                      Reframe plan: {String(reframePlan.content_type || "general")} ·{" "}
                      {String((reframePlan.quality as Record<string, unknown> | undefined)?.score ?? "n/a")}/100
                    </p>
                    <p className="mt-1">
                      {String(
                        (reframePlan.quality as Record<string, unknown> | undefined)?.recommendation ||
                          "Review the preview before rendering.",
                      )}
                    </p>
                    <p className="mt-1 text-slate-400">
                      Layout: {String(reframePlan.layout || "smart_crop")} · samples:{" "}
                      {Array.isArray(reframePlan.keyframes) ? reframePlan.keyframes.length : 0} · confidence{" "}
                      {Math.round(Number(reframePlan.confidence || 0) * 100)}%
                    </p>
                  </div>
                )}
              </section>

              <section className="panel p-5">
                <h3 className="text-sm font-semibold text-white">Transcript for this clip</h3>
                <p className="mt-1 text-xs text-slate-400">
                  What the viewer will hear inside the selected time range.
                </p>
                <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-300">
                  {clip.transcript_text || "No transcript text falls inside this clip."}
                </p>
                {clip.hook && (
                  <p className="mt-3 rounded-lg border border-accent-400/15 bg-accent-500/[0.05] px-3 py-2 text-xs leading-relaxed text-accent-200">
                    <span className="font-semibold">Hook: </span>
                    {clip.hook}
                  </p>
                )}
                {clip.reason && (
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    <span className="font-semibold text-slate-400">Why it was chosen: </span>
                    {clip.reason}
                  </p>
                )}
              </section>
            </div>
          )}

          {tab === "captions" && (
            <div className="panel p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">Caption styling</h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    The preview above is rendered from the real cue times. Burn-in uses the exact
                    same settings in FFmpeg.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn-secondary btn-xs"
                    onClick={() => triggerDownload(api.subtitleDownloadUrl(clip.id, "srt"))}
                  >
                    <Download size={12} />
                    SRT
                  </button>
                  <button
                    className="btn-secondary btn-xs"
                    onClick={() => triggerDownload(api.subtitleDownloadUrl(clip.id, "ass"))}
                  >
                    <Download size={12} />
                    ASS
                  </button>
                </div>
              </div>
              <div className="panel-soft mb-4 p-3.5">
                <Toggle
                  checked={draft?.subtitle_enabled ?? clip.subtitle_enabled}
                  onChange={(next) => updateDraft("subtitle_enabled", next)}
                  label="Burn captions into this clip"
                  description="Uses the clip transcript with word-level highlighting when enabled."
                />
              </div>
              <SubtitleStyleEditor
                value={subtitleSettings}
                onChange={(next) => {
                  setSubtitleSettings(next);
                  setRenderSettings((current) => ({ ...current, subtitle_settings: next }));
                  setDirty(true);
                }}
                presets={presets}
                fonts={fonts}
              />
              <div className="panel-soft mt-4 flex items-center justify-between gap-2 px-3.5 py-2.5">
                <p className="text-xs leading-relaxed text-slate-400">
                  Cue segmentation updates after saving. Style changes apply to the next render
                  immediately.
                </p>
                <button className="btn-secondary btn-xs shrink-0" onClick={save} disabled={!dirty || saving}>
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save style
                </button>
              </div>
            </div>
          )}

          {tab === "render" && (
            <div className="space-y-4">
              <section className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Render settings</h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Renders locally with FFmpeg. Captions, loudness and fades are applied in one
                      real pass.
                    </p>
                  </div>
                  <span className="chip">
                    <Film size={11} />
                    {renderSettings.video_codec.toUpperCase()}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="label">Aspect ratio</label>
                    <select
                      className="select"
                      value={renderSettings.aspect_ratio}
                      onChange={(event) => {
                        setRenderSettings((current) => ({ ...current, aspect_ratio: event.target.value }));
                        setDraft((current) =>
                          current ? { ...current, aspect_ratio: event.target.value } : current,
                        );
                        setDirty(true);
                      }}
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
                      value={renderSettings.resolution}
                      onChange={(event) =>
                        setRenderSettings((current) => ({ ...current, resolution: event.target.value }))
                      }
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
                      value={renderSettings.fps}
                      onChange={(event) =>
                        setRenderSettings((current) => ({ ...current, fps: Number(event.target.value) }))
                      }
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
                      value={renderSettings.quality}
                      onChange={(event) =>
                        setRenderSettings((current) => ({ ...current, quality: event.target.value }))
                      }
                    >
                      {QUALITIES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Crop mode</label>
                    <select
                      className="select"
                      value={renderSettings.crop_mode}
                      onChange={(event) => {
                        setRenderSettings((current) => ({ ...current, crop_mode: event.target.value }));
                        setDraft((current) =>
                          current ? { ...current, crop_mode: event.target.value } : current,
                        );
                        setDirty(true);
                      }}
                    >
                      {CROP_MODES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <p className="text-xs leading-relaxed text-slate-400">
                      Encoding uses H.264. GPU encoding is enabled in Settings and falls back to
                      CPU automatically if the GPU refuses the job.
                    </p>
                  </div>
                </div>

                <div className="panel-soft mt-4 space-y-3 p-3.5">
                  <Toggle
                    checked={renderSettings.subtitles}
                    onChange={(next) => {
                      setRenderSettings((current) => ({ ...current, subtitles: next }));
                      setDraft((current) =>
                        current ? { ...current, subtitle_enabled: next } : current,
                      );
                      setDirty(true);
                    }}
                    label="Burn in captions"
                    description="Uses the style configured on the Captions tab."
                  />
                  <Toggle
                    checked={renderSettings.audio_normalize}
                    onChange={(next) =>
                      setRenderSettings((current) => ({ ...current, audio_normalize: next }))
                    }
                    label="Normalize audio loudness"
                    description="EBU R128 loudness levelling to a consistent online level."
                  />
                  <Toggle
                    checked={renderSettings.fade}
                    onChange={(next) => setRenderSettings((current) => ({ ...current, fade: next }))}
                    label="Audio fade in / out"
                    description="Softens the first and last half-second."
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    className="btn-primary"
                    onClick={startRender}
                    disabled={Boolean(activeJob) || renderBusy || !project?.source_exists}
                  >
                    {renderBusy || activeJob ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Scissors size={15} />
                    )}
                    {renderBusy || activeJob ? "Rendering…" : "Render this clip"}
                  </button>
                  <button className="btn-secondary" onClick={save} disabled={!dirty || saving}>
                    <Save size={15} />
                    Save edits first
                  </button>
                  <button className="btn-secondary" onClick={() => setExportOpen(true)}>
                    <Download size={15} />
                    Export options
                  </button>
                </div>
              </section>

              <section className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">Previous render</h3>
                  <StatusBadge status={clip.render_status} />
                </div>
                {clip.has_render ? (
                  <div className="mt-3">
                    {clip.render_status === "stale" && (
                      <p className="mb-2 flex items-start gap-2 rounded-lg border border-gold-400/20 bg-gold-400/[0.06] px-3 py-2 text-xs leading-relaxed text-gold-300">
                        <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                        Settings changed after this render. Render again to update the file.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="btn-secondary btn-xs"
                        onClick={() => triggerDownload(clip.render_url || "")}
                      >
                        <Download size={12} />
                        Download MP4
                      </button>
                      <button
                        className="btn-secondary btn-xs"
                        onClick={() => {
                          const video = videoRef.current;
                          if (video) video.currentTime = 0;
                          setTab("edit");
                        }}
                      >
                        <Play size={12} />
                        Preview render
                      </button>
                      <span className="text-xs text-slate-400">
                        Rendered {formatDuration(clip.duration)} · {clip.aspect_ratio}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    No rendered file yet. Rendering creates a self-contained MP4 with the chosen
                    framing and captions.
                  </p>
                )}
              </section>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <section className="panel p-4">
            <div className="flex items-start gap-3">
              <div className="relative shrink-0">
                {clip.thumbnail_url ? (
                  <img
                    src={`${clip.thumbnail_url}${clip.thumbnail_url.includes("?") ? "&" : "?"}v=${thumbVersion}`}
                    alt=""
                    className="h-20 w-[120px] rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-[120px] items-center justify-center rounded-lg bg-base-800 text-slate-400">
                    <Film size={20} />
                  </div>
                )}
                <span className="absolute -right-2 -top-2">
                  <ScoreRing score={clip.score} size={36} stroke={3} />
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500">
                  Source moment
                </p>
                <p className="mt-1 truncate text-xs text-slate-300">
                  {formatTimecode(clip.start)} → {formatTimecode(clip.end)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {plural(Math.round(clip.duration), "second")} · {clip.aspect_ratio}
                </p>
                {clip.speaker && (
                  <p className="mt-1 truncate text-xs text-accent-300/80">{clip.speaker}</p>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn-secondary btn-xs" onClick={save} disabled={!dirty || saving}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save clip
              </button>
              <button
                className="btn-primary btn-xs"
                onClick={startRender}
                disabled={Boolean(activeJob) || renderBusy || !project?.source_exists}
              >
                <Scissors size={12} />
                Render
              </button>
              <button className="btn-secondary btn-xs" onClick={duplicate} disabled={dialogBusy}>
                <Copy size={12} />
                Duplicate
              </button>
              <button className="btn-secondary btn-xs" onClick={() => setExportOpen(true)}>
                <Download size={12} />
                Export
              </button>
            </div>

            {dirty && (
              <p className="mt-2.5 rounded-lg border border-gold-400/20 bg-gold-400/[0.06] px-2.5 py-2 text-xs leading-relaxed text-gold-300">
                You have unsaved edits. Rendering saves them automatically before encoding.
              </p>
            )}
          </section>

          <section className="panel p-4">
            <h3 className="text-sm font-semibold text-white">Caption preview</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {preview
                ? `${plural(preview.cues.length, "cue")} inside this clip · ${preview.target_width}×${preview.target_height} target`
                : "The transcript for this clip is still loading."}
            </p>
            {preview && subtitleSettings && (
              <div className="mt-3 overflow-hidden rounded-lg border border-white/[0.07] bg-black">
                <div
                  className="relative"
                  style={{ aspectRatio: `${preview.target_width} / ${preview.target_height}` }}
                >
                  {frameUrl && (
                    <img
                      src={frameUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover opacity-60"
                      style={{
                        objectPosition: `${Math.round((draft?.crop_offset ?? 0.5) * 100)}% 50%`,
                      }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
                  <SubtitleOverlay
                    settings={subtitleSettings}
                    cues={preview.cues}
                    time={
                      preview.cues.length
                        ? clamp(previewTime, 0, Math.max(0.01, clip.duration - 0.05))
                        : 0
                    }
                    targetWidth={preview.target_width}
                    targetHeight={preview.target_height}
                  />
                </div>
              </div>
            )}
            <button
              className="btn-ghost btn-xs mt-2 w-full"
              onClick={() => setTab("captions")}
            >
              <Captions size={12} />
              Edit caption style
            </button>
          </section>

          <section className="panel p-4">
            <h3 className="text-sm font-semibold text-white">Clip details</h3>
            <div className="mt-2 space-y-1.5 text-xs">
              <p className="flex justify-between gap-2">
                <span className="text-slate-400">Order</span>
                <span className="text-slate-300">#{clip.order_index + 1}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-slate-400">Score</span>
                <span className="text-slate-300">{clip.score.toFixed(1)}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-slate-400">Crop</span>
                <span className="text-slate-300">{titleCase(clip.crop_mode)}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-slate-400">Captions</span>
                <span className="text-slate-300">{clip.subtitle_enabled ? "on" : "off"}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-slate-400">Updated</span>
                <span className="text-slate-300">{formatTimecode(clip.duration)}</span>
              </p>
            </div>
            {project && (
              <Link
                to={`/projects/${project.id}`}
                className="btn-ghost btn-xs mt-2 w-full"
              >
                <ArrowLeft size={12} />
                Back to project
              </Link>
            )}
          </section>
        </aside>
      </div>

      {project && (
        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          projectId={project.id}
          projectName={project.name}
          clips={project.clips.length ? project.clips : [clip]}
          initialSelection={[clip.id]}
          appSettings={settingsResponse?.settings}
          onStarted={(job: Job) => {
            setMonitorJobId(job.id);
            toast.info("Export queued", "Track it in the project activity tab.");
          }}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this clip?"
        message="The clip record, its thumbnail and any rendered file will be removed from local storage. This cannot be undone."
        confirmLabel="Delete clip"
        danger
        busy={dialogBusy}
        onConfirm={deleteClip}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
