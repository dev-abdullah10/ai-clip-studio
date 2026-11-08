export interface Option {
  value: string;
  label: string;
  description?: string;
  ratio?: string;
}

export const ASPECT_RATIOS: Option[] = [
  { value: "9:16", label: "Vertical", description: "Reels · Shorts · TikTok", ratio: "9 / 16" },
  { value: "16:9", label: "Landscape", description: "YouTube · Web", ratio: "16 / 9" },
  { value: "1:1", label: "Square", description: "Feed posts", ratio: "1 / 1" },
  { value: "4:5", label: "Portrait", description: "Instagram feed", ratio: "4 / 5" },
  { value: "original", label: "Original", description: "Keep source framing", ratio: "auto" },
];

export const CROP_MODES: Option[] = [
  { value: "center", label: "Center", description: "Keep the middle of the frame" },
  { value: "face", label: "Face aware", description: "Follow the detected speaker" },
  { value: "smart", label: "Smart reframe", description: "Analyze and track the subject automatically" },
  { value: "motion", label: "Motion track", description: "Follow the main movement" },
  { value: "speaker", label: "Active speaker", description: "Prioritise the visible speaker" },
  { value: "gameplay", label: "Gameplay focus", description: "Preserve gameplay and HUD regions" },
  { value: "screen", label: "Screen focus", description: "Preserve text and interface regions" },
  { value: "fit", label: "Fit original", description: "Fit the full frame without destructive crop" },
  { value: "manual", label: "Manual", description: "Choose the subject position" },
  { value: "original", label: "Blurred pad", description: "Keep the full frame on a blurred background" },
];

export const RESOLUTIONS: Option[] = [
  { value: "480p", label: "480p", description: "Draft / fast" },
  { value: "720p", label: "720p", description: "Fast, clean" },
  { value: "1080p", label: "1080p", description: "Recommended" },
  { value: "2160p", label: "4K", description: "Maximum detail, slower" },
];

export const QUALITIES: Option[] = [
  { value: "draft", label: "Draft", description: "Fastest encoding" },
  { value: "standard", label: "Standard", description: "Balanced" },
  { value: "high", label: "High", description: "Recommended" },
  { value: "max", label: "Maximum", description: "Best quality, slowest" },
];

export const FPS_OPTIONS = [24, 25, 30, 50, 60];

export const DISCOVERY_MODES: Array<Option & { icon: string }> = [
  { value: "best", label: "Best overall", description: "Strongest stand-alone moments", icon: "sparkles" },
  { value: "interesting", label: "Interesting", description: "Surprising facts and ideas", icon: "lightbulb" },
  { value: "educational", label: "Educational", description: "Lessons and clear explanations", icon: "graduation-cap" },
  { value: "funny", label: "Funny", description: "Jokes, banter and punchlines", icon: "laugh" },
  { value: "surprising", label: "Surprising", description: "Unexpected reveals", icon: "zap" },
  { value: "motivational", label: "Motivational", description: "Inspiring, high-energy moments", icon: "flame" },
  { value: "important", label: "Important", description: "Key facts and warnings", icon: "alert-circle" },
  { value: "podcast", label: "Podcast", description: "Stories, hot takes, debate", icon: "mic" },
  { value: "interview", label: "Interview", description: "Revealing, quotable answers", icon: "message-square" },
  { value: "gaming", label: "Gaming", description: "Clutch plays and reactions", icon: "gamepad-2" },
  { value: "storytelling", label: "Storytelling", description: "Setup, conflict, payoff", icon: "book-open" },
  { value: "qa", label: "Q&A", description: "Complete question and answer", icon: "help-circle" },
  { value: "custom", label: "Custom", description: "Your own instructions", icon: "wand-2" },
];

export const SUBTITLE_POSITIONS: Option[] = [
  { value: "bottom", label: "Bottom" },
  { value: "center", label: "Center" },
  { value: "top", label: "Top" },
];

export const SUBTITLE_ANIMATIONS: Option[] = [
  { value: "none", label: "None" },
  { value: "pop", label: "Pop" },
  { value: "fade", label: "Fade" },
  { value: "slide", label: "Slide" },
];

export const SAMPLE_SUBTITLE_TEXT = "This is how your captions will look";

export const JOB_KIND_LABELS: Record<string, string> = {
  process: "Full pipeline",
  analyze: "Clip analysis",
  render_clip: "Clip render",
  export: "Project export",
};
