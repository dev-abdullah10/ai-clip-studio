import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FolderKanban,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";
import { api } from "../api/client";
import type { ProjectSummary } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { ConfirmDialog, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ProjectCard } from "../components/ProjectCard";
import { useDocumentTitle } from "../hooks/useJob";
import { plural } from "../lib/format";
import { toast } from "../store/ui";

const STATUS_FILTERS = [
  { value: "all", label: "All projects" },
  { value: "draft", label: "Draft" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "error", label: "Needs attention" },
];

const SORTS = [
  { value: "recent", label: "Recently updated" },
  { value: "created", label: "Recently created" },
  { value: "name", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "duration", label: "Longest first" },
  { value: "clips", label: "Most clips" },
];

export function Projects() {
  useDocumentTitle("Projects");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");

  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await api.listProjects(200);
      setProjects(data.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Projects could not load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let items = projects.filter((project) => {
      if (status !== "all" && project.status !== status) return false;
      if (!needle) return true;
      return (
        project.name.toLowerCase().includes(needle) ||
        (project.source_filename || "").toLowerCase().includes(needle) ||
        (project.language || "").toLowerCase().includes(needle)
      );
    });
    items = [...items].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "name_desc") return b.name.localeCompare(a.name);
      if (sort === "duration") return b.duration - a.duration;
      if (sort === "clips") return b.clip_count - a.clip_count;
      if (sort === "created") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return items;
  }, [projects, query, status, sort]);

  const openRename = (project: ProjectSummary) => {
    setRenameTarget(project);
    setRenameValue(project.name);
  };

  const rename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setDialogBusy(true);
    try {
      await api.updateProject(renameTarget.id, renameValue.trim());
      toast.success("Project renamed");
      setRenameTarget(null);
      await load(true);
    } catch (caught) {
      toast.error("Could not rename the project", caught instanceof Error ? caught.message : undefined);
    } finally {
      setDialogBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDialogBusy(true);
    try {
      await api.deleteProject(deleteTarget.id);
      toast.success("Project deleted", "Its local media files were removed.");
      setDeleteTarget(null);
      await load(true);
    } catch (caught) {
      toast.error("Could not delete the project", caught instanceof Error ? caught.message : undefined);
    } finally {
      setDialogBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Manage your videos, transcripts and AI-generated clips."
        actions={
          <>
            <button className="btn-secondary" onClick={() => load()} disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
              Refresh
            </button>
            <Link to="/import" className="btn-primary">
              <UploadCloud size={16} />
              Import Video
            </Link>
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="input pl-10"
            placeholder="Search projects or filenames..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="select w-auto min-w-[160px] text-[13px]"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter projects by status"
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="shrink-0 text-slate-500" />
            <select
              className="select w-auto min-w-[170px] text-[13px]"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort projects"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="skeleton h-[268px]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={projects.length === 0 ? "Your project library is empty." : "No projects match those filters"}
          description={
            projects.length === 0
              ? "Import a video and let AI discover its most interesting moments."
              : "Try a different search term or status filter."
          }
          action={
            projects.length === 0 ? (
              <Link to="/import" className="btn-primary">
                <UploadCloud size={16} />
                Import Video
              </Link>
            ) : (
              <button
                className="btn-secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                Clear filters
              </button>
            )
          }
        />
      ) : (
        <>
          <p className="mb-3 text-[12px] text-slate-500">
            {plural(filtered.length, "project")}
            {filtered.length !== projects.length && ` of ${projects.length}`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onRename={openRename}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        </>
      )}

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename project"
        description={
          renameTarget
            ? `Source video: ${renameTarget.source_filename || "Local video"}`
            : undefined
        }
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRenameTarget(null)} disabled={dialogBusy}>
              Cancel
            </button>
            <button className="btn-primary" onClick={rename} disabled={dialogBusy || !renameValue.trim()}>
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
            if (event.key === "Enter") rename();
          }}
          autoFocus
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this project?"
        message={`“${deleteTarget?.name || "This project"}” and all of its clips, rendered files and exports will be deleted from local storage. This cannot be undone.`}
        confirmLabel="Delete project"
        danger
        busy={dialogBusy}
        onConfirm={remove}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
