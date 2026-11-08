export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobKind = "process" | "analyze" | "render_clip" | "export";

export interface Job {
  id: string;
  project_id: string | null;
  kind: JobKind;
  status: JobStatus;
  stage: string | null;
  progress: number;
  message: string;
  error: string | null;
  params: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  source_filename: string | null;
  source_url: string | null;
  source_exists: boolean;
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_audio: boolean;
  video_codec: string | null;
  audio_codec: string | null;
  file_size: number | null;
  thumbnail_url: string | null;
  status: string;
  error: string | null;
  language: string | null;
  has_transcript: boolean;
  analysis_settings: Partial<AnalysisSettings> | null;
  analysis: AnalysisSummary | null;
  clip_count: number;
  rendered_clip_count: number;
  created_at: string;
  updated_at: string;
  active_job?: boolean;
}

export interface AnalysisSummary {
  created_at: string;
  used_llm: boolean;
  provider: string | null;
  model: string | null;
  chunk_count: number;
  warnings: string[];
  discovery_mode: string;
  candidates: Array<{
    start: number;
    end: number;
    title: string;
    score: number;
    llm_score: number | null;
    local_score: number;
    components: Record<string, number>;
    source: string;
  }>;
}

export interface TranscriptMeta {
  language: string | null;
  provider: string;
  model: string | null;
  segment_count: number;
  word_count: number;
  duration: number;
  speakers: string[];
  text: string;
}

export interface SubtitleSettings {
  preset: string;
  font_family: string;
  font_size: number;
  font_weight: string;
  primary_color: string;
  highlight_color: string;
  outline_color: string;
  outline_width: number;
  shadow: number;
  background_color: string;
  background_opacity: number;
  position: "bottom" | "center" | "top";
  alignment: "left" | "center" | "right";
  margin_v: number;
  margin_h: number;
  uppercase: boolean;
  highlight_words: boolean;
  max_words_per_line: number;
  max_chars_per_line: number;
  animation: "none" | "pop" | "fade" | "slide";
}

export interface Clip {
  id: string;
  project_id: string;
  order_index: number;
  title: string;
  description: string;
  reason: string;
  hook: string;
  category: string;
  score: number;
  start: number;
  end: number;
  duration: number;
  transcript_text: string;
  speaker: string | null;
  aspect_ratio: string;
  crop_mode: string;
  crop_offset: number;
  crop_confidence: number | null;
  subtitle_enabled: boolean;
  subtitle_settings: SubtitleSettings | null;
  render_status: "none" | "ready" | "rendering" | "failed" | "stale" | string;
  has_render: boolean;
  render_url: string | null;
  thumbnail_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  clips: Clip[];
  transcript_meta: TranscriptMeta | null;
  jobs: Job[];
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  words: Array<{ start: number; end: number; word: string; speaker: string | null }>;
}

export interface Transcript {
  language: string | null;
  provider: string;
  model: string | null;
  duration: number;
  speakers: string[];
  word_count: number;
  text: string;
  segments: TranscriptSegment[];
}

export interface CueWord {
  start: number;
  end: number;
  word: string;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
  words: CueWord[];
}

export interface SubtitlePreview {
  cues: Cue[];
  settings: SubtitleSettings;
  target_width: number;
  target_height: number;
  clip_duration: number;
  enabled?: boolean;
}

export interface AnalysisSettings {
  discovery_mode: string;
  custom_instructions: string;
  clip_count: number;
  min_duration: number;
  max_duration: number;
  speech_provider: string;
  speech_model: string | null;
  llm_provider: string;
  llm_model: string | null;
  language: string;
  visual_analysis: boolean;
  use_faces: boolean;
  allow_llm_fallback: boolean;
  scoring_weights: Record<string, number>;
}

export interface RenderSettings {
  aspect_ratio: string;
  resolution: string;
  crop_mode: string;
  crop_offset: number;
  fps: number;
  quality: string;
  audio_normalize: boolean;
  fade: boolean;
  subtitles: boolean;
  subtitle_settings: SubtitleSettings;
  music_path: string | null;
  music_volume: number;
  video_codec: string;
  reframe_plan?: Record<string, unknown> | null;
}

export interface ExportSettings extends RenderSettings {
  filename_pattern: string;
  create_zip: boolean;
  output_format: string;
}

export interface VideoDefaults {
  aspect_ratio: string;
  resolution: string;
  fps: number;
  quality: string;
  clip_count: number;
  min_duration: number;
  max_duration: number;
}

export interface PerformanceSettings {
  max_concurrent_jobs: number;
  prefer_gpu_encoding: boolean;
  ffmpeg_threads: number;
}

export interface ProviderSettings {
  speech_provider: string;
  llm_provider: string;
  gemini_speech_model: string;
  gemini_llm_model: string;
  groq_speech_model: string;
  groq_llm_model: string;
  local_whisper_model: string;
  local_whisper_device: string;
  local_whisper_compute_type: string;
  ollama_base_url: string;
  ollama_model: string;
  openai_compatible_base_url: string;
  openai_compatible_speech_model: string;
  openai_compatible_llm_model: string;
  visual_provider: string;
  gemini_vision_model: string;
}

export interface AppSettings {
  theme: string;
  language: string;
  startup_behavior: string;
  default_export_dir: string;
  visual_analysis_default: boolean;
  video: VideoDefaults;
  subtitles: SubtitleSettings;
  performance: PerformanceSettings;
  providers: ProviderSettings;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "speech" | "llm" | "vision";
  description: string;
  requires_key: boolean;
  free_tier: string;
  default_model: string;
  models: string[];
  docs_url: string;
  capabilities: Record<string, unknown>;
  has_key: boolean;
  configured: boolean;
}

export interface ProviderCatalog {
  speech: ProviderInfo[];
  llm: ProviderInfo[];
  vision: ProviderInfo[];
  active: {
    speech_provider: string;
    llm_provider: string;
    visual_provider: string;
    speech_model: string;
    llm_model: string;
  };
}

export interface ProviderStatus {
  id: string;
  kind: string;
  name: string;
  active: boolean;
  configured: boolean;
  model: string;
  note: string;
}

export interface SubtitlePreset extends Partial<SubtitleSettings> {
  label: string;
}

export interface SettingsResponse {
  settings: AppSettings;
  providers: ProviderCatalog;
  statuses: ProviderStatus[];
  secrets: Record<string, boolean>;
  subtitle_presets: Record<string, SubtitlePreset>;
  fonts: Array<{ name: string; available: boolean; files: string[] }>;
  tools: {
    ffmpeg_available: boolean;
    ffmpeg_version: string | null;
    ass: boolean;
    nvenc: boolean;
    ffprobe_available: boolean;
  };
  limits: { max_upload_mb: number; max_url_download_mb: number };
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latency_ms: number | null;
  models: string[];
  details: Record<string, unknown>;
}

export interface SystemInfo {
  version: string;
  platform: string;
  python: string;
  host: string;
  port: number;
  storage_dir: string;
  database_path: string;
  database_bytes: number;
  media: {
    source_bytes: number;
    clip_bytes: number;
    export_bytes: number;
    app_bytes: number;
  };
  disk: { total: number; used: number; free: number; percent_used: number } | null;
  ffmpeg: {
    available: boolean;
    path: string;
    version: string | null;
    ass: boolean;
    drawtext: boolean;
    nvenc: boolean;
  };
  ffprobe: { available: boolean; path: string; version: string | null };
  max_upload_mb: number;
  temp_retention_days: number;
}

export interface DashboardData {
  counts: { projects: number; clips: number; rendered_clips: number; exports: number };
  recent_projects: ProjectSummary[];
  active_jobs: Job[];
  recent_jobs: Job[];
  providers: ProviderStatus[];
  tools: {
    ffmpeg: boolean;
    ffprobe: boolean;
    ass: boolean;
    nvenc: boolean;
    ffmpeg_version: string | null;
  };
  storage: { path: string; free_bytes: number; total_bytes: number };
}

export interface ExportRecord {
  id: string;
  job_id?: string | null;
  project_id?: string;
  project_name?: string;
  clip_id: string | null;
  clip_title?: string | null;
  filename: string;
  path?: string;
  size_bytes: number;
  zip_path?: string | null;
  file_exists: boolean;
  zip_exists: boolean;
  download_url?: string;
  file_url?: string;
  zip_url?: string | null;
  created_at: string;
}

export interface FaceAnalysis {
  offset_x: number;
  offset_y: number;
  confidence: number;
  frames_checked: number;
  frames_with_face: number;
  detected: boolean;
}

export interface ApiEnvelope<T> {
  items: T[];
  total: number;
}
