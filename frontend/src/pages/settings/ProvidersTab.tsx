import { useState } from "react";
import clsx from "clsx";
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { api } from "../../api/client";
import type { AppSettings, ProviderSettings, SettingsResponse } from "../../api/types";
import { toast } from "../../store/ui";

const KEY_PROVIDERS = [
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Transcription, clip analysis and optional vision checks.",
    docs: "https://ai.google.dev/gemini-api/docs",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Very fast Whisper transcription and Llama analysis with generous rate limits.",
    docs: "https://console.groq.com/docs",
  },
  {
    id: "openai_compatible",
    name: "OpenAI-compatible",
    description: "Any local or self-hosted server that exposes /audio/transcriptions and /chat/completions.",
    docs: "",
  },
];

const SPEECH_MODEL_FIELD: Record<string, keyof ProviderSettings> = {
  gemini: "gemini_speech_model",
  groq: "groq_speech_model",
  local_whisper: "local_whisper_model",
  openai_compatible: "openai_compatible_speech_model",
};

const LLM_MODEL_FIELD: Record<string, keyof ProviderSettings> = {
  gemini: "gemini_llm_model",
  groq: "groq_llm_model",
  ollama: "ollama_model",
  openai_compatible: "openai_compatible_llm_model",
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={clsx("badge shrink-0", ok ? "badge-green" : "badge-amber")}>
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          ok ? "bg-mint-400" : "bg-gold-400",
        )}
      />
      {label}
    </span>
  );
}

export function ProvidersTab({
  data,
  draft,
  setDraft,
  onRefresh,
}: {
  data: SettingsResponse;
  draft: AppSettings;
  setDraft: (updater: (current: AppSettings) => AppSettings) => void;
  onRefresh: () => Promise<void>;
}) {
  const [keys, setKeys] = useState<Record<string, string>>({
    gemini: "",
    groq: "",
    openai_compatible: "",
  });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [keyBusy, setKeyBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const providers = draft.providers;

  const updateProviders = (partial: Partial<ProviderSettings>) =>
    setDraft((current) => ({
      ...current,
      providers: { ...current.providers, ...partial },
    }));

  const speechCatalog = data.providers.speech;
  const llmCatalog = data.providers.llm;
  const visionCatalog = data.providers.vision;
  const speechProvider = speechCatalog.find(
    (provider) => provider.id === providers.speech_provider,
  );
  const llmProvider = llmCatalog.find((provider) => provider.id === providers.llm_provider);

  const speechField = SPEECH_MODEL_FIELD[providers.speech_provider];
  const llmField = LLM_MODEL_FIELD[providers.llm_provider];
  const speechModel = speechField ? String(providers[speechField] ?? "") : "";
  const llmModel = llmField ? String(providers[llmField] ?? "") : "";

  const saveKey = async (providerId: string) => {
    const value = (keys[providerId] || "").trim();
    if (!value) {
      toast.warning("Enter an API key first");
      return;
    }
    setKeyBusy(providerId);
    try {
      await api.saveSecret(providerId, value);
      setKeys((current) => ({ ...current, [providerId]: "" }));
      await onRefresh();
      toast.success(
        "API key saved securely",
        "The key is encrypted with Windows DPAPI and never returned to the browser.",
      );
    } catch (caught) {
      toast.error("Could not save the key", caught instanceof Error ? caught.message : undefined);
    } finally {
      setKeyBusy(null);
    }
  };

  const clearKey = async (providerId: string) => {
    setKeyBusy(providerId);
    try {
      await api.deleteSecret(providerId);
      await onRefresh();
      toast.success("API key removed");
    } catch (caught) {
      toast.error("Could not remove the key", caught instanceof Error ? caught.message : undefined);
    } finally {
      setKeyBusy(null);
    }
  };

  const test = async (providerId: string, kind: "speech" | "llm" | "vision") => {
    const key = `${kind}:${providerId}`;
    setTesting(key);
    try {
      const result = await api.testProvider(providerId, kind);
      if (result.ok) {
        toast.success(
          "Provider is reachable",
          `${result.message}${result.latency_ms ? ` · ${result.latency_ms} ms` : ""}`,
        );
      } else {
        toast.error("Provider test failed", result.message);
      }
    } catch (caught) {
      toast.error("Provider test failed", caught instanceof Error ? caught.message : undefined);
    } finally {
      setTesting(null);
    }
  };

  const saveProviders = async () => {
    setSaving(true);
    try {
      await api.patchSettings({ providers });
      await onRefresh();
      toast.success("Provider settings saved");
    } catch (caught) {
      toast.error("Could not save providers", caught instanceof Error ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-white">
              <KeyRound size={16} className="text-accent-300" />
              API keys
            </h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-400">
              Keys are stored locally with Windows DPAPI encryption. They never appear in logs or
              API responses, and are only sent to the provider you select.
            </p>
          </div>
          <span className="badge-green shrink-0">
            <ShieldCheck size={11} />
            Local only
          </span>
        </div>

        <div className="grid gap-3 p-5 lg:grid-cols-3">
          {KEY_PROVIDERS.map((provider) => {
            const hasKey =
              provider.id === "gemini"
                ? data.secrets.gemini
                : provider.id === "groq"
                  ? data.secrets.groq
                  : data.secrets.openai_compatible;
            return (
              <div
                key={provider.id}
                className="flex flex-col rounded-lg border border-white/[0.055] bg-base-925/50 p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold text-slate-100">{provider.name}</p>
                  <StatusBadge ok={hasKey} label={hasKey ? "Key saved" : "No key"} />
                </div>
                <p className="mt-1 min-h-[32px] text-[11px] leading-relaxed text-slate-500">
                  {provider.description}
                </p>
                <div className="relative mt-2.5">
                  <input
                    className="input input-sm pr-9"
                    type={visible[provider.id] ? "text" : "password"}
                    placeholder={hasKey ? "Saved — enter to replace" : "Paste API key"}
                    value={keys[provider.id] || ""}
                    onChange={(event) =>
                      setKeys((current) => ({ ...current, [provider.id]: event.target.value }))
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
                    onClick={() =>
                      setVisible((current) => ({ ...current, [provider.id]: !current[provider.id] }))
                    }
                    aria-label={visible[provider.id] ? "Hide key" : "Show key"}
                  >
                    {visible[provider.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    className="btn-secondary btn-xs flex-1"
                    onClick={() => saveKey(provider.id)}
                    disabled={keyBusy === provider.id || !(keys[provider.id] || "").trim()}
                  >
                    {keyBusy === provider.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <ShieldCheck size={11} />
                    )}
                    Save key
                  </button>
                  <button
                    className="btn-ghost btn-xs text-slate-400 hover:text-rose-300"
                    onClick={() => clearKey(provider.id)}
                    disabled={keyBusy === provider.id || !hasKey}
                  >
                    Clear
                  </button>
                </div>
                {provider.docs && (
                  <a
                    href={provider.docs}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent-300 hover:text-accent-200"
                  >
                    Get a free key
                    <ExternalLink size={9} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="text-[16px] font-semibold text-white">Active providers</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
              Defaults for new imports. Individual projects can override them.
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <label className="label">Speech-to-text</label>
              <select
                className="select"
                value={providers.speech_provider}
                onChange={(event) => updateProviders({ speech_provider: event.target.value })}
              >
                {speechCatalog.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  className="input input-sm font-mono"
                  value={speechModel}
                  list="speech-models"
                  placeholder={speechProvider?.default_model || "Provider default"}
                  onChange={(event) => {
                    if (speechField) updateProviders({ [speechField]: event.target.value });
                  }}
                />
                <datalist id="speech-models">
                  {(speechProvider?.models || []).map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                <button
                  className="btn-secondary btn-xs shrink-0"
                  onClick={() => test(providers.speech_provider, "speech")}
                  disabled={testing === `speech:${providers.speech_provider}`}
                  title="Test this provider"
                >
                  {testing === `speech:${providers.speech_provider}` ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <PlugZap size={11} />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                {speechProvider?.free_tier}
              </p>
            </div>

            <div>
              <label className="label">Clip analysis</label>
              <select
                className="select"
                value={providers.llm_provider}
                onChange={(event) => updateProviders({ llm_provider: event.target.value })}
              >
                {llmCatalog.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  className="input input-sm font-mono"
                  value={llmModel}
                  list="llm-models"
                  placeholder={llmProvider?.default_model || "Provider default"}
                  onChange={(event) => {
                    if (llmField) updateProviders({ [llmField]: event.target.value });
                  }}
                  disabled={providers.llm_provider === "local"}
                />
                <datalist id="llm-models">
                  {(llmProvider?.models || []).map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                <button
                  className="btn-secondary btn-xs shrink-0"
                  onClick={() => test(providers.llm_provider, "llm")}
                  disabled={testing === `llm:${providers.llm_provider}`}
                  title="Test this provider"
                >
                  {testing === `llm:${providers.llm_provider}` ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <PlugZap size={11} />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                {llmProvider?.free_tier}
              </p>
            </div>

            <div>
              <label className="label">Visual analysis</label>
              <select
                className="select"
                value={providers.visual_provider}
                onChange={(event) => updateProviders({ visual_provider: event.target.value })}
              >
                {visionCatalog.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  className="input input-sm font-mono"
                  value={providers.gemini_vision_model}
                  placeholder="gemini-3.8-flash"
                  onChange={(event) =>
                    updateProviders({ gemini_vision_model: event.target.value })
                  }
                  disabled={providers.visual_provider !== "gemini"}
                />
                <button
                  className="btn-secondary btn-xs shrink-0"
                  onClick={() => test(providers.visual_provider, "vision")}
                  disabled={testing === `vision:${providers.visual_provider}`}
                  title="Test this provider"
                >
                  {testing === `vision:${providers.visual_provider}` ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <PlugZap size={11} />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Local mode detects scene cuts and faces on this PC. Gemini sends sampled frames to
                the cloud.
              </p>
            </div>
          </div>

          {providers.speech_provider === "local_whisper" && (
            <div className="mt-5 grid gap-3 border-t border-white/[0.06] pt-5 sm:grid-cols-3">
              <div>
                <label className="label">Whisper model</label>
                <input
                  className="input input-sm font-mono"
                  value={providers.local_whisper_model}
                  onChange={(event) => updateProviders({ local_whisper_model: event.target.value })}
                  placeholder="small"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                  tiny · base · small · medium · large-v3 (larger = slower, more accurate)
                </p>
              </div>
              <div>
                <label className="label">Device</label>
                <select
                  className="select"
                  value={providers.local_whisper_device}
                  onChange={(event) => updateProviders({ local_whisper_device: event.target.value })}
                >
                  <option value="auto">Auto</option>
                  <option value="cpu">CPU</option>
                  <option value="cuda">CUDA</option>
                </select>
              </div>
              <div>
                <label className="label">Compute type</label>
                <select
                  className="select"
                  value={providers.local_whisper_compute_type}
                  onChange={(event) =>
                    updateProviders({ local_whisper_compute_type: event.target.value })
                  }
                >
                  <option value="int8">int8</option>
                  <option value="float16">float16</option>
                  <option value="float32">float32</option>
                </select>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500 sm:col-span-3">
                Local Whisper is optional. Install it with{" "}
                <code className="rounded bg-white/[0.05] px-1 py-0.5 font-mono">
                  pip install faster-whisper
                </code>
                . Until then the provider reports that it is unavailable instead of pretending to
                run.
              </p>
            </div>
          )}

          {providers.llm_provider === "ollama" && (
            <div className="mt-5 grid gap-3 border-t border-white/[0.06] pt-5 sm:grid-cols-2">
              <div>
                <label className="label">Ollama base URL</label>
                <input
                  className="input input-sm font-mono"
                  value={providers.ollama_base_url}
                  onChange={(event) => updateProviders({ ollama_base_url: event.target.value })}
                />
              </div>
              <div>
                <label className="label">Ollama model</label>
                <input
                  className="input input-sm font-mono"
                  value={providers.ollama_model}
                  onChange={(event) => updateProviders({ ollama_model: event.target.value })}
                  placeholder="llama3.2"
                />
              </div>
            </div>
          )}

          {providers.speech_provider === "openai_compatible" ||
          providers.llm_provider === "openai_compatible" ? (
            <div className="mt-5 grid gap-3 border-t border-white/[0.06] pt-5 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <label className="label">OpenAI-compatible base URL</label>
                <input
                  className="input input-sm font-mono"
                  value={providers.openai_compatible_base_url}
                  onChange={(event) =>
                    updateProviders({ openai_compatible_base_url: event.target.value })
                  }
                  placeholder="http://127.0.0.1:8000/v1"
                />
              </div>
              <div>
                <label className="label">Speech model</label>
                <input
                  className="input input-sm font-mono"
                  value={providers.openai_compatible_speech_model}
                  onChange={(event) =>
                    updateProviders({ openai_compatible_speech_model: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">LLM model</label>
                <input
                  className="input input-sm font-mono"
                  value={providers.openai_compatible_llm_model}
                  onChange={(event) =>
                    updateProviders({ openai_compatible_llm_model: event.target.value })
                  }
                />
              </div>
              <div className="flex items-end">
                <p className="text-[11px] leading-relaxed text-slate-500">
                  The optional API key above is used as a bearer token.
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <ShieldCheck size={12} />
              Provider status is checked without exposing secrets.
            </p>
            <button className="btn-primary btn-sm" onClick={saveProviders} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save provider settings
            </button>
          </div>
        </div>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.018] px-4 py-3 text-[12px] leading-relaxed text-slate-400">
        {providers.llm_provider === "local" ? (
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-mint-400" />
        ) : (
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-gold-300" />
        )}
        Free tiers have real limits and can change. Rate-limit or quota errors appear in the job log
        instead of being silently retried forever. Switch to local heuristics or Ollama for fully
        offline operation.
      </div>
    </div>
  );
}
