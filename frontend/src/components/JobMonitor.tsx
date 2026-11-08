import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Loader2,
  XCircle,
} from "lucide-react";
import { api } from "../api/client";
import type { Job } from "../api/types";
import { JOB_KIND_LABELS } from "../lib/constants";
import { formatDate, formatRelative } from "../lib/format";
import { toast } from "../store/ui";
import { ProgressBar } from "./ProgressBar";
import { StatusBadge } from "./StatusBadge";

function JobIcon({ job, size = 15 }: { job: Job; size?: number }) {
  if (job.status === "running") {
    return <Loader2 size={size} className="animate-spin text-accent-300" />;
  }
  if (job.status === "completed") return <CheckCircle2 size={size} className="text-mint-400" />;
  if (job.status === "failed") return <XCircle size={size} className="text-rose-400" />;
  if (job.status === "cancelled") return <Ban size={size} className="text-slate-500" />;
  return <CircleDashed size={size} className="text-slate-500" />;
}

function useElapsed(job: Job | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "queued")) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job]);
  if (!job?.started_at) return null;
  const start = new Date(job.started_at).getTime();
  if (Number.isNaN(start)) return null;
  if (job.finished_at) {
    const end = new Date(job.finished_at).getTime();
    if (!Number.isNaN(end)) return formatSpan((end - start) / 1000);
  }
  return formatSpan((now - start) / 1000);
}

function formatSpan(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return minutes > 0 ? `${minutes}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
}

export function JobProgress({
  job,
  onCancel,
  className,
  showKind = true,
}: {
  job: Job;
  onCancel?: () => void;
  className?: string;
  showKind?: boolean;
}) {
  const active = job.status === "running" || job.status === "queued";
  const elapsed = useElapsed(job);
  return (
    <div className={clsx("rounded-lg border border-white/[0.06] bg-base-850 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.03]">
            <JobIcon job={job} size={13} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold text-white">
                {JOB_KIND_LABELS[job.kind] || job.kind}
              </p>
              <StatusBadge status={job.status} />
              {elapsed && <span className="text-[11px] text-slate-500">{elapsed}</span>}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-slate-400">
              {job.message || job.stage || "Waiting to start…"}
            </p>
          </div>
        </div>
        {active && onCancel && (
          <button
            type="button"
            className="btn-ghost btn-xs shrink-0 text-slate-500"
            onClick={onCancel}
            title="Request cancellation"
          >
            <Ban size={13} />
            Cancel
          </button>
        )}
      </div>
      <div className="mt-3">
        <ProgressBar
          value={job.progress}
          tone={
            job.status === "failed"
              ? "rose"
              : job.status === "completed"
                ? "green"
                : job.status === "cancelled"
                  ? "slate"
                  : "violet"
          }
          showGlow={job.status === "running"}
        />
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
          <span className="truncate">
            {job.stage || (showKind ? JOB_KIND_LABELS[job.kind] : "")}
          </span>
          <span className="tabular-nums">{Math.round(job.progress)}%</span>
        </div>
      </div>
      {job.status === "failed" && job.error && (
        <p className="mt-2.5 rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-2.5 py-2 text-[12px] leading-relaxed text-rose-300">
          {job.error}
        </p>
      )}
    </div>
  );
}

export function JobRow({
  job,
  onCancel,
  onSelect,
  showProject = false,
  projectName,
}: {
  job: Job;
  onCancel?: (job: Job) => void;
  onSelect?: (job: Job) => void;
  showProject?: boolean;
  projectName?: string | null;
}) {
  const active = job.status === "running" || job.status === "queued";
  const elapsed = useElapsed(job);
  const clickable = Boolean(onSelect);

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelect?.(job) : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.(job);
              }
            }
          : undefined
      }
      className={clsx(
        "group flex items-center gap-3 rounded-lg border border-white/[0.055] bg-base-850 px-3.5 py-3 transition",
        clickable && "cursor-pointer hover:border-white/[0.11] hover:bg-base-800/60",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-base-900">
        <JobIcon job={job} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[13px] font-semibold text-slate-200">
            {JOB_KIND_LABELS[job.kind] || job.kind}
          </p>
          <StatusBadge status={job.status} />
          {showProject && projectName && (
            <span className="truncate text-[11px] text-slate-500">· {projectName}</span>
          )}
          {elapsed && <span className="text-[11px] text-slate-500">{elapsed}</span>}
        </div>
        <p className="mt-0.5 truncate text-[12px] text-slate-400">
          {job.error || job.message || job.stage || "Queued"}
        </p>
        {active && (
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar value={job.progress} className="h-1" />
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
              {Math.round(job.progress)}%
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {showProject && job.project_id && (
          <Link
            to={`/projects/${job.project_id}`}
            onClick={(event) => event.stopPropagation()}
            className="hidden rounded-md px-2 py-1 text-[11px] font-medium text-accent-300 transition hover:bg-white/[0.05] hover:text-accent-200 sm:inline-flex"
          >
            Open project
          </Link>
        )}
        <div className="hidden text-right sm:block">
          <p className="text-[11px] text-slate-500" title={formatDate(job.created_at)}>
            {formatRelative(job.created_at)}
          </p>
        </div>
        {active && onCancel && (
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={(event) => {
              event.stopPropagation();
              onCancel(job);
            }}
            title="Request cancellation"
          >
            <Ban size={13} />
          </button>
        )}
        {clickable && (
          <ChevronRight
            size={15}
            className="text-slate-600 transition group-hover:text-slate-400"
          />
        )}
      </div>
    </div>
  );
}

export function JobMonitor({
  job,
  onCancelled,
  className,
}: {
  job: Job | null;
  onCancelled?: () => void;
  className?: string;
}) {
  if (!job) return null;
  const active = job.status === "running" || job.status === "queued";
  return (
    <JobProgress
      job={job}
      className={className}
      onCancel={
        active
          ? async () => {
              try {
                await api.cancelJob(job.id);
                toast.info("Cancellation requested", "The job will stop at the next safe point.");
                onCancelled?.();
              } catch (error) {
                toast.error(
                  "Could not cancel the job",
                  error instanceof Error ? error.message : undefined,
                );
              }
            }
          : undefined
      }
    />
  );
}
