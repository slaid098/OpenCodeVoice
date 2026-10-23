import { describe, expect, it } from "vitest";
import {
  applyLlmPreset,
  applySttPreset,
  CONFIG_KEY,
  createDefaultConfig,
  DEFAULT_CLEANUP_PROMPT_EN,
  DEFAULT_CLEANUP_PROMPT_RU,
  defaultCleanupPrompt,
  getCleanupPrompt,
  isFirstRun,
  LEGACY_OPENAI_STT,
  LLM_PRESETS,
  loadConfig,
  registerMenuCommands,
  resolveSttEndpoint,
  resolveSttModel,
  STT_PRESETS,
  saveConfig,
  validateConfig,
} from "../src/config.js";
import type { AppConfig, LlmProviderId, SttProviderId } from "../src/types.js";
import {
  __getMenuCommands,
  __getMockStore,
  GM_getValue,
  GM_setValue,
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
      ui: {
        language: "auto",
      },
      stt: {
        provider: "groq",
        apiKey: "",
        language: "",
        prompt: "",
        temperature: 0,
        groqModel: "whisper-large-v3-turbo",
        customEndpoint: "",
        customModel: "",
      },
      llm: {
        enabled: true,
        provider: "ollama-cloud",
        baseUrl: "https://ollama.com",
        apiKey: "",
        model: "deepseek-v4.1-flash",
        reasoning: false,
        prompt: DEFAULT_CLEANUP_PROMPT_RU,
      },
      behavior: {
        autoSubmit: true,
        autoSubmitQuestion: false,
        fallbackToRaw: true,
        saveFailedAudio: true,
        maxRecordingSeconds: 600,
      },
      retry: {
        maxAttempts: 3,
        baseDelayMs: 800,
        maxDelayMs: 8000,
      },
    });
  });

  it("uses the requested locale for the default cleanup prompt", () => {
    expect(createDefaultConfig("en").llm.prompt).toBe(DEFAULT_CLEANUP_PROMPT_EN);
    expect(createDefaultConfig("ru").llm.prompt).toBe(DEFAULT_CLEANUP_PROMPT_RU);
    expect(defaultCleanupPrompt("en")).toBe(DEFAULT_CLEANUP_PROMPT_EN);
    expect(defaultCleanupPrompt("ru")).toBe(DEFAULT_CLEANUP_PROMPT_RU);
  });

  it("defaults the recording limit to 10 minutes", () => {
    expect(createDefaultConfig().behavior.maxRecordingSeconds).toBe(600);
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
    expect(DEFAULT_CLEANUP_PROMPT_RU).toContain("редактор русской расшифровки");
    for (let rule = 1; rule <= 8; rule += 1) {
      expect(DEFAULT_CLEANUP_PROMPT_RU).toContain(`${rule}.`);
    }
    expect(DEFAULT_CLEANUP_PROMPT_RU).toContain("Не переводи текст");
  });

  it("ships an English cleanup prompt", () => {
    expect(DEFAULT_CLEANUP_PROMPT_EN).toContain("voice dictation transcript");
    for (let rule = 1; rule <= 7; rule += 1) {
      expect(DEFAULT_CLEANUP_PROMPT_EN).toContain(`${rule}.`);
    }
    expect(DEFAULT_CLEANUP_PROMPT_EN).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("defines STT and LLM presets", () => {
    expect(STT_PRESETS.groq.model).toBe("whisper-large-v3-turbo");
    expect(STT_PRESETS.custom).toEqual({ endpoint: "", model: "" });
    expect(Object.keys(STT_PRESETS)).toEqual(["groq", "custom"]);
    expect(LEGACY_OPENAI_STT).toEqual({
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      model: "whisper-1",
    });
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
    // A legacy OpenAI config becomes Custom URL with its endpoint preserved.
    expect(config.stt.provider).toBe("custom");
    expect(config.stt.customEndpoint).toBe(LEGACY_OPENAI_STT.endpoint);
    expect(config.stt.customModel).toBe(LEGACY_OPENAI_STT.model);
    expect(config.stt.apiKey).toBe("");
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

describe("UI language", () => {
  it.each(["auto", "ru", "en"] as const)("keeps the %s preference", (language) => {
    GM_setValue(CONFIG_KEY, JSON.stringify({ ui: { language } }));
    expect(loadConfig().ui.language).toBe(language);
  });

  it.each([undefined, null, 42, "de", "RU"])("falls back to auto for %j", (language) => {
    GM_setValue(CONFIG_KEY, JSON.stringify({ ui: { language } }));
    expect(loadConfig().ui.language).toBe("auto");
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
      apiKey: "gsk_legacy",
      groqModel: "whisper-large-v3",
      customEndpoint: "",
      customModel: "",
      language: "ru",
      prompt: "OpenCode",
      temperature: 0.4,
    });
    expect(config.behavior.autoSubmit).toBe(false);
    expect(storedConfig().stt.apiKey).toBe("gsk_legacy");
  });

  it("turns the legacy OpenAI endpoint into Custom URL", () => {
    GM_setValue("endpoint", LEGACY_OPENAI_STT.endpoint);
    const config = loadConfig();
    expect(config.stt.provider).toBe("custom");
    expect(config.stt.customEndpoint).toBe(LEGACY_OPENAI_STT.endpoint);
    expect(config.stt.customModel).toBe(LEGACY_OPENAI_STT.model);
  });

  it("treats an unknown endpoint as a custom provider", () => {
    GM_setValue("endpoint", "https://proxy.example.com/v1/audio/transcriptions");
    const config = loadConfig();
    expect(config.stt.provider).toBe("custom");
    expect(config.stt.customEndpoint).toBe("https://proxy.example.com/v1/audio/transcriptions");
  });

  it("keeps a custom legacy model and endpoint", () => {
    GM_setValue("groqApiKey", "gsk_legacy");
    GM_setValue("model", "my-whisper");
    GM_setValue("endpoint", "https://proxy.example.com/transcribe");
    const config = loadConfig();
    expect(config.stt.provider).toBe("custom");
    expect(config.stt.customModel).toBe("my-whisper");
    expect(config.stt.customEndpoint).toBe("https://proxy.example.com/transcribe");
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

describe("stored v2 migration", () => {
  it("preserves a non-standard endpoint stored under provider groq", () => {
    GM_setValue(
      CONFIG_KEY,
      JSON.stringify({
        stt: {
          provider: "groq",
          endpoint: "https://my-proxy.example.com/v1/audio/transcriptions",
          model: "my-whisper",
          apiKey: "key",
        },
      }),
    );
    const config = loadConfig();
    expect(config.stt.provider).toBe("custom");
    expect(config.stt.customEndpoint).toBe("https://my-proxy.example.com/v1/audio/transcriptions");
    expect(config.stt.customModel).toBe("my-whisper");
    expect(config.stt.groqModel).toBe(STT_PRESETS.groq.model);
  });

  it("keeps a standard Groq endpoint as groq", () => {
    GM_setValue(
      CONFIG_KEY,
      JSON.stringify({
        stt: {
          provider: "groq",
          endpoint: STT_PRESETS.groq.endpoint,
          model: "whisper-large-v3",
        },
      }),
    );
    const config = loadConfig();
    expect(config.stt.provider).toBe("groq");
    expect(config.stt.groqModel).toBe("whisper-large-v3");
    expect(config.stt.customEndpoint).toBe("");
  });

  it("keeps legacy openai provider as custom even without endpoint", () => {
    GM_setValue(CONFIG_KEY, JSON.stringify({ stt: { provider: "openai" } }));
    const config = loadConfig();
    expect(config.stt.provider).toBe("custom");
    expect(config.stt.customEndpoint).toBe(LEGACY_OPENAI_STT.endpoint);
    expect(config.stt.customModel).toBe(LEGACY_OPENAI_STT.model);
  });

  it("keeps custom fields saved under provider groq", () => {
    GM_setValue(
      CONFIG_KEY,
      JSON.stringify({
        stt: {
          provider: "groq",
          groqModel: "whisper-large-v3",
          customEndpoint: "https://proxy.example.com/transcribe",
          customModel: "my-model",
        },
      }),
    );
    const config = loadConfig();
    expect(config.stt.provider).toBe("groq");
    expect(config.stt.groqModel).toBe("whisper-large-v3");
    expect(config.stt.customEndpoint).toBe("https://proxy.example.com/transcribe");
    expect(config.stt.customModel).toBe("my-model");
  });

  it("infers custom when provider is missing but an endpoint is set", () => {
    GM_setValue(
      CONFIG_KEY,
      JSON.stringify({ stt: { customEndpoint: "https://proxy.example.com/transcribe" } }),
    );
    expect(loadConfig().stt.provider).toBe("custom");
  });

  it("falls back to groq when neither provider nor endpoint is set", () => {
    GM_setValue(CONFIG_KEY, JSON.stringify({ stt: { groqModel: "" } }));
    const config = loadConfig();
    expect(config.stt.provider).toBe("groq");
    expect(config.stt.groqModel).toBe(STT_PRESETS.groq.model);
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
    config.ui.language = "en";
    saveConfig(config);
    expect(loadConfig()).toEqual(config);
  });

  it("round-trips saved custom fields while provider is groq", () => {
    const config = validConfig();
    config.stt.customEndpoint = "https://proxy.example.com/transcribe";
    config.stt.customModel = "my-model";
    saveConfig(config);
    const loaded = loadConfig();
    expect(loaded.stt.provider).toBe("groq");
    expect(loaded.stt.customEndpoint).toBe("https://proxy.example.com/transcribe");
    expect(loaded.stt.customModel).toBe("my-model");
  });
});

describe("isFirstRun", () => {
  it("is true without an STT key for the Groq provider", () => {
    expect(isFirstRun()).toBe(true);
    expect(isFirstRun(createDefaultConfig())).toBe(true);
  });

  it("is false once an STT key is present", () => {
    const config = createDefaultConfig();
    config.stt.apiKey = "key";
    expect(isFirstRun(config)).toBe(false);
  });

  it("is false for a complete custom endpoint without a key", () => {
    const config = createDefaultConfig();
    config.stt.provider = "custom";
    config.stt.customEndpoint = "https://proxy.example.com/transcribe";
    config.stt.customModel = "my-model";
    expect(isFirstRun(config)).toBe(false);
  });

  it("is true for custom without an endpoint or model", () => {
    const config = createDefaultConfig();
    config.stt.provider = "custom";
    expect(isFirstRun(config)).toBe(true);
    config.stt.customEndpoint = "https://proxy.example.com/transcribe";
    expect(isFirstRun(config)).toBe(true);
    config.stt.customModel = "my-model";
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
    expect(getCleanupPrompt(config)).toBe(DEFAULT_CLEANUP_PROMPT_RU);
  });
});

describe("STT resolution and presets", () => {
  it("resolves the built-in Groq endpoint and model", () => {
    const config = createDefaultConfig();
    expect(resolveSttEndpoint(config.stt)).toBe(STT_PRESETS.groq.endpoint);
    expect(resolveSttModel(config.stt)).toBe(STT_PRESETS.groq.model);
  });

  it("falls back to the default Groq model for a blank one", () => {
    const config = createDefaultConfig();
    config.stt.groqModel = "  ";
    expect(resolveSttModel(config.stt)).toBe(STT_PRESETS.groq.model);
  });

  it("resolves the custom endpoint and model", () => {
    const config = createDefaultConfig();
    config.stt.provider = "custom";
    config.stt.customEndpoint = " https://proxy.example.com/transcribe ";
    config.stt.customModel = " my-model ";
    expect(resolveSttEndpoint(config.stt)).toBe("https://proxy.example.com/transcribe");
    expect(resolveSttModel(config.stt)).toBe("my-model");
  });

  it("applies STT presets without mutating the input", () => {
    const config = createDefaultConfig();
    config.stt.apiKey = "key";
    const custom = applySttPreset(config.stt, "custom");
    expect(custom.provider).toBe("custom");
    expect(config.stt.provider).toBe("groq");

    const groq = applySttPreset(custom, "groq");
    expect(groq.provider).toBe("groq");
    expect(groq.groqModel).toBe(STT_PRESETS.groq.model);
  });

  it("keeps custom endpoint and model when switching to Groq and back", () => {
    const config = createDefaultConfig();
    config.stt.customEndpoint = "https://proxy.example.com/transcribe";
    config.stt.customModel = "my-model";

    const custom = applySttPreset(config.stt, "custom");
    const groq = applySttPreset(custom, "groq");
    expect(groq.customEndpoint).toBe("https://proxy.example.com/transcribe");
    expect(groq.customModel).toBe("my-model");

    const back = applySttPreset(groq, "custom");
    expect(back.customEndpoint).toBe("https://proxy.example.com/transcribe");
    expect(back.customModel).toBe("my-model");
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
    config.stt.customEndpoint = "https://proxy.example.com/transcribe";
    config.stt.customModel = "my-model";
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
    "rejects the custom STT endpoint %j",
    (endpoint) => {
      const config = validConfig();
      config.stt.provider = "custom";
      config.stt.customModel = "my-model";
      config.stt.customEndpoint = endpoint;
      expect(validateConfig(config)).toContain("STT endpoint должен быть корректным http(s) URL");
    },
  );

  it("requires a Groq STT model", () => {
    const config = validConfig();
    config.stt.groqModel = "  ";
    expect(validateConfig(config)).toContain("Укажите модель STT");
  });

  it("requires a custom STT model", () => {
    const config = validConfig();
    config.stt.provider = "custom";
    config.stt.customEndpoint = "https://proxy.example.com/transcribe";
    config.stt.customModel = "  ";
    expect(validateConfig(config)).toContain("Укажите модель STT");
  });

  it("requires an STT key for the Groq provider", () => {
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
    config.stt.groqModel = "";
    config.llm.provider = "nope" as unknown as LlmProviderId;
    config.llm.baseUrl = "x";
    config.llm.model = "";
    config.behavior.maxRecordingSeconds = 1;
    config.retry.maxAttempts = 0;
    const errors = validateConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(8);
    expect(errors).toContain("Укажите API-ключ STT");
    expect(errors).toContain("Неизвестный LLM-провайдер");
  });

  it("returns localized messages for English", () => {
    const config = validConfig();
    config.stt.provider = "custom";
    config.stt.customEndpoint = "not a url";
    config.stt.customModel = "";
    const errors = validateConfig(config, "en");
    expect(errors).toContain("The STT endpoint must be a valid http(s) URL");
    expect(errors).toContain("Specify the STT model");
    expect(errors.every((message) => !/[А-Яа-яЁё]/.test(message))).toBe(true);
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
