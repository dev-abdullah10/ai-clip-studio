import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  ArrowRight,
  Film,
  FolderKanban,
  Layers,
  PackageOpen,
  Plus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  UploadCloud,
  Wand2,
} from "lucide-react";
import { api } from "../api/client";
import type { DashboardData, Job } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { JobProgress } from "../components/JobMonitor";
import { PageHeader } from "../components/PageHeader";
import { ProjectCard } from "../components/ProjectCard";
import { useDocumentTitle } from "../hooks/useJob";
import { toast } from "../store/ui";

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Film;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-[22px] font-semibold leading-7 tabular-nums text-white">{value}</p>
        <p className="truncate text-[12px] font-medium text-slate-300">{label}</p>
        <p className="truncate text-[11px] text-slate-500">{hint}</p>
      </div>
    </div>
  );
}

export function Dashboard() {
  useDocumentTitle("Dashboard");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await api.dashboard();
      setData(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The dashboard could not load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await load();
    };
    run();
    const timer = window.setInterval(run, 7000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [load]);

  const cancel = async (job: Job) => {
    try {
      await api.cancelJob(job.id);
      toast.info("Cancellation requested", "The job will stop at the next safe checkpoint.");
      load();
    } catch (caught) {
      toast.error("Could not cancel", caught instanceof Error ? caught.message : undefined);
    }
  };

  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Preparing your local studio…" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-[86px]" />
          ))}
        </div>
        <div className="mt-6 skeleton h-80" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="panel flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
            <TriangleAlert size={20} />
          </div>
          <h2 className="text-[15px] font-semibold text-white">The studio backend is not responding</h2>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-400">{error}</p>
          <p className="mt-2 max-w-md text-[12px] leading-relaxed text-slate-500">
            Start it with <code className="rounded bg-white/5 px-1.5 py-0.5">start.bat</code> (or{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5">python run.py</code>) and try again.
          </p>
          <button className="btn-primary mt-5" onClick={load}>
            <RefreshCw size={15} />
            Retry connection
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { counts, recent_projects, active_jobs } = data;
  const empty = counts.projects === 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Your creative workspace. Manage videos, discover moments and create clips."
        actions={
          <>
            <Link to="/projects" className="btn-secondary">
              <FolderKanban size={16} />
              Projects
            </Link>
            <Link to="/import" className="btn-primary">
              <UploadCloud size={16} />
              Import Video
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Projects"
          value={counts.projects}
          hint="Videos in your library"
          icon={FolderKanban}
          tone="bg-accent-500/[0.14] text-accent-300"
        />
        <StatCard
          label="Clips Found"
          value={counts.clips}
          hint="AI-selected moments"
          icon={Layers}
          tone="bg-gold-400/10 text-gold-300"
        />
        <StatCard
          label="Rendered"
          value={counts.rendered_clips}
          hint="Finished clip videos"
          icon={Film}
          tone="bg-mint-500/10 text-mint-400"
        />
        <StatCard
          label="Exports"
          value={counts.exports}
          hint="Files written to disk"
          icon={PackageOpen}
          tone="bg-white/[0.05] text-slate-300"
        />
      </div>

      {active_jobs.length > 0 && (
        <section className="mt-6">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-white">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-400" />
              </span>
              Working now
            </h2>
            <Link to="/jobs" className="text-[12px] font-medium text-slate-400 transition hover:text-white">
              Activity centre
            </Link>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {active_jobs.map((job) => (
              <JobProgress key={job.id} job={job} onCancel={() => cancel(job)} />
            ))}
          </div>
        </section>
      )}

      {empty && (
        <section className="mt-6 rounded-xl border border-white/[0.06] bg-base-850 p-6 sm:p-8">
          <div className="max-w-2xl">
            <span className="badge-violet mb-3">
              <Sparkles size={11} />
              Start in three steps
            </span>
            <h2 className="text-balance text-[22px] font-semibold tracking-[-0.01em] text-white">
              Your first clip is a few minutes away
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
              Import a podcast, interview, stream or tutorial. AI Clip Studio transcribes it,
              finds the strongest standalone moments, reframes them, captions them and exports
              ready-to-post videos.
            </p>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
              {[
                { icon: UploadCloud, title: "1. Import", body: "Drop a video file or use a direct URL." },
                { icon: Wand2, title: "2. Analyze", body: "Transcribe and score every moment." },
                { icon: PackageOpen, title: "3. Export", body: "Reframe, caption, render and download." },
              ].map((step) => (
                <div key={step.title} className="rounded-lg border border-white/[0.055] bg-white/[0.018] p-3.5">
                  <step.icon size={16} className="text-accent-300" />
                  <p className="mt-2 text-[12px] font-semibold text-white">{step.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{step.body}</p>
                </div>
              ))}
            </div>
            <Link to="/import" className="btn-primary mt-5">
              <Plus size={16} />
              Import your first video
            </Link>
          </div>
        </section>
      )}

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Recent Projects</h2>
          <Link
            to="/projects"
            className="flex items-center gap-1 text-[12px] font-medium text-slate-400 transition hover:text-white"
          >
            View All
            <ArrowRight size={12} />
          </Link>
        </div>
        {recent_projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Import a source video to start clipping."
            compact
            action={
              <Link to="/import" className="btn-primary btn-sm">
                <UploadCloud size={14} />
                Import Video
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {recent_projects.slice(0, 6).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
