import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  Archive,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileVideo,
  FolderOpen,
  PackageOpen,
  Play,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { api, triggerDownload } from "../api/client";
import type { ExportRecord } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { Toggle } from "../components/Toggle";
import { useDocumentTitle } from "../hooks/useJob";
import { formatBytes, formatDate, formatRelative, plural } from "../lib/format";
import { toast } from "../store/ui";

const SORTS = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "largest", label: "Largest first" },
  { value: "name", label: "Name A–Z" },
  { value: "project", label: "Project name" },
];

export function Exports() {
  useDocumentTitle("Exports");
  const [items, setItems] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [sort, setSort] = useState("recent");
  const [target, setTarget] = useState<ExportRecord | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [preview, setPreview] = useState<ExportRecord | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api.listAllExports(300);
      setItems(response.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Exports could not load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = items.filter((item) => {
      if (onlyMissing && item.file_exists) return false;
      if (!needle) return true;
      return (
        item.filename.toLowerCase().includes(needle) ||
        (item.project_name || "").toLowerCase().includes(needle) ||
        (item.clip_title || "").toLowerCase().includes(needle)
      );
    });
    return [...next].sort((a, b) => {
      if (sort === "oldest") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sort === "largest") return b.size_bytes - a.size_bytes;
      if (sort === "name") return a.filename.localeCompare(b.filename);
      if (sort === "project") {
        return (a.project_name || "").localeCompare(b.project_name || "");
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [items, query, onlyMissing, sort]);

  const totalBytes = items
    .filter((item) => item.file_exists)
    .reduce((sum, item) => sum + item.size_bytes, 0);
  const missingCount = items.filter((item) => !item.file_exists).length;

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.deleteExport(target.id, deleteFiles);
      toast.success(
        deleteFiles ? "Export deleted" : "Export removed from the list",
        deleteFiles ? "The video and ZIP were removed from local storage." : undefined,
      );
      setTarget(null);
      await load(true);
    } catch (caught) {
      toast.error("Could not delete", caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const openFolder = async () => {
    setOpening(true);
    try {
      await api.openFolder("exports");
    } catch (caught) {
      toast.error("Could not open the folder", caught instanceof Error ? caught.message : undefined);
    } finally {
      setOpening(false);
    }
  };

  const copyPath = async (item: ExportRecord) => {
    const path = item.path || item.file_url || item.filename;
    try {
      await navigator.clipboard.writeText(path);
      toast.success("Path copied");
    } catch {
      toast.error("Could not copy the path", path);
    }
  };

  return (
    <div>
      <PageHeader
        title="Exports"
        description="Every finished video and ZIP archive written by the studio. Files stay on this PC."
        actions={
          <>
            <button className="btn-secondary" onClick={openFolder} disabled={opening}>
              <FolderOpen size={15} />
              Open folder
            </button>
            <button className="btn-secondary" onClick={() => load()} disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
              Refresh
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="stat-card">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/[0.14] text-accent-300">
            <PackageOpen size={16} />
          </span>
          <div>
            <p className="text-[20px] font-semibold leading-6 tabular-nums text-white">{items.length}</p>
            <p className="text-[11px] text-slate-500">Export files</p>
          </div>
        </div>
        <div className="stat-card">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-mint-500/10 text-mint-400">
            <FileVideo size={16} />
          </span>
          <div>
            <p className="text-[20px] font-semibold leading-6 tabular-nums text-white">
              {formatBytes(totalBytes)}
            </p>
            <p className="text-[11px] text-slate-500">Stored on disk</p>
          </div>
        </div>
        <div className="stat-card">
          <span
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-lg",
              missingCount ? "bg-gold-400/10 text-gold-300" : "bg-white/[0.05] text-slate-300",
            )}
          >
            <TriangleAlert size={16} />
          </span>
          <div>
            <p className="text-[20px] font-semibold leading-6 tabular-nums text-white">{missingCount}</p>
            <p className="text-[11px] text-slate-500">Missing files</p>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="input pl-10"
            placeholder="Search filenames, projects or clip titles..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-white/[0.08] bg-base-925 px-3 text-[12px] text-slate-300">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(event) => setOnlyMissing(event.target.checked)}
              className="h-3.5 w-3.5 accent-accent-500"
            />
            Only missing files
          </label>
          <select
            className="select w-auto min-w-[150px] text-[13px]"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort exports"
          >
            {SORTS.map((option) => (
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
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-[70px]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title={items.length === 0 ? "Nothing exported yet" : "No exports match those filters"}
          description={
            items.length === 0
              ? "Open a project with clips and choose Export. Finished MP4s and ZIP archives will appear here."
              : "Try a different search term or turn off the missing-files filter."
          }
          action={
            items.length === 0 ? (
              <Link to="/projects" className="btn-primary">
                Browse projects
              </Link>
            ) : (
              <button
                className="btn-secondary"
                onClick={() => {
                  setQuery("");
                  setOnlyMissing(false);
                }}
              >
                Clear filters
              </button>
            )
          }
        />
      ) : (
        <div className="space-y-1.5">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="group flex flex-col gap-3 rounded-lg border border-white/[0.055] bg-base-850 px-3.5 py-3 transition hover:border-white/[0.11] sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className={clsx(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                    item.file_exists
                      ? "border-white/[0.06] bg-base-900 text-accent-300"
                      : "border-gold-400/20 bg-gold-400/[0.06] text-gold-300",
                  )}
                >
                  {item.zip_exists ? <FileArchive size={18} /> : <FileVideo size={18} />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-[13px] font-semibold text-slate-200" title={item.filename}>
                      {item.filename}
                    </p>
                    {!item.file_exists && (
                      <span className="badge-amber">file missing</span>
                    )}
                    {item.zip_exists && <span className="badge-neutral">ZIP</span>}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="truncate">{item.project_name || "Unknown project"}</span>
                    {item.clip_title && (
                      <>
                        <span>·</span>
                        <span className="max-w-[220px] truncate">{item.clip_title}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{formatBytes(item.size_bytes)}</span>
                    <span>·</span>
                    <span title={formatDate(item.created_at)}>{formatRelative(item.created_at)}</span>
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-0.5">
                {item.project_id && (
                  <Link
                    to={`/projects/${item.project_id}`}
                    className="btn-ghost btn-xs"
                    title="Open project"
                  >
                    <ExternalLink size={13} />
                  </Link>
                )}
                <button
                  className="btn-ghost btn-xs"
                  disabled={!item.file_exists}
                  onClick={() => setPreview(item)}
                  title="Preview video"
                >
                  <Play size={13} />
                </button>
                <button
                  className="btn-ghost btn-xs"
                  disabled={!item.file_exists}
                  onClick={() => triggerDownload(item.download_url || item.file_url || "")}
                  title="Download MP4"
                >
                  <Download size={13} />
                </button>
                {item.zip_exists && item.zip_url && (
                  <button
                    className="btn-ghost btn-xs"
                    onClick={() => triggerDownload(item.zip_url || "")}
                    title="Download ZIP"
                  >
                    <Archive size={13} />
                  </button>
                )}
                <button
                  className="btn-ghost btn-xs"
                  onClick={openFolder}
                  title="Reveal in exports folder"
                >
                  <FolderOpen size={13} />
                </button>
                <button
                  className="btn-ghost btn-xs"
                  onClick={() => copyPath(item)}
                  title="Copy file path"
                >
                  <Copy size={13} />
                </button>
                <button
                  className="btn-ghost btn-xs text-slate-500 hover:text-rose-300"
                  onClick={() => {
                    setDeleteFiles(!item.file_exists ? false : true);
                    setTarget(item);
                  }}
                  title="Delete export"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-500">
        {plural(filtered.length, "export")} shown. Files are stored under the studio’s local exports
        folder.
      </p>

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title="Delete export?"
        description={target?.filename}
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn-danger" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : deleteFiles ? "Delete files" : "Remove record"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-300">
            The export record will be removed from the library. Choose whether the video and ZIP
            should also be deleted from local storage.
          </p>
          <div className="panel-soft p-3.5">
            <Toggle
              checked={deleteFiles}
              onChange={setDeleteFiles}
              label="Also delete files from disk"
              description="This cannot be undone. Only files inside the studio’s exports folder are removed."
            />
          </div>
          {!target?.file_exists && (
            <p className="flex items-start gap-2 rounded-lg border border-gold-400/20 bg-gold-400/[0.06] px-3 py-2 text-[12px] leading-relaxed text-gold-300">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              The file is already missing from disk, so only the record can be removed.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.filename || "Preview"}
        description={
          preview
            ? `${preview.project_name || "Unknown project"}${preview.clip_title ? ` · ${preview.clip_title}` : ""}`
            : undefined
        }
        size="lg"
        footer={
          <>
            {preview?.project_id && (
              <Link to={`/projects/${preview.project_id}`} className="btn-secondary mr-auto">
                Open project
              </Link>
            )}
            <button
              className="btn-secondary"
              onClick={() => preview && triggerDownload(preview.download_url || preview.file_url || "")}
            >
              <Download size={14} />
              Download
            </button>
            <button className="btn-primary" onClick={() => setPreview(null)}>
              Done
            </button>
          </>
        }
      >
        {preview && (
          <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-black">
            <video
              key={preview.id}
              src={preview.file_url}
              controls
              autoPlay
              className="mx-auto max-h-[60vh] w-full"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
