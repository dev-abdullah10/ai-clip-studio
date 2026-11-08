import type {
  AnalysisSettings,
  AppSettings,
  Clip,
  DashboardData,
  ExportRecord,
  ExportSettings,
  FaceAnalysis,
  Job,
  ProjectDetail,
  ProjectSummary,
  ProviderTestResult,
  RenderSettings,
  SettingsResponse,
  SubtitlePreview,
  SystemInfo,
  Transcript,
} from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(message: string, status = 0, code = "request_failed", details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError(
      "The local backend is not reachable. Make sure start.bat is running.",
      0,
      "network_error",
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      (response.status === 404
        ? "That item could not be found."
        : `Request failed with status ${response.status}.`);
    throw new ApiError(message, response.status, payload?.error?.code, payload?.error?.details);
  }
  return payload as T;
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  dashboard: () => request<DashboardData>("/api/dashboard"),

  listProjects: (limit = 100, offset = 0) =>
    request<{ items: ProjectSummary[]; total: number }>(
      `/api/projects${query({ limit, offset })}`,
    ),
  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  updateProject: (id: string, name: string) =>
    request<ProjectSummary>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteProject: (id: string) =>
    request<{ deleted: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  importUrl: (url: string, name?: string) =>
    request<ProjectDetail>("/api/projects/url", {
      method: "POST",
      body: JSON.stringify({ url, name: name || null }),
    }),
  updateAnalysisSettings: (id: string, analysis: AnalysisSettings) =>
    request<{ analysis_settings: AnalysisSettings }>(`/api/projects/${id}/analysis-settings`, {
      method: "PATCH",
      body: JSON.stringify(analysis),
    }),
  processProject: (
    id: string,
    analysis: AnalysisSettings,
    reuseTranscript: boolean,
    forceTranscribe = false,
  ) =>
    request<Job>(`/api/projects/${id}/process`, {
      method: "POST",
      body: JSON.stringify({
        analysis,
        reuse_transcript: reuseTranscript,
        force_transcribe: forceTranscribe,
      }),
    }),
  analyzeProject: (id: string, analysis: AnalysisSettings, replace = true) =>
    request<Job>(`/api/projects/${id}/analyze`, {
      method: "POST",
      body: JSON.stringify({ analysis, replace }),
    }),
  getTranscript: (id: string) => request<Transcript>(`/api/projects/${id}/transcript`),
  importTranscript: (id: string, text: string, language?: string) =>
    request<{ imported: boolean; segments: number; language: string | null; word_count: number }>(
      `/api/projects/${id}/transcript`,
      {
        method: "POST",
        body: JSON.stringify({ text, language: language || null }),
      },
    ),
  transcriptDownloadUrl: (id: string, format: "srt" | "vtt" | "json") =>
    `/api/projects/${id}/transcript/download?format=${format}`,

  getClip: (id: string) => request<Clip>(`/api/clips/${id}`),
  updateClip: (id: string, payload: Record<string, unknown>) =>
    request<Clip>(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  duplicateClip: (id: string) =>
    request<Clip>(`/api/clips/${id}/duplicate`, { method: "POST" }),
  deleteClip: (id: string) =>
    request<{ deleted: boolean }>(`/api/clips/${id}`, { method: "DELETE" }),
  detectFaces: (id: string) =>
    request<{ analysis: FaceAnalysis; clip: Clip }>(`/api/clips/${id}/faces`, {
      method: "POST",
    }),
  analyzeReframe: (
    id: string,
    payload: { mode?: string; smoothing?: number; sample_fps?: number; target_aspect?: string } = {},
  ) =>
    request<{
      clip_id: string;
      plan: Record<string, unknown>;
      source_width: number;
      source_height: number;
    }>(`/api/clips/${id}/reframe/analyze`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  subtitlePreview: (id: string) => request<SubtitlePreview>(`/api/clips/${id}/subtitles`),
  subtitleDownloadUrl: (id: string, format: "ass" | "srt" | "vtt") =>
    `/api/clips/${id}/subtitles/download?format=${format}`,
  renderClip: (id: string, settings: RenderSettings) =>
    request<Job>(`/api/clips/${id}/render`, {
      method: "POST",
      body: JSON.stringify({ settings }),
    }),
  regenerateClipThumbnail: (id: string) =>
    request<{ clip: Clip }>(`/api/clips/${id}/thumbnail`, { method: "POST" }),

  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  listJobs: (params: { project_id?: string; status?: string; limit?: number } = {}) =>
    request<{ items: Job[]; total: number }>(`/api/jobs${query(params)}`),
  cancelJob: (id: string) =>
    request<{ id: string; status: string }>(`/api/jobs/${id}/cancel`, { method: "POST" }),

  exportProject: (
    projectId: string,
    clipIds: string[],
    settings: ExportSettings,
    useClipSubtitles = true,
  ) =>
    request<Job>(`/api/projects/${projectId}/export`, {
      method: "POST",
      body: JSON.stringify({
        clip_ids: clipIds,
        settings,
        use_clip_subtitles: useClipSubtitles,
      }),
    }),
  listExports: (projectId: string) =>
    request<{ items: ExportRecord[]; total: number }>(`/api/projects/${projectId}/exports`),
  listAllExports: (limit = 200) =>
    request<{ items: ExportRecord[]; total: number }>(`/api/exports${query({ limit })}`),
  deleteExport: (id: string, deleteFiles: boolean) =>
    request<{ deleted: boolean; files_deleted: boolean }>(
      `/api/exports/${id}${query({ delete_files: deleteFiles })}`,
      { method: "DELETE" },
    ),

  getSettings: () => request<SettingsResponse>("/api/settings"),
  patchSettings: (payload: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  saveSecret: (providerId: string, apiKey: string) =>
    request<{ has_key: boolean }>(`/api/settings/secrets/${providerId}`, {
      method: "PUT",
      body: JSON.stringify({ api_key: apiKey }),
    }),
  deleteSecret: (providerId: string) =>
    request<{ has_key: boolean }>(`/api/settings/secrets/${providerId}`, {
      method: "DELETE",
    }),
  testProvider: (providerId: string, kind: "speech" | "llm" | "vision") =>
    request<ProviderTestResult>("/api/settings/providers/test", {
      method: "POST",
      body: JSON.stringify({ provider_id: providerId, kind }),
    }),
  providerModels: (providerId: string, kind: "speech" | "llm" | "vision") =>
    request<{ models: string[] }>(
      `/api/settings/providers/${providerId}/models${query({ kind })}`,
    ),

  systemInfo: () => request<SystemInfo>("/api/system/info"),
  logs: (lines = 250) =>
    request<{ path: string; lines: string[]; text: string }>(
      `/api/system/logs${query({ lines })}`,
    ),
  cleanupTemp: () =>
    request<{ removed: number; freed_bytes: number }>("/api/system/cleanup-temp", {
      method: "POST",
    }),
  openFolder: (target: "storage" | "logs" | "exports" | "clips" | "uploads") =>
    request<{ opened: boolean; path: string }>("/api/system/open-folder", {
      method: "POST",
      body: JSON.stringify({ target }),
    }),
  checkFfmpeg: () =>
    request<{ ffmpeg: Record<string, unknown>; ffprobe: Record<string, unknown> }>(
      "/api/system/check-ffmpeg",
      { method: "POST" },
    ),
};

export function uploadProject(
  file: File,
  name: string,
  onProgress: (percent: number) => void,
): Promise<ProjectDetail> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/projects/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onerror = () =>
      reject(new ApiError("The upload failed. Check that the backend is running.", 0));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ProjectDetail);
      } else {
        const payload: any = xhr.response;
        reject(
          new ApiError(
            payload?.error?.message || `Upload failed with status ${xhr.status}.`,
            xhr.status,
            payload?.error?.code,
          ),
        );
      }
    };
    const form = new FormData();
    form.append("file", file);
    if (name.trim()) form.append("name", name.trim());
    xhr.send(form);
  });
}

export function absoluteUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return path;
}

export function triggerDownload(path: string) {
  const link = document.createElement("a");
  link.href = path;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
