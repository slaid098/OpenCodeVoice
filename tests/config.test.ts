import { describe, expect, it } from "vitest";
import {
  CONFIG_KEY,
  DEFAULT_CLEANUP_PROMPT,
  LLM_PRESETS,
  STT_PRESETS,
  applyLlmPreset,
  applySttPreset,
  createDefaultConfig,
  getCleanupPrompt,
  isFirstRun,
  loadConfig,
  registerMenuCommands,
  saveConfig,
  validateConfig,
} from "../src/config.js";
import type { AppConfig, LlmProviderId, SttProviderId } from "../src/types.js";
import {
  GM_getValue,
  GM_setValue,
  __getMenuCommands,
  __getMockStore,
} from "./__mocks__/$/index.js";

function storedConfig(): AppConfig {
  const raw = GM_getValue(CONFIG_KEY, "");
  expect(typeof raw).toBe("string");
  return JSON.parse(String(raw)) as AppConfig;
}

function validConfig(): AppConfig {
  const config = createDefaultConfig();
  config.stt.apiKey = "stt-key";
  config.llm.apiKey = "llm-key";
  return config;
}

describe("defaults and presets", () => {
  it("creates the documented default config", () => {
    const config = createDefaultConfig();
    expect(config).toEqual({
      schemaVersion: 2,
      stt: {
        provider: "groq",
        endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
        apiKey: "",
        model: "whisper-large-v3-turbo",
        language: "",
        prompt: "",
        temperature: 0,
      },
      llm: {
        enabled: true,
        provider: "ollama-cloud",
        baseUrl: "https://ollama.com",
        apiKey: "",
        model: "deepseek-v4.1-flash",
        reasoning: false,
        prompt: DEFAULT_CLEANUP_PROMPT,
      },
      behavior: {
        autoSubmit: true,
        autoSubmitQuestion: false,
        fallbackToRaw: true,
        saveFailedAudio: true,
        maxRecordingSeconds: 120,
      },
      retry: {
        maxAttempts: 3,
        baseDelayMs: 800,
        maxDelayMs: 8000,
      },
    });
  });

  it("returns independent objects", () => {
    const first = createDefaultConfig();
    const second = createDefaultConfig();
    first.stt.apiKey = "changed";
    first.llm.enabled = false;
    expect(second.stt.apiKey).toBe("");
    expect(second.llm.enabled).toBe(true);
    expect(first).not.toBe(second);
  });

  it("ships a Russian cleanup prompt with all eight rules", () => {
    expect(DEFAULT_CLEANUP_PROMPT).toContain("редактор русской расшифровки");
    for (let rule = 1; rule <= 8; rule += 1) {
      expect(DEFAULT_CLEANUP_PROMPT).toContain(`${rule}.`);
    }
    expect(DEFAULT_CLEANUP_PROMPT).toContain("Не переводи текст");
  });

  it("defines STT and LLM presets", () => {
    expect(STT_PRESETS.groq.model).toBe("whisper-large-v3-turbo");
    expect(STT_PRESETS.openai.model).toBe("whisper-1");
    expect(STT_PRESETS.custom).toEqual({ endpoint: "", model: "" });
    expect(LLM_PRESETS["ollama-cloud"]).toEqual({
      baseUrl: "https://ollama.com",
      model: "deepseek-v4.1-flash",
    });
    expect(LLM_PRESETS["ollama-local"].baseUrl).toBe("http://127.0.0.1:11434");
    expect(LLM_PRESETS["custom-openai"].model).toBe("gpt-4o-mini");
  });
});

describe("loadConfig", () => {
  it("returns defaults when storage is empty", () => {
    expect(loadConfig()).toEqual(createDefaultConfig());
  });

  it("reads and normalizes a stored config", () => {
    const stored = validConfig();
    stored.stt.language = "ru";
    stored.llm.reasoning = true;
    GM_setValue(CONFIG_KEY, JSON.stringify(stored));

    const loaded = loadConfig();
    expect(loaded.stt.apiKey).toBe("stt-key");
    expect(loaded.stt.language).toBe("ru");
    expect(loaded.llm.reasoning).toBe(true);
  });

  it("falls back to defaults for invalid JSON", () => {
    GM_setValue(CONFIG_KEY, "{not json");
    expect(loadConfig()).toEqual(createDefaultConfig());
  });

  it("falls back to defaults for non-string storage values", () => {
    GM_setValue(CONFIG_KEY, 42);
    expect(loadConfig()).toEqual(createDefaultConfig());
  });

  it("treats whitespace-only storage as empty", () => {
    GM_setValue(CONFIG_KEY, "   ");
    expect(loadConfig()).toEqual(createDefaultConfig());
  });

  it("normalizes every section independently", () => {
    GM_setValue(
      CONFIG_KEY,
      JSON.stringify({
        stt: {
          provider: "openai",
          endpoint: "https://api.openai.com/v1/audio/transcriptions",
          apiKey: 42,
          model: "",
          temperature: 7,
        },
        llm: {
          provider: "nope",
          enabled: "yes",
          baseUrl: 123,
          model: null,
        },
        behavior: { autoSubmit: false, maxRecordingSeconds: 1_000 },
        retry: { maxAttempts: 99, baseDelayMs: 1, maxDelayMs: 100_000 },
      }),
    );

    const config = loadConfig();
    expect(config.stt.provider).toBe("openai");
    expect(config.stt.apiKey).toBe("");
    expect(config.stt.model).toBe("");
    expect(config.stt.temperature).toBe(1);
    expect(config.llm.provider).toBe("ollama-cloud");
    expect(config.llm.enabled).toBe(true);
    expect(config.llm.baseUrl).toBe("https://ollama.com");
    expect(config.llm.model).toBe("deepseek-v4.1-flash");
    expect(config.behavior.autoSubmit).toBe(false);
    expect(config.behavior.maxRecordingSeconds).toBe(600);
    expect(config.retry.maxAttempts).toBe(5);
    expect(config.retry.baseDelayMs).toBe(100);
    expect(config.retry.maxDelayMs).toBe(60_000);
  });

  it("keeps a custom cleanup prompt untouched", () => {
    const config = validConfig();
    config.llm.prompt = "  Мой промпт\n";
    GM_setValue(CONFIG_KEY, JSON.stringify(config));
    expect(loadConfig().llm.prompt).toBe("  Мой промпт\n");
  });

  it("ignores non-object section values", () => {
    GM_setValue(CONFIG_KEY, JSON.stringify({ stt: null, llm: "x", behavior: [], retry: 1 }));
    const config = loadConfig();
    expect(config.stt).toEqual(createDefaultConfig().stt);
    expect(config.llm).toEqual(createDefaultConfig().llm);
    expect(config.behavior).toEqual(createDefaultConfig().behavior);
    expect(config.retry).toEqual(createDefaultConfig().retry);
  });

  it("ignores unknown fields and forces schemaVersion 2", () => {
    GM_setValue(
      CONFIG_KEY,
      JSON.stringify({ schemaVersion: 1, extra: true, stt: { provider: "groq" } }),
    );
    const config = loadConfig();
    expect(config.schemaVersion).toBe(2);
    expect(config).not.toHaveProperty("extra");
  });
});

describe("legacy migration", () => {
  it("migrates the old flat Groq settings", () => {
    GM_setValue("groqApiKey", "gsk_legacy");
    GM_setValue("model", "whisper-large-v3");
    GM_setValue("language", "ru");
    GM_setValue("whisperPrompt", "OpenCode");
    GM_setValue("temperature", 0.4);
    GM_setValue("autoSubmit", false);

    const config = loadConfig();
    expect(config.stt).toMatchObject({
      provider: "groq",
      endpoint: STT_PRESETS.groq.endpoint,
      apiKey: "gsk_legacy",
      model: "whisper-large-v3",
      language: "ru",
      prompt: "OpenCode",
      temperature: 0.4,
    });
    expect(config.behavior.autoSubmit).toBe(false);
    expect(storedConfig().stt.apiKey).toBe("gsk_legacy");
  });

  it("detects the OpenAI provider from the legacy endpoint", () => {
    GM_setValue("endpoint", "https://api.openai.com/v1/audio/transcriptions");
    const config = loadConfig();
    expect(config.stt.provider).toBe("openai");
    expect(config.stt.endpoint).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(config.stt.model).toBe("whisper-1");
  });

  it("treats an unknown endpoint as a custom provider", () => {
    GM_setValue("endpoint", "https://proxy.example.com/v1/audio/transcriptions");
    const config = loadConfig();
    expect(config.stt.provider).toBe("custom");
    expect(config.stt.endpoint).toBe("https://proxy.example.com/v1/audio/transcriptions");
  });

  it("keeps a custom legacy model and endpoint", () => {
    GM_setValue("groqApiKey", "gsk_legacy");
    GM_setValue("model", "my-whisper");
    GM_setValue("endpoint", "https://proxy.example.com/transcribe");
    const config = loadConfig();
    expect(config.stt.provider).toBe("custom");
    expect(config.stt.model).toBe("my-whisper");
    expect(config.stt.endpoint).toBe("https://proxy.example.com/transcribe");
  });

  it("clamps legacy values and ignores bad types", () => {
    GM_setValue("groqApiKey", "gsk_legacy");
    GM_setValue("temperature", 3);
    GM_setValue("language", 5);
    GM_setValue("autoSubmit", "yes");

    const config = loadConfig();
    expect(config.stt.temperature).toBe(1);
    expect(config.stt.language).toBe("");
    expect(config.behavior.autoSubmit).toBe(true);
  });

  it("does not migrate without legacy keys", () => {
    loadConfig();
    expect(__getMockStore()).not.toHaveProperty(CONFIG_KEY);
  });

  it("prefers a stored v2 config over legacy keys", () => {
    GM_setValue(CONFIG_KEY, JSON.stringify(validConfig()));
    GM_setValue("groqApiKey", "legacy-key");
    expect(loadConfig().stt.apiKey).toBe("stt-key");
  });
});

describe("saveConfig", () => {
  it("stores a single JSON value", () => {
    const config = validConfig();
    saveConfig(config);
    expect(GM_getValue(CONFIG_KEY, "")).toBe(JSON.stringify(config));
    expect(Object.keys(__getMockStore())).toEqual([CONFIG_KEY]);
  });

  it("round-trips through loadConfig", () => {
    const config = validConfig();
    config.stt.language = "en";
    config.behavior.autoSubmitQuestion = true;
    saveConfig(config);
    expect(loadConfig()).toEqual(config);
  });
});

describe("isFirstRun", () => {
  it("is true without an STT key for a hosted provider", () => {
    expect(isFirstRun()).toBe(true);
    expect(isFirstRun(createDefaultConfig())).toBe(true);
  });

  it("is false once an STT key is present", () => {
    const config = createDefaultConfig();
    config.stt.apiKey = "key";
    expect(isFirstRun(config)).toBe(false);
  });

  it("is false for a custom endpoint without a key", () => {
    const config = createDefaultConfig();
    config.stt.provider = "custom";
    config.stt.endpoint = "https://proxy.example.com/transcribe";
    expect(isFirstRun(config)).toBe(false);
  });

  it("does not consider the LLM key", () => {
    const config = createDefaultConfig();
    config.llm.apiKey = "llm-key";
    expect(isFirstRun(config)).toBe(true);
  });
});

describe("getCleanupPrompt", () => {
  it("returns the custom prompt verbatim", () => {
    const config = createDefaultConfig();
    config.llm.prompt = "Свой промпт";
    expect(getCleanupPrompt(config)).toBe("Свой промпт");
  });

  it("falls back to the default for blank prompts", () => {
    const config = createDefaultConfig();
    config.llm.prompt = "   \n ";
    expect(getCleanupPrompt(config)).toBe(DEFAULT_CLEANUP_PROMPT);
  });
});

describe("provider presets", () => {
  it("applies STT presets without mutating the input", () => {
    const config = createDefaultConfig();
    const openai = applySttPreset(config.stt, "openai");
    expect(openai.endpoint).toBe(STT_PRESETS.openai.endpoint);
    expect(openai.model).toBe("whisper-1");
    expect(config.stt.model).toBe("whisper-large-v3-turbo");

    const groq = applySttPreset(openai, "groq");
    expect(groq.endpoint).toBe(STT_PRESETS.groq.endpoint);
    expect(groq.model).toBe("whisper-large-v3-turbo");
  });

  it("keeps the endpoint and model when switching to custom STT", () => {
    const config = createDefaultConfig();
    config.stt.endpoint = "https://proxy.example.com/transcribe";
    config.stt.model = "my-model";
    const custom = applySttPreset(config.stt, "custom");
    expect(custom.provider).toBe("custom");
    expect(custom.endpoint).toBe("https://proxy.example.com/transcribe");
    expect(custom.model).toBe("my-model");
  });

  it("applies LLM presets", () => {
    const config = createDefaultConfig();
    const local = applyLlmPreset(config.llm, "ollama-local");
    expect(local.baseUrl).toBe("http://127.0.0.1:11434");
    expect(local.model).toBe("deepseek-v4.1-flash");

    const openai = applyLlmPreset(local, "custom-openai");
    expect(openai.baseUrl).toBe("https://api.openai.com");
    expect(openai.model).toBe("gpt-4o-mini");

    const cloud = applyLlmPreset(openai, "ollama-cloud");
    expect(cloud.baseUrl).toBe("https://ollama.com");
    expect(cloud.model).toBe("deepseek-v4.1-flash");
  });

  it("preserves a custom OpenAI endpoint when staying custom", () => {
    const config = createDefaultConfig();
    config.llm.provider = "custom-openai";
    config.llm.baseUrl = "https://example.com/v1";
    config.llm.model = "my-model";
    const next = applyLlmPreset(config.llm, "custom-openai");
    expect(next.baseUrl).toBe("https://example.com/v1");
    expect(next.model).toBe("my-model");
  });

  it("resets a custom OpenAI endpoint after switching away and back", () => {
    const config = createDefaultConfig();
    config.llm.provider = "custom-openai";
    config.llm.baseUrl = "https://example.com/v1";
    config.llm.model = "my-model";
    const cloud = applyLlmPreset(config.llm, "ollama-cloud");
    const back = applyLlmPreset(cloud, "custom-openai");
    expect(back.baseUrl).toBe("https://api.openai.com");
    expect(back.model).toBe("gpt-4o-mini");
  });
});

describe("validateConfig", () => {
  it("accepts a complete config", () => {
    expect(validateConfig(validConfig())).toEqual([]);
  });

  it("allows a custom STT provider without a key", () => {
    const config = validConfig();
    config.stt.provider = "custom";
    config.stt.apiKey = "";
    config.stt.endpoint = "https://proxy.example.com/transcribe";
    expect(validateConfig(config)).toEqual([]);
  });

  it("allows a disabled cloud LLM without a key", () => {
    const config = validConfig();
    config.llm.enabled = false;
    config.llm.apiKey = "";
    expect(validateConfig(config)).toEqual([]);
  });

  it("reports an unknown STT provider", () => {
    const config = validConfig();
    config.stt.provider = "nope" as unknown as SttProviderId;
    expect(validateConfig(config)).toContain("Неизвестный STT-провайдер");
  });

  it.each(["", "not a url", "ftp://example.com/file"])(
    "rejects the STT endpoint %j",
    (endpoint) => {
      const config = validConfig();
      config.stt.endpoint = endpoint;
      expect(validateConfig(config)).toContain("STT endpoint должен быть корректным http(s) URL");
    },
  );

  it("requires an STT model", () => {
    const config = validConfig();
    config.stt.model = "  ";
    expect(validateConfig(config)).toContain("Укажите модель STT");
  });

  it("requires an STT key for hosted providers", () => {
    const config = validConfig();
    config.stt.apiKey = " ";
    expect(validateConfig(config)).toContain("Укажите API-ключ STT");
  });

  it.each([Number.NaN, -0.1, 1.1, Number.POSITIVE_INFINITY])(
    "rejects temperature %d",
    (temperature) => {
      const config = validConfig();
      config.stt.temperature = temperature;
      expect(validateConfig(config)).toContain("Temperature должна быть от 0 до 1");
    },
  );

  it("reports an unknown LLM provider", () => {
    const config = validConfig();
    config.llm.provider = "nope" as unknown as LlmProviderId;
    expect(validateConfig(config)).toContain("Неизвестный LLM-провайдер");
  });

  it.each(["", "not a url", "file:///tmp/config"])("rejects the LLM base URL %j", (baseUrl) => {
    const config = validConfig();
    config.llm.baseUrl = baseUrl;
    expect(validateConfig(config)).toContain("LLM Base URL должен быть корректным http(s) URL");
  });

  it("requires an LLM model", () => {
    const config = validConfig();
    config.llm.model = "";
    expect(validateConfig(config)).toContain("Укажите модель очистки");
  });

  it("requires an Ollama Cloud key when cleanup is enabled", () => {
    const config = validConfig();
    config.llm.apiKey = "";
    expect(validateConfig(config)).toContain("Для Ollama Cloud нужен API-ключ");
  });

  it.each([Number.NaN, 4, 601])("rejects max recording seconds %d", (seconds) => {
    const config = validConfig();
    config.behavior.maxRecordingSeconds = seconds;
    expect(validateConfig(config)).toContain(
      "Максимальная длительность записи должна быть от 5 до 600 секунд",
    );
  });

  it.each([0, 6, Number.NaN])("rejects retry attempts %d", (attempts) => {
    const config = validConfig();
    config.retry.maxAttempts = attempts;
    expect(validateConfig(config)).toContain("Количество попыток должно быть от 1 до 5");
  });

  it("collects every error at once", () => {
    const config = createDefaultConfig();
    config.stt.provider = "nope" as unknown as SttProviderId;
    config.stt.endpoint = "x";
    config.stt.model = "";
    config.llm.provider = "nope" as unknown as LlmProviderId;
    config.llm.baseUrl = "x";
    config.llm.model = "";
    config.behavior.maxRecordingSeconds = 1;
    config.retry.maxAttempts = 0;
    const errors = validateConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(9);
    expect(errors).toContain("Укажите API-ключ STT");
    expect(errors).toContain("Неизвестный LLM-провайдер");
  });
});

describe("registerMenuCommands", () => {
  it("registers four commands and wires their callbacks", () => {
    const calls: string[] = [];
    registerMenuCommands({
      onSettings: () => calls.push("settings"),
      onToggleAutoSubmit: () => calls.push("toggle"),
      onRetryLast: () => calls.push("retry"),
      onClearFailures: () => calls.push("clear"),
    });

    const commands = __getMenuCommands();
    expect([...commands.keys()]).toEqual([
      "Настройки голосового ввода",
      "Переключить автоотправку",
      "Повторить последнюю диктовку",
      "Очистить сохранённые ошибки",
    ]);
    for (const callback of commands.values()) {
      callback();
    }
    expect(calls).toEqual(["settings", "toggle", "retry", "clear"]);
  });
});
