import type {
  AnalysisSettings,
  AppSettings,
  Clip,
  ExportSettings,
  ProjectDetail,
  RenderSettings,
  SubtitleSettings,
} from "../api/types";

export const DEFAULT_SUBTITLE: SubtitleSettings = {
  preset: "bold_creator",
  font_family: "Arial",
  font_size: 70,
  font_weight: "bold",
  primary_color: "#FFFFFF",
  highlight_color: "#FFD400",
  outline_color: "#000000",
  outline_width: 4.5,
  shadow: 2,
  background_color: "#000000",
  background_opacity: 0,
  position: "bottom",
  alignment: "center",
  margin_v: 130,
  margin_h: 60,
  uppercase: true,
  highlight_words: true,
  max_words_per_line: 4,
  max_chars_per_line: 24,
  animation: "pop",
};

export const DEFAULT_RENDER: RenderSettings = {
  aspect_ratio: "9:16",
  resolution: "1080p",
  crop_mode: "center",
  crop_offset: 0.5,
  fps: 30,
  quality: "high",
  audio_normalize: true,
  fade: false,
  subtitles: true,
  subtitle_settings: DEFAULT_SUBTITLE,
  music_path: null,
  music_volume: 0.15,
  video_codec: "h264",
};

export const DEFAULT_EXPORT: ExportSettings = {
  ...DEFAULT_RENDER,
  filename_pattern: "{project}_Clip_{index:02d}",
  create_zip: true,
  output_format: "mp4",
};

export function renderSettingsForClip(clip: Clip, base?: Partial<RenderSettings>): RenderSettings {
  return {
    ...DEFAULT_RENDER,
    aspect_ratio: clip.aspect_ratio || DEFAULT_RENDER.aspect_ratio,
    crop_mode: clip.crop_mode || DEFAULT_RENDER.crop_mode,
    crop_offset: clip.crop_offset ?? 0.5,
    subtitles: clip.subtitle_enabled,
    subtitle_settings: clip.subtitle_settings || DEFAULT_SUBTITLE,
    ...base,
  };
}

export function exportSettingsFor(
  clip: Clip | undefined,
  base?: Partial<ExportSettings>,
): ExportSettings {
  return {
    ...DEFAULT_EXPORT,
    ...(clip
      ? {
          aspect_ratio: clip.aspect_ratio,
          crop_mode: clip.crop_mode,
          crop_offset: clip.crop_offset,
          subtitles: clip.subtitle_enabled,
          subtitle_settings: clip.subtitle_settings || DEFAULT_SUBTITLE,
        }
      : {}),
    ...base,
  };
}

export function analysisSettingsFor(
  project: ProjectDetail | null | undefined,
  appSettings: AppSettings | null | undefined,
): AnalysisSettings {
  const saved = project?.analysis_settings;
  const providers = appSettings?.providers;
  const video = appSettings?.video;
  return {
    discovery_mode: saved?.discovery_mode || "best",
    custom_instructions: saved?.custom_instructions || "",
    clip_count: saved?.clip_count ?? video?.clip_count ?? 5,
    min_duration: saved?.min_duration ?? video?.min_duration ?? 20,
    max_duration: saved?.max_duration ?? video?.max_duration ?? 60,
    speech_provider: saved?.speech_provider || providers?.speech_provider || "gemini",
    speech_model: saved?.speech_model ?? null,
    llm_provider: saved?.llm_provider || providers?.llm_provider || "gemini",
    llm_model: saved?.llm_model ?? null,
    language: saved?.language || "auto",
    visual_analysis: saved?.visual_analysis ?? appSettings?.visual_analysis_default ?? false,
    use_faces: saved?.use_faces ?? true,
    allow_llm_fallback: saved?.allow_llm_fallback ?? true,
    scoring_weights:
      saved?.scoring_weights ||
      ({
        interesting: 0.2,
        hook: 0.2,
        standalone: 0.2,
        value: 0.15,
        emotion: 0.1,
        payoff: 0.1,
        clarity: 0.05,
      } as Record<string, number>),
  };
}
