import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  Ban,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { api } from "../api/client";
import type { Job, ProjectSummary } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { JobRow } from "../components/JobMonitor";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks/useJob";
import { JOB_KIND_LABELS } from "../lib/constants";
import { formatDate, statusLabel } from "../lib/format";
import { toast } from "../store/ui";

const STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const KINDS = [
  { value: "all", label: "All job types" },
  { value: "process", label: "Full pipeline" },
  { value: "analyze", label: "Analysis" },
  { value: "render_clip", label: "Clip render" },
  { value: "export", label: "Export" },
];

function StatPill({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Clock3;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <span className={clsx("flex h-8 w-8 items-center justify-center rounded-lg", tone)}>
        <Icon size={15} />
      </span>
      <div>
        <p className="text-[20px] font-semibold leading-6 tabular-nums text-white">{value}</p>
        <p className="text-[11px] text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function Jobs() {
  useDocumentTitle("Activity");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<Job | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [jobData, projectData] = await Promise.all([
        api.listJobs({ limit: 200 }),
        api.listProjects(200),
      ]);
      setJobs(jobData.items);
      setProjects(projectData.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Activity could not load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.name);
    return map;
  }, [projects]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (status !== "all" && job.status !== status) return false;
      if (kind !== "all" && job.kind !== kind) return false;
      if (!needle) return true;
      const projectName = job.project_id ? projectNames.get(job.project_id) || "" : "";
      return [job.kind, job.stage, job.message, job.error, job.id, projectName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [jobs, query, status, kind, projectNames]);

  const counts = useMemo(
    () => ({
      running: jobs.filter((job) => job.status === "running").length,
      queued: jobs.filter((job) => job.status === "queued").length,
      completed: jobs.filter((job) => job.status === "completed").length,
      failed: jobs.filter((job) => job.status === "failed").length,
    }),
    [jobs],
  );

  const cancel = async (job: Job) => {
    try {
      await api.cancelJob(job.id);
      toast.info("Cancellation requested", "The job will stop at the next safe checkpoint.");
      load(true);
    } catch (caught) {
      toast.error("Could not cancel the job", caught instanceof Error ? caught.message : undefined);
    }
  };

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Every transcription, analysis, render and export running on this machine."
        actions={
          <button className="btn-secondary" onClick={() => load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
            Refresh
          </button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatPill
          label="Running"
          value={counts.running}
          icon={Loader2}
          tone="bg-accent-500/[0.14] text-accent-300"
        />
        <StatPill
          label="Queued"
          value={counts.queued}
          icon={Clock3}
          tone="bg-white/[0.05] text-slate-300"
        />
        <StatPill
          label="Completed"
          value={counts.completed}
          icon={CheckCircle2}
          tone="bg-mint-500/10 text-mint-400"
        />
        <StatPill
          label="Failed"
          value={counts.failed}
          icon={XCircle}
          tone="bg-rose-500/10 text-rose-400"
        />
      </div>

      <div className="mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="input pl-10"
            placeholder="Search by project, stage or message..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="select w-auto min-w-[150px] text-[13px]"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter by status"
          >
            {STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="select w-auto min-w-[160px] text-[13px]"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            aria-label="Filter by job type"
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-4 py-3">
          <p className="flex items-center gap-2 text-[12px] text-rose-300">
            <TriangleAlert size={14} />
            {error}
          </p>
          <button className="btn-secondary btn-sm" onClick={() => load()}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-1.5">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="skeleton h-[66px]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Clock3}
          title={jobs.length === 0 ? "No activity yet" : "No jobs match those filters"}
          description={
            jobs.length === 0
              ? "Processing jobs will appear here with live progress and full logs."
              : "Try a different search, status or job type."
          }
          action={
            jobs.length > 0 ? (
              <button
                className="btn-secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setKind("all");
                }}
              >
                Clear filters
              </button>
            ) : (
              <Link to="/import" className="btn-primary">
                Import a video
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="mb-2.5 text-[12px] text-slate-500">
            Showing {filtered.length} of {jobs.length} recent jobs. Auto-refreshes every 5 seconds.
          </p>
          <div className="space-y-1.5">
            {filtered.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                showProject
                projectName={job.project_id ? projectNames.get(job.project_id) : null}
                onCancel={cancel}
                onSelect={setSelected}
              />
            ))}
          </div>
        </>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? JOB_KIND_LABELS[selected.kind] || selected.kind : "Job details"}
        description={selected ? `Job ${selected.id}` : undefined}
        size="md"
        footer={
          <>
            {selected?.project_id && (
              <Link
                to={`/projects/${selected.project_id}`}
                className="btn-secondary mr-auto"
                onClick={() => setSelected(null)}
              >
                Open project
              </Link>
            )}
            {selected && (selected.status === "running" || selected.status === "queued") && (
              <button
                className="btn-danger"
                onClick={() => {
                  cancel(selected);
                  setSelected(null);
                }}
              >
                <Ban size={14} />
                Cancel job
              </button>
            )}
            <button className="btn-secondary" onClick={() => setSelected(null)}>
              Close
            </button>
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid gap-2.5 sm:grid-cols-2">
              {[
                ["Status", statusLabel(selected.status)],
                ["Progress", `${Math.round(selected.progress)}%`],
                ["Project", selected.project_id ? projectNames.get(selected.project_id) || selected.project_id : "—"],
                ["Stage", selected.stage || "—"],
                ["Created", formatDate(selected.created_at)],
                ["Started", selected.started_at ? formatDate(selected.started_at) : "—"],
                ["Finished", selected.finished_at ? formatDate(selected.finished_at) : "—"],
                ["Cancellation", selected.cancel_requested ? "Requested" : "No"],
              ].map(([label, value]) => (
                <div key={label} className="panel-soft px-3 py-2.5">
                  <p className="text-[11px] text-slate-500">{label}</p>
                  <p className="mt-0.5 break-words text-[13px] text-slate-200">{value}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="label">Latest message</p>
              <p className="panel-inset px-3 py-2.5 text-[12px] leading-relaxed text-slate-300">
                {selected.message || "No message recorded."}
              </p>
            </div>

            {selected.error && (
              <div>
                <p className="label">Error details</p>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-rose-300">
                  {selected.error}
                </pre>
              </div>
            )}

            {selected.params && Object.keys(selected.params).length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-[12px] font-medium text-slate-400 hover:text-slate-200">
                  Job parameters
                </summary>
                <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-base-925 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-400">
                  {JSON.stringify(selected.params, null, 2)}
                </pre>
              </details>
            )}

            {selected.result && Object.keys(selected.result).length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-[12px] font-medium text-slate-400 hover:text-slate-200">
                  Job result
                </summary>
                <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-base-925 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-400">
                  {JSON.stringify(selected.result, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
