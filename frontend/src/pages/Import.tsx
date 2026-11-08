import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  ArrowRight,
  Captions,
  CheckCircle2,
  CloudDownload,
  Cpu,
  FileVideo,
  FolderOpen,
  Info,
  Link2,
  Loader2,
  Sparkles,
  SlidersHorizontal,
  Target,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import { api, ApiError, uploadProject } from "../api/client";
import type { AnalysisSettings, ProjectDetail, SettingsResponse } from "../api/types";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { Toggle } from "../components/Toggle";
import { useDocumentTitle } from "../hooks/useJob";
import { analysisSettingsFor } from "../lib/defaults";
import { formatBytes, formatDuration } from "../lib/format";
import { toast } from "../store/ui";

const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".ts",
  ".mts",
  ".m2ts",
  ".wmv",
  ".flv",
];

const PLATFORM_PATTERN =
  /(?:^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com|twitch\.tv|vimeo\.com|dailymotion\.com)$/i;

function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function platformError(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (PLATFORM_PATTERN.test(parsed.hostname)) {
      return "Platform pages (YouTube, TikTok, Instagram…) cannot be downloaded. This app accepts only direct video file URLs. Download the video first, then upload the file.";
    }
    return null;
  } catch {
    return "Enter a valid http:// or https:// URL.";
  }
}

function SettingsGroup({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Target;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-white/[0.06] pb-5 last:border-0 last:pb-0">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-accent-300">
          <Icon size={13} />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-white">{title}</h3>
          {description && (
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-400">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Import() {
  useDocumentTitle("Import video");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [urlCheck, setUrlCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
  const [autoDecided, setAutoDecided] = useState(false);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSettings | null>(null);
  const [subtitlePreset, setSubtitlePreset] = useState("bold_creator");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getSettings()
      .then((response) => {
        if (!active) return;
        setSettings(response);
        setAnalysis(analysisSettingsFor(null, response.settings));
        setSubtitlePreset(response.settings.subtitles.preset || "bold_creator");
        if (!autoDecided) {
          const speech = response.statuses.find(
            (status) => status.kind === "speech" && status.id === response.providers.active.speech_provider,
          );
          setAutoStart(Boolean(speech?.configured));
          setAutoDecided(true);
        }
      })
      .catch(() => {
        /* Limits fall back to sensible defaults below. */
      });
    return () => {
      active = false;
    };
  }, [autoDecided]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setFileDuration(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setFileDuration(null);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const maxUploadMb = settings?.limits.max_upload_mb ?? 4096;
  const activeSpeech = settings?.statuses.find((status) => status.kind === "speech" && status.active);
  const activeLlm = settings?.statuses.find((status) => status.kind === "llm" && status.active);
  const presetLabel =
    settings?.subtitle_presets?.[subtitlePreset]?.label || subtitlePreset.replace(/_/g, " ");

  const pickFile = (candidate: File | null) => {
    setError(null);
    if (!candidate) return;
    if (!isSupportedFile(candidate)) {
      setError(
        "That file type is not supported. Choose an MP4, MOV, MKV, WebM, AVI, M4V, MPEG, TS or WMV video.",
      );
      return;
    }
    if (candidate.size > maxUploadMb * 1024 * 1024) {
      setError(`This file is ${formatBytes(candidate.size)}. The upload limit is ${maxUploadMb} MB.`);
      return;
    }
    setFile(candidate);
    if (!name) setName(candidate.name.replace(/\.[^.]+$/, "").slice(0, 120));
  };

  const startPipeline = async (project: ProjectDetail, shouldStart: boolean) => {
    if (!shouldStart) return;
    try {
      const chosen = analysis ?? analysisSettingsFor(project, settings?.settings);
      // Apply the chosen subtitle style as the studio default so new clips inherit it.
      if (settings?.subtitle_presets?.[subtitlePreset]) {
        const presetValues = settings.subtitle_presets[subtitlePreset];
        await api
          .patchSettings({
            subtitles: { ...settings.settings.subtitles, ...presetValues, preset: subtitlePreset },
          })
          .catch(() => undefined);
      }
      await api.processProject(project.id, chosen, true, false);
      toast.info(
        "Pipeline started",
        "Transcription and clip analysis run in the background. You can watch progress on the project page.",
      );
    } catch (caught) {
      toast.warning(
        "Imported, but processing did not start",
        caught instanceof Error ? caught.message : undefined,
      );
    }
  };

  const submitFile = async () => {
    if (!file) {
      setError("Choose a video file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const project = await uploadProject(file, name, (percent) =>
        setProgress(Math.min(100, percent)),
      );
      await startPipeline(project, autoStart);
      navigate(`/projects/${project.id}`);
    } catch (caught) {
      const message =
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : "The upload failed.";
      setError(message);
      setBusy(false);
      setProgress(0);
    }
  };

  const submitUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste a direct video URL first.");
      return;
    }
    const platform = platformError(trimmed);
    if (platform) {
      setError(platform);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await api.importUrl(trimmed, name || undefined);
      await startPipeline(project, autoStart);
      navigate(`/projects/${project.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The URL could not be imported.");
      setBusy(false);
    }
  };

  const checkUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlCheck({ ok: false, message: "Paste a URL first." });
      return;
    }
    const platform = platformError(trimmed);
    if (platform) {
      setUrlCheck({ ok: false, message: platform });
      return;
    }
    setUrlCheck({
      ok: true,
      message: "This looks like a valid direct file URL. The server will verify it during import.",
    });
  };

  const disabled = busy || (tab === "file" ? !file : !url.trim());

  return (
    <div>
      <PageHeader
        title="Import a video"
        description="Bring in a podcast, interview, stream or tutorial. Audio is extracted locally; only audio goes to a cloud speech provider, never the full video."
      />

      <div className="grid gap-5">
        <div className="space-y-5">
          <div className="panel overflow-hidden">
            <div className="flex border-b border-white/[0.06]">
              {[
                { id: "file" as const, label: "Upload a file", icon: FolderOpen },
                { id: "url" as const, label: "Direct video URL", icon: Link2 },
              ].map((entry) => (
                <button
                  key={entry.id}
                  className={clsx(
                    "flex flex-1 items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium transition",
                    tab === entry.id
                      ? "border-b-2 border-accent-500 text-white"
                      : "text-slate-400 hover:bg-white/[0.025] hover:text-slate-200",
                  )}
                  onClick={() => {
                    setTab(entry.id);
                    setError(null);
                  }}
                >
                  <entry.icon size={15} />
                  {entry.label}
                </button>
              ))}
            </div>

            <div className="p-5">
              {tab === "file" ? (
                <>
                  <div
                    className={clsx(
                      "relative rounded-xl border border-dashed transition",
                      dragging
                        ? "border-accent-400/70 bg-accent-500/[0.07]"
                        : file
                          ? "border-white/[0.09] bg-white/[0.018]"
                          : "border-white/[0.12] bg-white/[0.012] hover:border-white/[0.2]",
                    )}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragging(false);
                      pickFile(event.dataTransfer.files?.[0] || null);
                    }}
                  >
                    {file ? (
                      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                        <div className="relative w-full shrink-0 overflow-hidden rounded-lg border border-white/[0.07] bg-black sm:w-[220px]">
                          {previewUrl ? (
                            <video
                              src={`${previewUrl}#t=0.1`}
                              muted
                              playsInline
                              preload="metadata"
                              className="aspect-video w-full object-cover"
                              onLoadedMetadata={(event) => {
                                const next = event.currentTarget.duration;
                                if (Number.isFinite(next)) setFileDuration(next);
                              }}
                            />
                          ) : (
                            <div className="flex aspect-video items-center justify-center text-slate-600">
                              <FileVideo size={28} />
                            </div>
                          )}
                          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                            {fileDuration ? formatDuration(fileDuration) : "Video"}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-white" title={file.name}>
                            {file.name}
                          </p>
                          <p className="mt-1 text-[12px] text-slate-400">
                            {formatBytes(file.size)}
                            {fileDuration ? ` · ${formatDuration(fileDuration)}` : ""} · ready to
                            upload
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => inputRef.current?.click()}
                              disabled={busy}
                            >
                              <FolderOpen size={13} />
                              Change file
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={() => {
                                setFile(null);
                                setError(null);
                              }}
                              disabled={busy}
                            >
                              <X size={13} />
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-10 text-center">
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-accent-300">
                          <UploadCloud size={23} />
                        </div>
                        <p className="text-[15px] font-semibold text-white">
                          Drag your video here, or choose a file
                        </p>
                        <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-slate-400">
                          MP4, MOV, MKV, WebM, AVI, M4V, MPEG, TS or WMV. Up to {maxUploadMb} MB.
                          The file must contain a video stream.
                        </p>
                        <button
                          type="button"
                          className="btn-primary mt-5"
                          onClick={() => inputRef.current?.click()}
                        >
                          <FolderOpen size={15} />
                          Browse files
                        </button>
                      </div>
                    )}
                    <input
                      ref={inputRef}
                      type="file"
                      accept={VIDEO_EXTENSIONS.join(",")}
                      className="hidden"
                      onChange={(event) => pickFile(event.target.files?.[0] || null)}
                    />
                  </div>

                  {busy && (
                    <div className="mt-4 rounded-lg border border-accent-500/25 bg-accent-500/[0.06] p-3.5">
                      <div className="mb-2 flex items-center justify-between text-[12px]">
                        <span className="flex items-center gap-2 text-accent-200">
                          <Loader2 size={14} className="animate-spin" />
                          {progress >= 100
                            ? "Upload complete — probing the video…"
                            : "Uploading to local storage…"}
                        </span>
                        <span className="tabular-nums text-accent-200">{Math.round(progress)}%</span>
                      </div>
                      <ProgressBar value={progress} />
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                        The upload is written to your local storage folder. Nothing is sent to a
                        third party during this step.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="min-h-[260px]">
                  <label className="label">Direct video file URL</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <Link2
                        size={15}
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
                      />
                      <input
                        className="input pl-10"
                        placeholder="https://example.com/episode.mp4"
                        value={url}
                        onChange={(event) => {
                          setUrl(event.target.value);
                          setUrlCheck(null);
                        }}
                        disabled={busy}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      onClick={checkUrl}
                      disabled={busy || !url.trim()}
                    >
                      Check link
                    </button>
                  </div>
                  {urlCheck && (
                    <p
                      className={clsx(
                        "mt-2 flex items-start gap-1.5 rounded-md border px-2.5 py-2 text-[12px] leading-relaxed",
                        urlCheck.ok
                          ? "border-mint-400/20 bg-mint-500/[0.06] text-mint-300"
                          : "border-rose-500/25 bg-rose-500/[0.06] text-rose-300",
                      )}
                    >
                      {urlCheck.ok ? (
                        <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                      ) : (
                        <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                      )}
                      {urlCheck.message}
                    </p>
                  )}
                  <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
                    The link must point straight at a video file. Web pages and platform links such
                    as YouTube, TikTok or Instagram are refused — this app does not include a
                    platform downloader.
                  </p>
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-gold-400/20 bg-gold-400/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-gold-300">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    For platform videos, use the platform’s own download option (where allowed),
                    then import the downloaded file. Respect creators’ rights.
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-[12px] text-slate-400">
                    <CloudDownload size={14} />
                    Downloads are saved locally and probed with FFprobe.
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3.5 py-3 text-[12px] leading-relaxed text-rose-300">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="text-[16px] font-semibold text-white">Project details</h2>
                <p className="mt-1 text-[12px] text-slate-400">
                  Name this project and decide how the studio prepares it.
                </p>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="label">Project name (optional)</label>
                <input
                  className="input"
                  placeholder={
                    tab === "file" && file
                      ? file.name.replace(/\.[^.]+$/, "")
                      : "My podcast episode"
                  }
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                  disabled={busy}
                />
              </div>

              <div className="rounded-lg border border-white/[0.055] bg-white/[0.018] p-3.5">
                <Toggle
                  checked={autoStart}
                  onChange={setAutoStart}
                  disabled={busy}
                  label="Start transcribing and analyzing immediately"
                  description={
                    activeSpeech
                      ? `Uses ${activeSpeech.name}${activeLlm ? ` and ${activeLlm.name}` : ""}. You can change this later.`
                      : "Uses your configured speech and analysis providers."
                  }
                />
                {activeSpeech && !activeSpeech.configured && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-gold-300">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                    {activeSpeech.name} is not configured yet. Add a key in Settings or choose Local
                    Whisper. Until then, the video will be imported without processing.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-white/[0.055] bg-white/[0.018] p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-slate-200">
                      <SlidersHorizontal size={14} className="text-accent-300" />
                      Analysis &amp; captions
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="chip">
                        {analysis ? `${analysis.clip_count} clips` : "Default clip count"}
                      </span>
                      {analysis && (
                        <span className="chip">
                          {formatDuration(analysis.min_duration)}–
                          {formatDuration(analysis.max_duration)}
                        </span>
                      )}
                      <span className="chip capitalize">
                        {analysis?.discovery_mode.replace(/_/g, " ") || "Best moments"}
                      </span>
                      <span className="chip">{presetLabel}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-sm shrink-0"
                    onClick={() => setShowAdvanced(true)}
                    disabled={busy}
                  >
                    <Sparkles size={13} />
                    Customize
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-base-850 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-slate-300">
                {tab === "file"
                  ? file
                    ? `Ready to import “${name || file.name}”`
                    : "Choose a video file to continue"
                  : url.trim()
                    ? "Ready to import from URL"
                    : "Paste a direct video URL to continue"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                You will be taken to the project workspace after upload.
              </p>
            </div>
            <button
              className="btn-primary min-w-[180px]"
              onClick={tab === "file" ? submitFile : submitUrl}
              disabled={disabled}
            >
              {busy ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {tab === "file" ? "Uploading…" : "Downloading…"}
                </>
              ) : (
                <>
                  <UploadCloud size={16} />
                  Import Video
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>

      </div>

      <Modal
        open={showAdvanced && Boolean(analysis)}
        onClose={() => setShowAdvanced(false)}
        title="Analysis & captions"
        description="Tune this import. Defaults come from Settings and can be changed later."
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowAdvanced(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => setShowAdvanced(false)}>
              Save choices
            </button>
          </>
        }
      >
        {analysis && (
          <div className="space-y-5">
            <SettingsGroup
              icon={Target}
              title="What to find"
              description="Control how many moments are selected and how long each clip may be."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Discovery mode</label>
                  <select
                    className="select"
                    value={analysis.discovery_mode}
                    onChange={(event) =>
                      setAnalysis({ ...analysis, discovery_mode: event.target.value })
                    }
                  >
                    <option value="best">Best moments</option>
                    <option value="facts">Facts &amp; insights</option>
                    <option value="quotes">Quotable lines</option>
                    <option value="hooks">Hooks &amp; openers</option>
                    <option value="tutorials">Tutorial steps</option>
                  </select>
                </div>
                <div>
                  <label className="label">Clip count</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={50}
                    value={analysis.clip_count}
                    onChange={(event) =>
                      setAnalysis({
                        ...analysis,
                        clip_count: Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Min duration (seconds)</label>
                  <input
                    type="number"
                    className="input"
                    min={5}
                    value={analysis.min_duration}
                    onChange={(event) =>
                      setAnalysis({
                        ...analysis,
                        min_duration: Math.max(5, Number(event.target.value) || 5),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Max duration (seconds)</label>
                  <input
                    type="number"
                    className="input"
                    min={10}
                    value={analysis.max_duration}
                    onChange={(event) =>
                      setAnalysis({
                        ...analysis,
                        max_duration: Math.max(10, Number(event.target.value) || 10),
                      })
                    }
                  />
                </div>
              </div>
            </SettingsGroup>

            <SettingsGroup
              icon={Cpu}
              title="AI providers"
              description="Cloud providers receive extracted audio or transcript text only."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Speech to text</label>
                  <select
                    className="select"
                    value={analysis.speech_provider}
                    onChange={(event) =>
                      setAnalysis({ ...analysis, speech_provider: event.target.value })
                    }
                  >
                    {(settings?.providers.speech || []).map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Clip analysis</label>
                  <select
                    className="select"
                    value={analysis.llm_provider}
                    onChange={(event) =>
                      setAnalysis({ ...analysis, llm_provider: event.target.value })
                    }
                  >
                    {(settings?.providers.llm || []).map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 space-y-3 rounded-lg border border-white/[0.055] bg-white/[0.018] p-3">
                <Toggle
                  checked={analysis.visual_analysis}
                  onChange={(next) => setAnalysis({ ...analysis, visual_analysis: next })}
                  label="Visual analysis"
                  description="Sample frames for scene cuts and faces. Off keeps everything local to audio."
                />
                <Toggle
                  checked={analysis.use_faces}
                  onChange={(next) => setAnalysis({ ...analysis, use_faces: next })}
                  label="Use face detection for framing"
                  description="Positions the crop on detected faces instead of the frame centre."
                />
              </div>
            </SettingsGroup>

            <SettingsGroup
              icon={Captions}
              title="Captions"
              description="The chosen style is applied to every clip created from this import."
            >
              <label className="label">Caption style</label>
              <select
                className="select"
                value={subtitlePreset}
                onChange={(event) => setSubtitlePreset(event.target.value)}
              >
                {Object.entries(settings?.subtitle_presets || {}).map(([id, preset]) => (
                  <option key={id} value={id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[12px] text-slate-400">
                Applied to every clip created from this import. You can fine-tune each clip later
                in the editor.
              </p>
            </SettingsGroup>
          </div>
        )}
      </Modal>
    </div>
  );
}
