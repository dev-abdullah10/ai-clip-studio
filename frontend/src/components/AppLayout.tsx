import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import clsx from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Cpu,
  FolderKanban,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Menu,
  PackageOpen,
  Settings,
  UploadCloud,
} from "lucide-react";
import { api } from "../api/client";
import type { SystemInfo } from "../api/types";
import { formatBytes } from "../lib/format";
import { useUiStore } from "../store/ui";

const NAV = [
  {
    group: "Studio",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/projects", label: "Projects", icon: FolderKanban },
      { to: "/import", label: "Import Video", icon: UploadCloud },
    ],
  },
  {
    group: "Library",
    items: [
      { to: "/jobs", label: "Activity", icon: ListChecks },
      { to: "/exports", label: "Exports", icon: PackageOpen },
    ],
  },
  {
    group: "System",
    items: [{ to: "/settings", label: "Settings", icon: Settings }],
  },
];

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {ok && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-400 opacity-30" />
      )}
      <span
        className={clsx(
          "relative inline-flex h-2 w-2 rounded-full",
          ok ? "bg-mint-400" : "bg-rose-400",
        )}
      />
    </span>
  );
}

function SidebarContent({
  collapsed = false,
  onNavigate,
  onToggleCollapse,
  isMobile = false,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
  isMobile?: boolean;
}) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [healthy, setHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [system, health] = await Promise.all([
          api.systemInfo(),
          fetch("/api/health").then((response) => response.json()),
        ]);
        if (!active) return;
        setInfo(system);
        setHealthy(Boolean(health?.database_ok && health?.ffmpeg_available));
      } catch {
        if (active) setHealthy(false);
      }
    };
    load();
    const timer = window.setInterval(load, 45_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const usedPercent =
    info?.disk && info.disk.total > 0
      ? Math.min(100, (info.disk.used / info.disk.total) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col">
      <div
        className={clsx(
          "flex items-center gap-2.5",
          collapsed ? "justify-center px-2 py-5" : "px-4 py-5",
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-500 text-white shadow-sm">
          <Clapperboard size={18} />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold tracking-tight text-white">
              AI Clip Studio
            </p>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
              Local Studio
            </p>
          </div>
        )}
        {!isMobile && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={clsx(
              "flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200",
              collapsed && "mt-1",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        )}
      </div>

      <nav
        className={clsx(
          "flex-1 overflow-y-auto pb-2 no-scrollbar",
          collapsed ? "px-2" : "px-2.5",
        )}
      >
        {NAV.map((section) => (
          <div key={section.group} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                {section.group}
              </p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-white/[0.07]" />
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      "nav-item group",
                      isActive && "nav-item-active",
                      collapsed && "justify-center px-2",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        size={17}
                        className={clsx(
                          "shrink-0 transition",
                          isActive
                            ? "text-accent-300"
                            : "text-slate-500 group-hover:text-slate-300",
                        )}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && isActive && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent-400" />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={clsx("border-t border-white/[0.055]", collapsed ? "p-2" : "p-3")}>
        {collapsed ? (
          <NavLink
            to="/settings"
            onClick={onNavigate}
            className="flex flex-col items-center gap-2 rounded-lg px-2 py-2.5 text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-100"
            title={
              healthy === null
                ? "Connecting to studio"
                : healthy
                  ? "Studio ready · open settings"
                  : "Backend offline · open settings"
            }
          >
            <StatusDot ok={healthy === true} />
            <Cpu size={15} />
          </NavLink>
        ) : (
          <>
            <div className="rounded-lg border border-white/[0.055] bg-white/[0.018] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-slate-300">
                  <StatusDot ok={healthy === true} />
                  <span className="truncate">
                    {healthy === null ? "Connecting…" : healthy ? "Studio ready" : "Studio not ready"}
                  </span>
                </div>
                <LinkSettings />
              </div>
              {info?.ffmpeg && (
                <p
                  className="mt-1 truncate text-[11px] text-slate-500"
                  title={info.ffmpeg.path}
                >
                  {info.ffmpeg.available
                    ? `FFmpeg ${info.ffmpeg.version?.split(" ").slice(2, 3).join(" ") || "ready"}`
                    : "FFmpeg not found"}
                </p>
              )}
              {info?.disk && (
                <div className="mt-2.5">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <HardDrive size={10} />
                      {formatBytes(info.disk.free)} free
                    </span>
                    <span className="tabular-nums">{Math.round(usedPercent)}% used</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className={clsx(
                        "h-full rounded-full",
                        usedPercent > 92
                          ? "bg-rose-400"
                          : usedPercent > 78
                            ? "bg-gold-400"
                            : "bg-accent-400",
                      )}
                      style={{ width: `${usedPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            <p className="mt-2 px-1 text-center text-[11px] leading-relaxed text-slate-600">
              Runs on your PC. Nothing is uploaded except audio for cloud transcription.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function LinkSettings() {
  return (
    <NavLink
      to="/settings"
      className="rounded p-0.5 text-slate-500 transition hover:text-slate-200"
      aria-label="Open system settings"
      title="System settings"
    >
      <Settings size={13} />
    </NavLink>
  );
}

export function AppLayout() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("acs.sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  const toggleCollapse = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("acs.sidebarCollapsed", next ? "1" : "0");
      } catch {
        /* local preference is best-effort */
      }
      return next;
    });
  };

  return (
    <div className="min-h-full bg-base-950">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-white/[0.055] bg-base-900 transition-[width] duration-200 lg:block",
          collapsed ? "w-[72px]" : "w-[236px]",
        )}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-[280px] border-r border-white/10 bg-base-900 shadow-2xl animate-slide-in">
            <SidebarContent isMobile onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      <div className={clsx("transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[236px]")}>
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/[0.055] bg-base-950/90 px-4 backdrop-blur lg:hidden">
          <button
            className="rounded-md p-2 text-slate-300 transition hover:bg-white/[0.06]"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-500">
              <Clapperboard size={15} />
            </div>
            <span className="text-sm font-semibold">AI Clip Studio</span>
          </div>
          <NavLink to="/import" className="rounded-md p-2 text-accent-300" aria-label="Import video">
            <UploadCloud size={20} />
          </NavLink>
        </header>
        <main className="mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
