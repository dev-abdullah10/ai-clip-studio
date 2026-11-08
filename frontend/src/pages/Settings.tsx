import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  Cpu,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { api } from "../api/client";
import type { AppSettings, SettingsResponse, SystemInfo } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { formatBytes, formatDate } from "../lib/format";
import { toast } from "../store/ui";
import { DefaultsTab } from "./settings/DefaultsTab";
import { ProvidersTab } from "./settings/ProvidersTab";

const TABS = [
  { id: "providers", label: "AI Providers", icon: Sparkles },
  { id: "defaults", label: "Processing Defaults", icon: Settings2 },
  { id: "system", label: "System", icon: Cpu },
] as const;

type TabId = (typeof TABS)[number]["id"];

function ToolCard({
  label,
  ok,
  detail,
  hint,
}: {
  label: string;
  ok: boolean;
  detail: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.055] bg-white/[0.018] p-3.5">
      <span
        className={clsx(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          ok ? "bg-mint-500/10 text-mint-400" : "bg-rose-500/10 text-rose-400",
        )}
      >
        {ok ? <Cpu size={15} /> : <TriangleAlert size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[13px] font-medium text-slate-200">{label}</p>
          <span className={clsx("badge shrink-0", ok ? "badge-green" : "badge-rose")}>
            {ok ? "Ready" : "Missing"}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500" title={detail}>
          {detail}
        </p>
        {hint && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

function SystemTab({ data, onRefresh }: { data: SettingsResponse; onRefresh: () => Promise<void> }) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logPath, setLogPath] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [checked, setChecked] = useState<{
    ffmpeg: Record<string, unknown>;
    ffprobe: Record<string, unknown>;
  } | null>(null);

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await api.systemInfo());
    } catch (error) {
      toast.error("Could not read system information", (error as Error).message);
    }
  }, []);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error("That action failed", (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const readyCount = [
    data.tools.ffmpeg_available,
    data.tools.ffprobe_available,
    data.tools.ass,
    data.tools.nvenc,
  ].filter(Boolean).length;
  const ffmpegDetail = data.tools.ffmpeg_version
    ? data.tools.ffmpeg_version
        .replace(/^ffmpeg version\s+/i, "")
        .split(" Copyright")[0]
        .trim()
    : "Not detected";

  return (
    <div className="space-y-5">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="text-[16px] font-semibold text-white">Runtime &amp; tools</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-400">
              Everything runs on this PC. Files never leave the machine unless a cloud provider is
              selected for audio or analysis.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={clsx("badge", readyCount === 4 ? "badge-green" : "badge-amber")}>
              {readyCount} / 4 ready
            </span>
            <button
              className="btn-secondary btn-sm"
              onClick={() => run("refresh", onRefresh)}
              disabled={busy === "refresh"}
            >
              {busy === "refresh" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Refresh
            </button>
          </div>
        </div>
        <div className="p-5">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ToolCard
              label="FFmpeg"
              ok={data.tools.ffmpeg_available}
              detail={ffmpegDetail}
              hint="Video decoding, encoding and audio extraction."
            />
            <ToolCard
              label="FFprobe"
              ok={data.tools.ffprobe_available}
              detail={info?.ffprobe.path || "Not detected"}
              hint="Reads duration, codecs and stream metadata."
            />
            <ToolCard
              label="ASS subtitles (libass)"
              ok={data.tools.ass}
              detail="Required for burned-in captions"
              hint="Without it, subtitles cannot be rendered into clips."
            />
            <ToolCard
              label="NVIDIA NVENC"
              ok={data.tools.nvenc}
              detail={data.tools.nvenc ? "GPU encoding available" : "Falls back to libx264"}
              hint="GPU encoding is faster but optional."
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="btn-secondary btn-sm"
              disabled={busy === "check"}
              onClick={() =>
                run("check", async () => {
                  const result = await api.checkFfmpeg();
                  setChecked(result);
                  const ok =
                    Boolean((result.ffmpeg as { available?: boolean }).available) &&
                    Boolean((result.ffprobe as { available?: boolean }).available);
                  if (ok) toast.success("FFmpeg and FFprobe are ready");
                  else toast.error("FFmpeg check failed", "One or more binaries are unavailable.");
                  await loadInfo();
                })
              }
            >
              {busy === "check" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Cpu size={13} />
              )}
              Re-check FFmpeg
            </button>
            <button
              className="btn-secondary btn-sm"
              disabled={busy === "cleanup"}
              onClick={() =>
                run("cleanup", async () => {
                  const result = await api.cleanupTemp();
                  toast.success(
                    "Temporary files cleaned",
                    `${result.removed} file${result.removed === 1 ? "" : "s"} removed, ${formatBytes(result.freed_bytes)} freed.`,
                  );
                  await loadInfo();
                })
              }
            >
              {busy === "cleanup" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Trash2 size={13} />
              )}
              Clean temp files
            </button>
          </div>

          {checked && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] font-medium text-slate-400 hover:text-slate-200">
                Raw FFmpeg check result
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-white/[0.06] bg-base-925 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
                {JSON.stringify(checked, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="text-[16px] font-semibold text-white">Storage</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
              Media is stored on disk; project metadata lives in the local SQLite database.
            </p>
          </div>
        </div>
        <div className="space-y-3 p-5">
          {info ? (
            <>
              <div className="panel-soft px-3.5 py-3">
                <p className="text-[11px] font-medium text-slate-500">Storage directory</p>
                <p className="mt-1 break-all font-mono text-[12px] text-slate-300">
                  {info.storage_dir}
                </p>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Source videos", formatBytes(info.media.source_bytes)],
                  ["Rendered clips", formatBytes(info.media.clip_bytes)],
                  ["Exports", formatBytes(info.media.export_bytes)],
                  ["Database", formatBytes(info.database_bytes)],
                ].map(([label, value]) => (
                  <div key={label} className="panel-soft px-3.5 py-3">
                    <p className="text-[11px] text-slate-500">{label}</p>
                    <p className="mt-1 text-[15px] font-semibold text-slate-100">{value}</p>
                  </div>
                ))}
              </div>
              {info.disk && (
                <div className="panel-soft px-3.5 py-3">
                  <div className="flex items-center justify-between text-[12px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <HardDrive size={13} /> {formatBytes(info.disk.free)} free of{" "}
                      {formatBytes(info.disk.total)}
                    </span>
                    <span className="tabular-nums">{Math.round(info.disk.percent_used)}% used</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className={clsx(
                        "h-full rounded-full",
                        info.disk.percent_used > 92
                          ? "bg-rose-400"
                          : info.disk.percent_used > 78
                            ? "bg-gold-400"
                            : "bg-accent-500",
                      )}
                      style={{ width: `${Math.min(100, info.disk.percent_used)}%` }}
                    />
                  </div>
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-slate-500">
                Temp files older than {info.temp_retention_days} days are eligible for cleanup. App
                version {info.version} · Python {info.python}
              </p>
            </>
          ) : (
            <div className="skeleton h-28" />
          )}

          <div className="flex flex-wrap gap-1.5">
            {(["storage", "uploads", "clips", "exports", "logs"] as const).map((target) => (
              <button
                key={target}
                className="btn-secondary btn-sm capitalize"
                onClick={() =>
                  run(`open-${target}`, async () => {
                    const result = await api.openFolder(target);
                    if (!result.opened) {
                      toast.warning("Could not open that folder", result.path);
                    }
                  })
                }
                disabled={busy === `open-${target}`}
              >
                <FolderOpen size={13} />
                {target}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="text-[16px] font-semibold text-white">Logs</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
              Keys and tokens are redacted before they reach this log.
            </p>
          </div>
          <button
            className="btn-secondary btn-sm shrink-0"
            disabled={busy === "logs"}
            onClick={() =>
              run("logs", async () => {
                const result = await api.logs(200);
                setLogPath(result.path);
                setLogLines(result.lines);
              })
            }
          >
            {busy === "logs" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <FileText size={13} />
            )}
            Load recent log
          </button>
        </div>
        <div className="p-5">
          {logPath && (
            <p className="mb-2 break-all font-mono text-[11px] text-slate-500">{logPath}</p>
          )}
          <pre className="max-h-72 overflow-auto rounded-lg border border-white/[0.06] bg-base-925 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
            {logLines.length > 0 ? logLines.join("\n") : "No log lines loaded yet."}
          </pre>
        </div>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.018] px-4 py-3 text-[12px] leading-relaxed text-slate-400">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-mint-400" />
        API keys are stored with Windows DPAPI protection and only ever read by the local backend.
        They are never sent to the browser.
      </div>
    </div>
  );
}

export function Settings() {
  const [tab, setTab] = useState<TabId>("providers");
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraftState] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getSettings();
      setData(response);
      setDraftState(response.settings);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setDraft = useCallback((updater: (current: AppSettings) => AppSettings) => {
    setDraftState((current) => (current ? updater(current) : current));
  }, []);

  const refresh = useCallback(async () => {
    await load();
    toast.info("Settings reloaded");
  }, [load]);

  return (
    <div>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Choose free or local AI providers, set studio defaults, and inspect the local runtime."
        actions={
          savedAt ? (
            <span className="text-[11px] text-slate-500">Loaded {formatDate(savedAt)}</span>
          ) : null
        }
      />

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              className={clsx(
                "relative flex shrink-0 items-center gap-2 px-3.5 pb-3 pt-1 text-[13px] font-medium transition",
                active ? "text-white" : "text-slate-400 hover:text-slate-200",
              )}
              onClick={() => setTab(entry.id)}
            >
              <Icon size={15} className={active ? "text-accent-300" : "text-slate-500"} />
              {entry.label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-500" />
              )}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <div className="space-y-3">
          <div className="skeleton h-36" />
          <div className="skeleton h-64" />
        </div>
      ) : error && !data ? (
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <TriangleAlert size={24} className="text-gold-300" />
          <p className="text-sm font-semibold text-white">Settings could not be loaded</p>
          <p className="max-w-md text-[12px] leading-relaxed text-slate-400">{error}</p>
          <button className="btn-primary btn-sm mt-2" onClick={load}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : data && draft ? (
        tab === "providers" ? (
          <ProvidersTab data={data} draft={draft} setDraft={setDraft} onRefresh={refresh} />
        ) : tab === "defaults" ? (
          <DefaultsTab data={data} draft={draft} setDraft={setDraft} onRefresh={refresh} />
        ) : (
          <SystemTab data={data} onRefresh={refresh} />
        )
      ) : null}
    </div>
  );
}
