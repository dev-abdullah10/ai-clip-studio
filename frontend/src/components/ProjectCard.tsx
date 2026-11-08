import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clock3,
  Film,
  FolderOpen,
  Layers,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import type { ProjectSummary } from "../api/types";
import { formatDuration, formatRelative, plural } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

export function ProjectCard({
  project,
  onRename,
  onDelete,
}: {
  project: ProjectSummary;
  onRename?: (project: ProjectSummary) => void;
  onDelete?: (project: ProjectSummary) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-base-850 transition duration-200 hover:border-white/[0.13] hover:shadow-raised">
      <div className="absolute right-2.5 top-2.5 z-20" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-black/45 text-white/80 backdrop-blur transition hover:bg-black/65 hover:text-white"
          aria-label="Project actions"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-30 menu animate-fade-in">
            <Link to={`/projects/${project.id}`} className="menu-item" onClick={() => setMenuOpen(false)}>
              <FolderOpen size={14} />
              Open project
            </Link>
            {onRename && (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onRename(project);
                }}
              >
                <Pencil size={14} />
                Rename
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="menu-item menu-item-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(project);
                }}
              >
                <Trash2 size={14} />
                Delete project
              </button>
            )}
          </div>
        )}
      </div>

      <Link to={`/projects/${project.id}`} className="block">
        <div className="relative aspect-video overflow-hidden bg-base-800">
          {project.thumbnail_url ? (
            <img
              src={project.thumbnail_url}
              alt=""
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-600">
              <Film size={30} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
          <div className="absolute left-3 top-3">
            <StatusBadge status={project.status} />
          </div>
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur">
              <Clock3 size={10} />
              {formatDuration(project.duration)}
            </span>
            <span className="flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur">
              <Layers size={10} />
              {plural(project.clip_count, "clip")}
            </span>
          </div>
          <div className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
            <Play size={12} fill="currentColor" />
          </div>
        </div>

        <div className="p-4">
          <h3 className="truncate text-[15px] font-semibold text-white" title={project.name}>
            {project.name}
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-slate-500" title={project.source_filename || undefined}>
            {project.source_filename || "Local video"}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.05] pt-2.5 text-[11px] text-slate-500">
            <span>Updated {formatRelative(project.updated_at)}</span>
            {project.language && (
              <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-medium capitalize text-slate-400">
                {project.language}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
