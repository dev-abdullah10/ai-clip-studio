import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Film,
  FolderOpen,
  Languages,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Scissors,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  UploadCloud,
  Wand2,
} from "lucide-react";
import { api, triggerDownload } from "../api/client";
import type {
  AnalysisSettings,
  Clip,
  Job,
  ProjectDetail as ProjectDetailType,
  RenderSettings,
  SettingsResponse,
  Transcript,
} from "../api/types";
import { AnalysisSettingsForm } from "../components/AnalysisSettingsForm";
import { EmptyState } from "../components/EmptyState";
import { ExportDialog } from "../components/ExportDialog";
import { JobMonitor, JobRow } from "../components/JobMonitor";
import { ConfirmDialog, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ScoreRing } from "../components/ScoreRing";
import { StatusBadge } from "../components/StatusBadge";
import { isTerminal, useDocumentTitle, useJob } from "../hooks/useJob";
import { analysisSettingsFor, renderSettingsForClip } from "../lib/defaults";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatRelative,
  plural,
  titleCase,
} from "../lib/format";
import { toast } from "../store/ui";

type Tab = "clips" | "transcript" | "analysis" | "activity";

const TABS: Array<{ id: Tab; label: string; icon: typeof Film }> = [
  { id: "clips", label: "Clips", icon: Film },
  { id: "transcript", label: "Transcript", icon: FileText },
  { id: "analysis", label: "Analysis", icon: Sparkles },
  { id: "activity", label: "Activity", icon: Activity },
];

const CLIP_FILTERS = [
  { value: "all", label: "All clips" },
  { value: "selected", label: "Selected" },
  { value: "rendered", label: "Rendered" },
  { value: "unrendered", label: "Needs render" },
  { value: "failed", label: "Render failed" },
];

function MetaChip({
  icon: Icon,
  children,
  title,
}: {
  icon: typeof Film;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className="chip" title={title}>
      <Icon size={11} className="text-slate-500" />
      {children}
    </span>
  );
}

function PipelineStep({
  done,
  active,
  title,
  detail,
}: {
  done: boolean;
  active?: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={clsx(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
          done
            ? "border-mint-400/40 bg-mint-500/15 text-mint-400"
            : active
              ? "border-accent-400/50 bg-accent-500/20 text-accent-200"
              : "border-white/10 bg-white/[0.03] text-slate-500",
        )}
      >
        {done ? <Check size={11} /> : active ? <Loader2 size={10} className="animate-spin" /> : "·"}
      </span>
      <div className="min-w-0">
        <p
          className={clsx(
            "text-[12px] font-medium",
            done || active ? "text-slate-200" : "text-slate-400",
          )}
        >
          {title}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectionEndRef = useRef<number | null>(null);

  const [project, setProject] = useState<ProjectDetailType | null>(null);
  const [settingsResponse, setSettingsResponse] = useState<SettingsResponse | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisSettings | null>(null);
  const [tab, setTab] = useState<Tab>("clips");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [monitorJobId, setMonitorJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportClipIds, setExportClipIds] = useState<string[] | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [selectionReady, setSelectionReady] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [clipSearch, setClipSearch] = useState("");
  const [clipFilter, setClipFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [currentTime, setCurrentTime] = useState(0);

  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [transcriptVersion, setTranscriptVersion] = useState(0);
  const [importText, setImportText] = useState("");
  const [importLanguage, setImportLanguage] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const initialized = useRef(false);

  const loadProject = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setLoading(true);
      try {
        const next = await api.getProject(id);
        setProject(next);
        setError(null);
        if (!initialized.current) {
          initialized.current = true;
        }
        const active = next.jobs.find(
          (job) => job.status === "running" || job.status === "queued",
        );
        if (active) setMonitorJobId(active.id);
        else setJobs(next.jobs);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "This project could not load.");
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    loadProject();
    let active = true;
    api
      .getSettings()
      .then((response) => {
        if (active) setSettingsResponse(response);
      })
      .catch(() => {
        /* Defaults remain usable without the settings catalog. */
      })
      .finally(() => {
        if (active) setSettingsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [loadProject]);

  useEffect(() => {
    if (!project || !settingsLoaded || analysis) return;
    setAnalysis(analysisSettingsFor(project, settingsResponse?.settings));
  }, [project, settingsLoaded, settingsResponse, analysis]);

  useEffect(() => {
    if (!project) return;
    if (!selectionReady) {
      setSelected(project.clips.map((clip) => clip.id));
      setSelectionReady(true);
      return;
    }
    setSelected((current) =>
      current.filter((clipId) => project.clips.some((clip) => clip.id === clipId)),
    );
  }, [project, selectionReady]);

  useEffect(() => {
    if (!project) return;
    if (!selectedClipId || !project.clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(project.clips[0]?.id ?? null);
    }
  }, [project, selectedClipId]);

  const selectedClip = useMemo(
    () => project?.clips.find((clip) => clip.id === selectedClipId) || null,
    [project, selectedClipId],
  );

  const selectedClipStart = selectedClip?.start;

  useEffect(() => {
    if (selectedClipStart == null) return;
    setCurrentTime(selectedClipStart);
    selectionEndRef.current = null;
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState >= 1) {
      video.currentTime = selectedClipStart;
    } else {
      const seek = () => {
        video.currentTime = selectedClipStart;
        video.removeEventListener("loadedmetadata", seek);
      };
      video.addEventListener("loadedmetadata", seek);
    }
  }, [selectedClipId, selectedClipStart]);

  const liveJob = useJob(monitorJobId, (job) => {
    if (job.status === "completed") {
      const label =
        job.kind === "export"
          ? "Export finished"
          : job.kind === "render_clip"
            ? "Clip render finished"
            : "Analysis finished";
      toast.success(label, job.message || undefined);
      if (job.kind === "process" || job.kind === "analyze") setSelectionReady(false);
      loadProject(true);
      setTranscriptVersion((value) => value + 1);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } else if (job.status === "failed") {
      toast.error("A job failed", job.error || job.message || undefined);
      loadProject(true);
    } else if (job.status === "cancelled") {
      toast.info("Job cancelled", job.message || undefined);
      loadProject(true);
    }
  });

  useDocumentTitle(project?.name || "Project");

  useEffect(() => {
    if (tab !== "transcript" || !project?.has_transcript) return;
    let active = true;
    setTranscriptLoading(true);
    api
      .getTranscript(project.id)
      .then((next) => {
        if (active) setTranscript(next);
      })
      .catch((caught) => {
        if (active) {
          toast.error("Transcript unavailable", caught instanceof Error ? caught.message : undefined);
        }
      })
      .finally(() => {
        if (active) setTranscriptLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, project?.id, project?.has_transcript, transcriptVersion]);

  useEffect(() => {
    if (tab !== "activity" || !project) return;
    let active = true;
    setJobsLoading(true);
    api
      .listJobs({ project_id: project.id, limit: 100 })
      .then((response) => {
        if (active) setJobs(response.items);
      })
      .catch(() => {
        /* Keep the jobs included with the project detail. */
      })
      .finally(() => {
        if (active) setJobsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, project?.id, project]);

  const selectedClips = useMemo(
    () => project?.clips.filter((clip) => selected.includes(clip.id)) || [],
    [project, selected],
  );

  const categories = useMemo(
    () =>
      Array.from(
        new Set((project?.clips || []).map((clip) => clip.category).filter(Boolean)),
      ).sort(),
    [project],
  );

  const filteredClips = useMemo(() => {
    const needle = clipSearch.trim().toLowerCase();
    return (project?.clips || []).filter((clip) => {
      if (clipFilter === "selected" && !selected.includes(clip.id)) return false;
      if (clipFilter === "rendered" && !clip.has_render) return false;
      if (clipFilter === "unrendered" && clip.has_render) return false;
      if (clipFilter === "failed" && clip.render_status !== "failed") return false;
      if (categoryFilter !== "all" && clip.category !== categoryFilter) return false;
      if (!needle) return true;
      return [clip.title, clip.reason, clip.hook, clip.transcript_text, clip.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [project, clipSearch, clipFilter, categoryFilter, selected]);

  const activeJob = liveJob && !isTerminal(liveJob.status) ? liveJob : null;
  const working = busy || Boolean(activeJob);

  const startJob = async (mode: "pipeline" | "analyze" | "retranscribe", closeModal = true) => {
    if (!project || !analysis) return;
    if (analysis.discovery_mode === "custom" && !analysis.custom_instructions.trim()) {
      toast.warning("Custom mode needs instructions", "Describe what makes a great clip for this video.");
      return;
    }
    setBusy(true);
    try {
      let job: Job;
      if (mode === "analyze" && project.has_transcript) {
        job = await api.analyzeProject(project.id, analysis, true);
      } else if (mode === "retranscribe") {
        job = await api.processProject(project.id, analysis, false, true);
      } else {
        job = await api.processProject(project.id, analysis, project.has_transcript, false);
      }
      setMonitorJobId(job.id);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      toast.info(
        mode === "analyze" ? "Analyzing the saved transcript" : "Pipeline started",
        "Everything runs in the background with real progress.",
      );
      if (closeModal) setAnalysisOpen(false);
      await loadProject(true);
    } catch (caught) {
      toast.error(
        "Could not start processing",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  const saveAnalysisSettings = async () => {
    if (!project || !analysis) return;
    setDialogBusy(true);
    try {
      await api.updateAnalysisSettings(project.id, analysis);
      toast.success("Analysis settings saved");
      setAnalysisOpen(false);
      await loadProject(true);
    } catch (caught) {
      toast.error("Could not save settings", caught instanceof Error ? caught.message : undefined);
    } finally {
      setDialogBusy(false);
    }
  };

  const renameProject = async () => {
    if (!project || !renameValue.trim()) return;
    setDialogBusy(true);
    try {
      await api.updateProject(project.id, renameValue.trim());
      toast.success("Project renamed");
      setRenameOpen(false);
      await loadProject(true);
    } catch (caught) {
      toast.error("Could not rename", caught instanceof Error ? caught.message : undefined);
    } finally {
      setDialogBusy(false);
    }
  };

  const deleteProject = async () => {
    if (!project) return;
    setDialogBusy(true);
    try {
      await api.deleteProject(project.id);
      toast.success("Project deleted", "Its local media files were removed.");
      navigate("/projects");
    } catch (caught) {
      toast.error("Could not delete", caught instanceof Error ? caught.message : undefined);
      setDialogBusy(false);
    }
  };

  const importTranscript = async () => {
    if (!project || !importText.trim()) {
      toast.warning("Nothing to import", "Paste an SRT, VTT or plain transcript first.");
      return;
    }
    setImportBusy(true);
    try {
      const result = await api.importTranscript(
        project.id,
        importText,
        importLanguage || undefined,
      );
      toast.success(
        "Transcript imported",
        `${plural(result.segments, "segment")} · ${plural(result.word_count, "word")}`,
      );
      setTranscriptOpen(false);
      setImportText("");
      setTranscriptVersion((value) => value + 1);
      await loadProject(true);
      setTab("transcript");
    } catch (caught) {
      toast.error("Could not import the transcript", caught instanceof Error ? caught.message : undefined);
    } finally {
      setImportBusy(false);
    }
  };

  const cancelJob = async (job: Job) => {
    try {
      await api.cancelJob(job.id);
      toast.info("Cancellation requested", "The job stops at the next safe checkpoint.");
    } catch (caught) {
      toast.error("Could not cancel", caught instanceof Error ? caught.message : undefined);
    }
  };

  const renderClips = async (clips: Clip[]) => {
    if (!project || !clips.length || working) return;
    setBusy(true);
    try {
      const app = settingsResponse?.settings;
      let first: Job | null = null;
      for (const clip of clips) {
        const overrides: Partial<RenderSettings> = app
          ? {
              resolution: app.video.resolution,
              fps: app.video.fps,
              quality: app.video.quality,
              subtitle_settings: clip.subtitle_settings || app.subtitles,
            }
          : clip.subtitle_settings
            ? { subtitle_settings: clip.subtitle_settings }
            : {};
        const job = await api.renderClip(clip.id, renderSettingsForClip(clip, overrides));
        if (!first) first = job;
        setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      }
      if (first) setMonitorJobId(first.id);
      toast.info(
        clips.length === 1 ? "Rendering clip" : `Queued ${clips.length} renders`,
        "Rendering runs in the background. Progress is shown here and in Activity.",
      );
      await loadProject(true);
    } catch (caught) {
      toast.error("Could not start rendering", caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const playSelection = () => {
    const video = videoRef.current;
    if (!video || !selectedClip) return;
    selectionEndRef.current = selectedClip.end;
    video.currentTime = selectedClip.start;
    video.play().catch(() => undefined);
  };

  const selectClip = (clip: Clip) => {
    setSelectedClipId(clip.id);
    selectionEndRef.current = null;
    const video = videoRef.current;
    if (video && video.readyState >= 1) video.currentTime = clip.start;
  };

  const openExport = (clipIds?: string[]) => {
    if (!project) return;
    setExportClipIds(clipIds || (selected.length ? selected : project.clips.map((clip) => clip.id)));
    setExportOpen(true);
  };

  if (loading && !project) {
    return (
      <div>
        <PageHeader title="Loading project…" />
        <div className="skeleton mb-4 h-16" />
        <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px] 2xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <div className="skeleton h-[520px]" />
          <div className="skeleton h-[520px]" />
          <div className="skeleton h-[520px]" />
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div>
        <PageHeader
          title="Project unavailable"
          breadcrumbs={[{ label: "Projects", to: "/projects" }]}
        />
        <div className="panel flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
            <TriangleAlert size={22} />
          </div>
          <h2 className="text-base font-semibold text-white">This project could not be opened</h2>
          <p className="mt-1.5 max-w-md text-[13px] text-slate-400">
            {error || "The project may have been deleted."}
          </p>
          <Link to="/projects" className="btn-secondary mt-5">
            <ArrowLeft size={15} />
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const speechProviders = settingsResponse?.providers.speech || [];
  const llmProviders = settingsResponse?.providers.llm || [];
  const activeSpeech = settingsResponse?.statuses.find(
    (status) => status.kind === "speech" && status.active,
  );
  const activeLlm = settingsResponse?.statuses.find(
    (status) => status.kind === "llm" && status.active,
  );
  const allSelected = project.clips.length > 0 && selected.length === project.clips.length;
  const filteredSegments = (transcript?.segments || []).filter((segment) =>
    transcriptSearch.trim()
      ? segment.text.toLowerCase().includes(transcriptSearch.trim().toLowerCase())
      : true,
  );
  const selectedIndex = selectedClip
    ? project.clips.findIndex((clip) => clip.id === selectedClip.id) + 1
    : 0;
  const timelineDuration = Math.max(project.duration, 1);

  return (
    <div>
      <PageHeader
        title={project.name}
        eyebrow="Project workspace"
        breadcrumbs={[{ label: "Projects", to: "/projects" }, { label: project.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={project.status} />
            {project.source_filename && (
              <span
                className="truncate text-[12px] text-slate-500"
                title={project.source_filename}
              >
                {project.source_filename}
              </span>
            )}
            <span className="whitespace-nowrap text-[12px] text-slate-500">
              Updated {formatRelative(project.updated_at)}
            </span>
          </span>
        }
        actions={
          <>
            <button
              className="btn-ghost btn-sm text-slate-400"
              onClick={() => {
                setRenameValue(project.name);
                setRenameOpen(true);
              }}
              title="Rename project"
            >
              <Pencil size={14} />
              <span className="hidden lg:inline">Rename</span>
            </button>
            <button
              className="btn-ghost btn-sm text-slate-400 hover:text-rose-300"
              onClick={() => setDeleteOpen(true)}
              title="Delete project"
            >
              <Trash2 size={14} />
            </button>
            <button
              className="btn-secondary"
              onClick={() => setAnalysisOpen(true)}
              disabled={working}
            >
              <Settings2 size={15} />
              Analysis settings
            </button>
            <button
              className="btn-secondary"
              onClick={() => openExport()}
              disabled={!project.clips.length || working}
            >
              <Download size={15} />
              Export
            </button>
            <button
              className="btn-primary"
              disabled={working || !analysis || !project.source_exists}
              onClick={() => startJob(project.has_transcript ? "analyze" : "pipeline")}
            >
              {working ? (
                <Loader2 size={15} className="animate-spin" />
              ) : project.has_transcript ? (
                <Sparkles size={15} />
              ) : (
                <Wand2 size={15} />
              )}
              {working
                ? "Working…"
                : project.has_transcript
                  ? "Find clips"
                  : "Transcribe & find clips"}
            </button>
          </>
        }
      />

      {liveJob && <JobMonitor job={liveJob} className="mb-4" />}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((item) => {
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
                {item.id === "clips" && project.clips.length > 0 && (
                  <span className="rounded bg-white/[0.07] px-1.5 text-[11px] tabular-nums text-slate-300">
                    {project.clips.length}
                  </span>
                )}
                {item.id === "analysis" && project.analysis?.warnings.length ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
                ) : null}
                {active && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-500" />
                )}
              </button>
            );
          })}
        </div>
        {tab === "clips" && project.clips.length > 0 && (
          <div className="flex items-center gap-2 pb-2">
            <button
              className="btn-ghost btn-xs"
              onClick={() => setSelected(allSelected ? [] : project.clips.map((clip) => clip.id))}
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>
        )}
      </div>

      {tab === "clips" && (
        <>
          {project.clips.length === 0 ? (
            <EmptyState
              icon={Film}
              title="No clips yet"
              description={
                project.has_transcript
                  ? "The transcript is ready. Run the moment analysis to find the strongest clips."
                  : "Transcribe this video first, then the AI will find the strongest standalone moments."
              }
              action={
                <button
                  className="btn-primary"
                  disabled={working || !project.source_exists}
                  onClick={() => startJob(project.has_transcript ? "analyze" : "pipeline")}
                >
                  {project.has_transcript ? <Sparkles size={15} /> : <Wand2 size={15} />}
                  {project.has_transcript ? "Find clips" : "Start transcription"}
                </button>
              }
            />
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px] 2xl:grid-cols-[300px_minmax(0,1fr)_340px]">
                <aside className="panel flex min-w-0 flex-col overflow-hidden">
                  <div className="border-b border-white/[0.06] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-[13px] font-semibold text-white">Clip library</h2>
                      <span className="text-[11px] tabular-nums text-slate-500">
                        {project.clips.length} total
                      </span>
                    </div>
                    <div className="relative mt-2.5">
                      <Search
                        size={13}
                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                      />
                      <input
                        className="input input-sm pl-8"
                        placeholder="Search clips..."
                        value={clipSearch}
                        onChange={(event) => setClipSearch(event.target.value)}
                      />
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      <select
                        className="select input-sm w-full text-[12px]"
                        value={clipFilter}
                        onChange={(event) => setClipFilter(event.target.value)}
                        aria-label="Filter clips"
                      >
                        {CLIP_FILTERS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="select input-sm w-full text-[12px]"
                        value={categoryFilter}
                        onChange={(event) => setCategoryFilter(event.target.value)}
                        aria-label="Filter clips by category"
                      >
                        <option value="all">All categories</option>
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {titleCase(category)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="max-h-[560px] flex-1 overflow-y-auto">
                    {filteredClips.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <p className="text-[12px] text-slate-400">No clips match those filters.</p>
                        <button
                          className="btn-ghost btn-xs mt-2"
                          onClick={() => {
                            setClipSearch("");
                            setClipFilter("all");
                            setCategoryFilter("all");
                          }}
                        >
                          Clear filters
                        </button>
                      </div>
                    ) : (
                      filteredClips.map((clip) => {
                        const active = clip.id === selectedClipId;
                        const isSelected = selected.includes(clip.id);
                        return (
                          <div
                            key={clip.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => selectClip(clip)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                selectClip(clip);
                              }
                            }}
                            className={clsx(
                              "group flex cursor-pointer items-center gap-2.5 border-b border-white/[0.045] px-3 py-2.5 transition last:border-0",
                              active
                                ? "bg-accent-500/[0.1] shadow-[inset_2px_0_0_#8965F5]"
                                : "hover:bg-white/[0.025]",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() =>
                                setSelected((current) =>
                                  current.includes(clip.id)
                                    ? current.filter((value) => value !== clip.id)
                                    : [...current, clip.id],
                                )
                              }
                              className="h-3.5 w-3.5 shrink-0 accent-accent-500"
                              aria-label={isSelected ? "Deselect clip" : "Select clip"}
                            />
                            <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md border border-white/[0.07] bg-base-900">
                              {clip.thumbnail_url ? (
                                <img
                                  src={clip.thumbnail_url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-slate-600">
                                  <Film size={13} />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p
                                className={clsx(
                                  "truncate text-[12px] font-medium",
                                  active ? "text-white" : "text-slate-200",
                                )}
                                title={clip.title}
                              >
                                {clip.title}
                              </p>
                              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                                <span>{formatDuration(clip.duration)}</span>
                                <span>·</span>
                                <span className="truncate capitalize">{clip.category}</span>
                                {clip.has_render && (
                                  <span className="ml-auto shrink-0 text-mint-400">rendered</span>
                                )}
                              </p>
                            </div>
                            <ScoreRing score={clip.score} size={28} stroke={3} />
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="border-t border-white/[0.06] px-3.5 py-2.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>
                        {selected.length} of {project.clips.length} selected
                      </span>
                      <button
                        className="text-accent-300 transition hover:text-accent-200"
                        onClick={() =>
                          setSelected(allSelected ? [] : project.clips.map((clip) => clip.id))
                        }
                      >
                        {allSelected ? "Clear" : "Select all"}
                      </button>
                    </div>
                  </div>
                </aside>

                <section className="panel min-w-0 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
                    <h2 className="truncate text-[13px] font-semibold text-white">
                      {selectedClip ? selectedClip.title : "Preview"}
                    </h2>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {selectedClip && (
                        <button
                          className="btn-ghost btn-xs"
                          onClick={playSelection}
                          disabled={!project.source_exists}
                          title="Play the selected range"
                        >
                          <Play size={12} />
                          Play clip
                        </button>
                      )}
                      <span className="badge-neutral">Source</span>
                    </div>
                  </div>

                  <div className="relative aspect-video bg-black">
                    {project.source_exists ? (
                      <video
                        ref={videoRef}
                        key={project.id}
                        className="h-full w-full"
                        controls
                        preload="metadata"
                        poster={project.thumbnail_url || undefined}
                        src={`/api/media/projects/${project.id}/source`}
                        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                        <TriangleAlert size={26} className="text-gold-400" />
                        <p className="text-[13px]">The source video is missing from local storage.</p>
                        <p className="text-[11px] text-slate-500">Re-import the file to render clips.</p>
                      </div>
                    )}
                  </div>

                  <div className="px-4 pt-3">
                    <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-500">
                      <span>{formatDuration(currentTime)}</span>
                      <span>{formatDuration(project.duration)}</span>
                    </div>
                    <div className="relative mt-1.5 h-8 overflow-hidden rounded-md border border-white/[0.06] bg-base-925">
                      {project.clips.map((clip) => (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => selectClip(clip)}
                          title={`${clip.title} · ${formatDuration(clip.start)}–${formatDuration(clip.end)}`}
                          className={clsx(
                            "absolute top-1 h-6 rounded-sm border transition",
                            clip.id === selectedClipId
                              ? "z-10 border-accent-300/60 bg-accent-500/80"
                              : clip.has_render
                                ? "border-mint-400/25 bg-mint-500/30 hover:bg-mint-500/50"
                                : "border-accent-400/20 bg-accent-500/25 hover:bg-accent-500/45",
                          )}
                          style={{
                            left: `${Math.min(99.4, (clip.start / timelineDuration) * 100)}%`,
                            width: `${Math.max(0.6, (clip.duration / timelineDuration) * 100)}%`,
                          }}
                        />
                      ))}
                      <div
                        className="pointer-events-none absolute inset-y-0 z-20 w-px bg-white/85"
                        style={{
                          left: `${Math.min(100, (currentTime / timelineDuration) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{plural(project.clip_count, "clip")} on the timeline</span>
                      <span>
                        {selectedClip
                          ? `${formatDuration(selectedClip.start)} – ${formatDuration(selectedClip.end)}`
                          : "Select a clip to preview its range"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] px-4 py-2.5">
                    <MetaChip icon={Clock3}>{formatDuration(project.duration)}</MetaChip>
                    {project.width && project.height && (
                      <MetaChip icon={Film}>
                        {project.width}×{project.height}
                      </MetaChip>
                    )}
                    {project.fps && (
                      <MetaChip icon={Activity}>{Math.round(project.fps)} fps</MetaChip>
                    )}
                    {project.file_size && (
                      <MetaChip icon={FolderOpen}>{formatBytes(project.file_size)}</MetaChip>
                    )}
                    {project.language && (
                      <MetaChip icon={Languages}>
                        <span className="capitalize">{project.language}</span>
                      </MetaChip>
                    )}
                    {project.video_codec && <MetaChip icon={Film}>{project.video_codec}</MetaChip>}
                    {!project.has_audio && (
                      <span className="badge-amber">
                        <TriangleAlert size={10} />
                        No audio track
                      </span>
                    )}
                    {project.source_url && (
                      <a
                        href={project.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="chip text-accent-300"
                      >
                        Source URL
                      </a>
                    )}
                  </div>

                  {selectedClip && (
                    <div className="border-t border-white/[0.06] px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-slate-500">
                          Selected clip transcript
                        </p>
                        <Link
                          to={`/clips/${selectedClip.id}`}
                          className="flex items-center gap-1 text-[11px] font-medium text-accent-300 transition hover:text-accent-200"
                        >
                          Open editor
                          <ArrowRight size={11} />
                        </Link>
                      </div>
                      <p className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-line text-[12px] leading-relaxed text-slate-400">
                        {selectedClip.transcript_text || "No transcript text recorded for this clip."}
                      </p>
                    </div>
                  )}
                </section>

                <div className="min-w-0 space-y-4">
                  <aside className="panel overflow-hidden">
                    <div className="panel-header px-4 py-3">
                      <div>
                        <h2 className="text-[13px] font-semibold text-white">Clip details</h2>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {selectedClip ? `Clip ${selectedIndex} of ${project.clips.length}` : "No clip selected"}
                        </p>
                      </div>
                      {selectedClip && (
                        <Link
                          to={`/clips/${selectedClip.id}`}
                          className="btn-secondary btn-xs shrink-0"
                        >
                          <ExternalLink size={12} />
                          Edit
                        </Link>
                      )}
                    </div>
                    {selectedClip ? (
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="badge-violet capitalize">
                                <Sparkles size={9} />
                                {selectedClip.category}
                              </span>
                              <StatusBadge status={selectedClip.render_status} />
                            </div>
                            <h3 className="mt-2 text-[14px] font-semibold leading-snug text-white">
                              {selectedClip.title}
                            </h3>
                          </div>
                          <div className="flex shrink-0 flex-col items-center">
                            <ScoreRing score={selectedClip.score} size={50} stroke={4} />
                            <span className="mt-0.5 text-[11px] text-slate-500">AI score</span>
                          </div>
                        </div>

                        <div className="mt-3 space-y-2.5">
                          <div>
                            <p className="text-[11px] font-medium text-slate-500">Why this moment</p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-300">
                              {selectedClip.reason || "No reason was recorded."}
                            </p>
                          </div>
                          {selectedClip.hook && (
                            <div>
                              <p className="text-[11px] font-medium text-slate-500">Hook</p>
                              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-300">
                                {selectedClip.hook}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3">
                          {[
                            ["Range", `${formatDuration(selectedClip.start)}–${formatDuration(selectedClip.end)}`],
                            ["Duration", formatDuration(selectedClip.duration)],
                            ["Aspect", selectedClip.aspect_ratio === "original" ? "Original" : selectedClip.aspect_ratio],
                            ["Captions", selectedClip.subtitle_enabled ? "On" : "Off"],
                            ["Crop", titleCase(selectedClip.crop_mode)],
                            ["Render", titleCase(selectedClip.render_status)],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <p className="text-[11px] text-slate-500">{label}</p>
                              <p className="mt-0.5 truncate text-[12px] text-slate-300" title={value}>
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 space-y-2">
                          <Link to={`/clips/${selectedClip.id}`} className="btn-primary w-full">
                            <Scissors size={14} />
                            Open in Editor
                          </Link>
                          <button
                            className="btn-secondary w-full"
                            onClick={() => renderClips([selectedClip])}
                            disabled={working || !project.source_exists}
                          >
                            {working ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Film size={14} />
                            )}
                            {selectedClip.has_render ? "Re-render clip" : "Render clip"}
                          </button>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              className="btn-ghost btn-xs"
                              onClick={() => openExport([selectedClip.id])}
                            >
                              <Download size={12} />
                              Export
                            </button>
                            {selectedClip.has_render && selectedClip.render_url ? (
                              <button
                                className="btn-ghost btn-xs"
                                onClick={() => triggerDownload(selectedClip.render_url || "")}
                              >
                                <Download size={12} />
                                Save MP4
                              </button>
                            ) : (
                              <Link
                                to={`/clips/${selectedClip.id}`}
                                className="btn-ghost btn-xs"
                              >
                                <Settings2 size={12} />
                                Details
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4">
                        <EmptyState
                          icon={Film}
                          title="Select a clip"
                          description="Choose a clip in the library to preview it and see its AI details here."
                          compact
                        />
                      </div>
                    )}
                  </aside>

                  <aside className="panel p-4">
                    <h2 className="flex items-center gap-2 text-[13px] font-semibold text-white">
                      <Wand2 size={15} className="text-accent-300" />
                      Clip factory
                    </h2>
                    <div className="mt-3 space-y-3">
                      <PipelineStep
                        done={project.has_transcript}
                        active={Boolean(
                          activeJob && ["process"].includes(activeJob.kind) && !project.has_transcript,
                        )}
                        title="Transcript"
                        detail={
                          project.has_transcript
                            ? `${plural(project.transcript_meta?.segment_count || 0, "segment")} · ${
                                project.transcript_meta?.provider || "imported"
                              }`
                            : "No transcript yet. Speech-to-text runs on the extracted audio."
                        }
                      />
                      <PipelineStep
                        done={Boolean(project.analysis)}
                        active={Boolean(activeJob && ["process", "analyze"].includes(activeJob.kind))}
                        title="Moment analysis"
                        detail={
                          project.analysis
                            ? `${project.analysis.used_llm ? project.analysis.model || project.analysis.provider : "Local heuristics"} · ${plural(project.analysis.candidates.length, "candidate")}`
                            : "The LLM (or local heuristics) scores every candidate moment."
                        }
                      />
                      <PipelineStep
                        done={project.clip_count > 0}
                        title="Editable clips"
                        detail={
                          project.clip_count > 0
                            ? `${plural(project.clip_count, "clip")} · ${project.rendered_clip_count} rendered`
                            : "Selected moments appear here for editing and rendering."
                        }
                      />
                    </div>

                    <div className="mt-4 space-y-2">
                      <button
                        className="btn-primary w-full"
                        disabled={working || !analysis || !project.source_exists}
                        onClick={() => startJob(project.has_transcript ? "analyze" : "pipeline")}
                      >
                        {project.has_transcript ? <Sparkles size={15} /> : <Wand2 size={15} />}
                        {project.has_transcript ? "Re-run moment analysis" : "Transcribe & find clips"}
                      </button>
                      {project.has_transcript && (
                        <button
                          className="btn-secondary w-full"
                          disabled={working || !analysis}
                          onClick={() => startJob("retranscribe")}
                        >
                          <RefreshCw size={14} />
                          Transcribe again
                        </button>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => setAnalysisOpen(true)}
                          disabled={working}
                        >
                          <Settings2 size={13} />
                          Tune analysis
                        </button>
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => setTranscriptOpen(true)}
                          disabled={working}
                        >
                          <UploadCloud size={13} />
                          Subtitles
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg border border-white/[0.055] bg-white/[0.018] px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
                      <p>
                        Speech: <span className="text-slate-300">{activeSpeech?.name || "not configured"}</span>
                        <br />
                        Analysis: <span className="text-slate-300">{activeLlm?.name || "not configured"}</span>
                      </p>
                      <Link
                        to="/settings"
                        className="mt-1.5 inline-flex items-center gap-1 text-accent-300 hover:text-accent-200"
                      >
                        Provider settings
                        <ArrowRight size={10} />
                      </Link>
                    </div>
                  </aside>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-base-850 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-slate-300">
                    {selected.length} of {project.clips.length} clips selected
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {selectedClips.reduce((sum, clip) => sum + clip.duration, 0) > 0
                      ? `${formatDuration(selectedClips.reduce((sum, clip) => sum + clip.duration, 0))} of selected footage`
                      : "Select clips to export or render in a batch."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => setSelected(allSelected ? [] : project.clips.map((clip) => clip.id))}
                  >
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => renderClips(selectedClips)}
                    disabled={!selected.length || working || !project.source_exists}
                  >
                    <Film size={14} />
                    Render selected
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => openExport()}
                    disabled={!selected.length || working}
                  >
                    <Download size={14} />
                    Export selected
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "transcript" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <FileText
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                className="input pl-10"
                placeholder="Search the transcript..."
                value={transcriptSearch}
                onChange={(event) => setTranscriptSearch(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button className="btn-secondary btn-sm" onClick={() => setTranscriptOpen(true)}>
                <UploadCloud size={13} />
                Import
              </button>
              {project.has_transcript && (
                <>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => triggerDownload(api.transcriptDownloadUrl(project.id, "srt"))}
                  >
                    <Download size={12} />
                    SRT
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => triggerDownload(api.transcriptDownloadUrl(project.id, "vtt"))}
                  >
                    <Download size={12} />
                    VTT
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => triggerDownload(api.transcriptDownloadUrl(project.id, "json"))}
                  >
                    <Download size={12} />
                    JSON
                  </button>
                </>
              )}
              <button
                className="btn-primary btn-sm"
                disabled={working || !project.source_exists}
                onClick={() => startJob("retranscribe")}
              >
                <RefreshCw size={12} />
                Re-transcribe
              </button>
            </div>
          </div>

          {!project.has_transcript ? (
            <EmptyState
              icon={FileText}
              title="No transcript yet"
              description="Transcribe the extracted audio with your speech provider, or import an SRT / VTT / plain-text transcript you already have."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    className="btn-primary"
                    disabled={working || !project.source_exists}
                    onClick={() => startJob("pipeline")}
                  >
                    <Wand2 size={15} />
                    Transcribe & find clips
                  </button>
                  <button className="btn-secondary" onClick={() => setTranscriptOpen(true)}>
                    <UploadCloud size={15} />
                    Import transcript
                  </button>
                </div>
              }
            />
          ) : transcriptLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="skeleton h-16" />
              ))}
            </div>
          ) : transcript ? (
            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="chip capitalize">
                    <Languages size={11} />
                    {transcript.language || "unknown"}
                  </span>
                  <span className="chip">{plural(transcript.segments.length, "segment")}</span>
                  <span className="chip">{plural(transcript.word_count, "word")}</span>
                  <span className="chip">
                    {transcript.provider}
                    {transcript.model ? ` · ${transcript.model}` : ""}
                  </span>
                </div>
                {transcriptSearch && (
                  <span className="text-[11px] text-slate-500">
                    {filteredSegments.length} matching segments
                  </span>
                )}
              </div>
              <div className="max-h-[62vh] overflow-y-auto px-4 py-2">
                {filteredSegments.length === 0 ? (
                  <p className="py-8 text-center text-[12px] text-slate-400">
                    No segments match “{transcriptSearch}”.
                  </p>
                ) : (
                  filteredSegments.map((segment, index) => (
                    <button
                      key={`${segment.start}-${index}`}
                      type="button"
                      className="group flex w-full gap-3 border-b border-white/[0.04] py-2.5 text-left last:border-0 hover:bg-white/[0.02]"
                      onClick={() => {
                        setTab("clips");
                        selectionEndRef.current = null;
                        window.setTimeout(() => {
                          const video = videoRef.current;
                          if (!video) return;
                          const play = () => {
                            video.currentTime = segment.start;
                            video.play().catch(() => undefined);
                          };
                          if (video.readyState >= 1) play();
                          else video.addEventListener("loadedmetadata", play, { once: true });
                        }, 60);
                      }}
                      title="Play from this moment"
                    >
                      <span className="w-12 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-slate-500 group-hover:text-accent-300">
                        {formatDuration(segment.start)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-relaxed text-slate-300 group-hover:text-white">
                          {segment.text}
                        </span>
                        {segment.speaker && (
                          <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-accent-300/70">
                            {segment.speaker}
                          </span>
                        )}
                      </span>
                      <Play
                        size={12}
                        className="mt-1 shrink-0 text-transparent transition group-hover:text-accent-300"
                      />
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title="The transcript could not be read"
              description="The saved file may be missing or invalid. Re-transcribe or import a subtitle file."
              compact
            />
          )}
        </div>
      )}

      {tab === "analysis" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="panel p-5">
            {!project.analysis ? (
              <EmptyState
                icon={Sparkles}
                title="No analysis yet"
                description="Run the moment analysis to see how candidates were discovered, why they scored the way they did, and any provider warnings."
                compact
                action={
                  <button
                    className="btn-primary btn-sm"
                    disabled={working || !project.has_transcript}
                    onClick={() => startJob("analyze")}
                  >
                    <Sparkles size={13} />
                    Analyze transcript
                  </button>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[15px] font-semibold text-white">Latest analysis</h2>
                  <span className="text-[11px] text-slate-500">
                    {formatDate(project.analysis.created_at)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="badge-violet">
                    <Sparkles size={10} />
                    {titleCase(project.analysis.discovery_mode)}
                  </span>
                  <span className="chip">
                    {project.analysis.used_llm
                      ? `${project.analysis.provider || "LLM"}${project.analysis.model ? ` · ${project.analysis.model}` : ""}`
                      : "Local heuristics"}
                  </span>
                  <span className="chip">{plural(project.analysis.chunk_count, "chunk")}</span>
                  <span className="chip">
                    {plural(project.analysis.candidates.length, "candidate")}
                  </span>
                </div>

                {project.analysis.warnings.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {project.analysis.warnings.map((warning, index) => (
                      <p
                        key={index}
                        className="flex items-start gap-2 rounded-lg border border-gold-400/20 bg-gold-400/[0.06] px-3 py-2 text-[12px] leading-relaxed text-gold-300"
                      >
                        <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                        {warning}
                      </p>
                    ))}
                  </div>
                )}

                <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.06]">
                  <div className="grid grid-cols-[82px_minmax(0,1fr)_60px_60px] gap-2 border-b border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[11px] font-semibold text-slate-500">
                    <span>Time</span>
                    <span>Candidate</span>
                    <span className="text-right">AI</span>
                    <span className="text-right">Local</span>
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto">
                    {project.analysis.candidates.length === 0 ? (
                      <p className="px-3 py-8 text-center text-[12px] text-slate-400">
                        No candidates survived validation. Try a wider duration range or another
                        discovery mode.
                      </p>
                    ) : (
                      project.analysis.candidates.map((candidate, index) => (
                        <div
                          key={`${candidate.start}-${index}`}
                          className="grid grid-cols-[82px_minmax(0,1fr)_60px_60px] items-center gap-2 border-b border-white/[0.04] px-3 py-2.5 last:border-0 hover:bg-white/[0.02]"
                        >
                          <span className="font-mono text-[11px] tabular-nums text-slate-500">
                            {formatDuration(candidate.start)}–{formatDuration(candidate.end)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] text-slate-200">{candidate.title}</p>
                            <p className="truncate text-[11px] text-slate-500">
                              {titleCase(candidate.source)} ·{" "}
                              {formatDuration(candidate.end - candidate.start)}
                            </p>
                          </div>
                          <span className="text-right text-[12px] font-semibold tabular-nums text-accent-200">
                            {Math.round(candidate.score)}
                          </span>
                          <span className="text-right text-[11px] tabular-nums text-slate-400">
                            {Math.round(candidate.local_score)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <aside className="panel h-fit p-4">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-white">
              <FileText size={14} className="text-accent-300" />
              Saved settings
            </h3>
            {project.analysis_settings ? (
              <div className="mt-2 space-y-1.5 text-[12px] text-slate-400">
                <p className="flex justify-between gap-2">
                  <span>Mode</span>
                  <span className="text-slate-300">
                    {titleCase(project.analysis_settings.discovery_mode || "best")}
                  </span>
                </p>
                <p className="flex justify-between gap-2">
                  <span>Clips</span>
                  <span className="text-slate-300">{project.analysis_settings.clip_count}</span>
                </p>
                <p className="flex justify-between gap-2">
                  <span>Duration</span>
                  <span className="text-slate-300">
                    {project.analysis_settings.min_duration}s–
                    {project.analysis_settings.max_duration}s
                  </span>
                </p>
                <p className="flex justify-between gap-2">
                  <span>Speech</span>
                  <span className="truncate text-slate-300">
                    {project.analysis_settings.speech_provider}
                  </span>
                </p>
                <p className="flex justify-between gap-2">
                  <span>Analysis</span>
                  <span className="truncate text-slate-300">
                    {project.analysis_settings.llm_provider}
                  </span>
                </p>
                <p className="flex justify-between gap-2">
                  <span>Scene alignment</span>
                  <span className="text-slate-300">
                    {project.analysis_settings.visual_analysis ? "on" : "off"}
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
                Default settings are used until you save this project’s analysis settings.
              </p>
            )}
            <button
              className="btn-secondary btn-sm mt-3 w-full"
              onClick={() => setAnalysisOpen(true)}
            >
              <Settings2 size={12} />
              Edit settings
            </button>
          </aside>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-2">
          {jobsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="skeleton h-14" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No jobs yet"
              description="Transcription, analysis, renders and exports for this project will appear here."
              compact
            />
          ) : (
            jobs.map((job) => <JobRow key={job.id} job={job} onCancel={cancelJob} />)
          )}
        </div>
      )}

      <Modal
        open={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
        title="Analysis settings"
        description="Choose what to find, how long clips should be, and which providers do the work."
        size="xl"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAnalysisOpen(false)} disabled={dialogBusy}>
              Cancel
            </button>
            <button className="btn-secondary" onClick={saveAnalysisSettings} disabled={dialogBusy}>
              Save settings
            </button>
            <button
              className="btn-primary"
              disabled={dialogBusy || working}
              onClick={() => startJob(project.has_transcript ? "analyze" : "pipeline")}
            >
              {dialogBusy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Save & run
            </button>
          </>
        }
      >
        {analysis && (
          <AnalysisSettingsForm
            value={analysis}
            onChange={setAnalysis}
            speechProviders={speechProviders}
            llmProviders={llmProviders}
          />
        )}
      </Modal>

      <Modal
        open={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        title="Import a transcript"
        description="Skip cloud transcription by importing an SRT, VTT or plain-text transcript. Timestamps are parsed when present."
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setTranscriptOpen(false)} disabled={importBusy}>
              Cancel
            </button>
            <button className="btn-primary" onClick={importTranscript} disabled={importBusy || !importText.trim()}>
              {importBusy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
              Import transcript
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn-secondary btn-sm cursor-pointer">
              <UploadCloud size={13} />
              Choose subtitle file
              <input
                type="file"
                accept=".srt,.vtt,.txt,.sbv"
                className="hidden"
                onChange={async (event) => {
                  const chosen = event.target.files?.[0];
                  if (!chosen) return;
                  try {
                    setImportText(await chosen.text());
                  } catch {
                    toast.error("Could not read that file");
                  }
                }}
              />
            </label>
            <span className="text-[12px] text-slate-500">.srt, .vtt or .txt</span>
          </div>
          <div>
            <label className="label">Transcript text</label>
            <textarea
              className="input min-h-[220px] resize-y font-mono text-[12px]"
              placeholder={"1\n00:00:01,000 --> 00:00:04,200\nPaste an SRT or WebVTT transcript here…"}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Plain text without timestamps is split into segments by the parser; automatic
              timestamps are approximations, not real speech timing.
            </p>
          </div>
          <div>
            <label className="label">Language (optional)</label>
            <input
              className="input"
              placeholder="e.g. en"
              maxLength={20}
              value={importLanguage}
              onChange={(event) => setImportLanguage(event.target.value)}
            />
          </div>
        </div>
      </Modal>

      <ExportDialog
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
          setExportClipIds(null);
        }}
        projectId={project.id}
        projectName={project.name}
        clips={project.clips}
        initialSelection={
          exportClipIds?.length ? exportClipIds : project.clips.map((clip) => clip.id)
        }
        appSettings={settingsResponse?.settings}
        onStarted={(job) => {
          setMonitorJobId(job.id);
          setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
          loadProject(true);
        }}
      />

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename project"
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRenameOpen(false)} disabled={dialogBusy}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={renameProject}
              disabled={dialogBusy || !renameValue.trim()}
            >
              Save name
            </button>
          </>
        }
      >
        <label className="label">Project name</label>
        <input
          className="input"
          value={renameValue}
          maxLength={200}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") renameProject();
          }}
          autoFocus
        />
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this project?"
        message={`“${project.name}” and all of its clips, rendered files and exports will be deleted from local storage. This cannot be undone.`}
        confirmLabel="Delete project"
        danger
        busy={dialogBusy}
        onConfirm={deleteProject}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
