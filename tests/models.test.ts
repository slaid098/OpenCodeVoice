import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../src/config.js";
import { AbortError } from "../src/http.js";
import {
  ModelsError,
  ModelsUnsupportedError,
  extractOllamaNames,
  extractOpenAiIds,
  listLlmModels,
  listSttModels,
  sttModelsUrl,
} from "../src/models.js";
import type { AppConfig } from "../src/types.js";
import { __getRequests, __setXmlhttpResponder } from "./__mocks__/$/index.js";

function makeConfig(overrides: (config: AppConfig) => void = () => {}): AppConfig {
  const config = createDefaultConfig();
  config.stt.apiKey = "stt-key";
  config.llm.apiKey = "llm-key";
  config.retry.maxAttempts = 2;
  config.retry.baseDelayMs = 0;
  config.retry.maxDelayMs = 0;
  overrides(config);
  return config;
}

function json(payload: unknown): { status: number; responseText: string } {
  return { status: 200, responseText: JSON.stringify(payload) };
}

describe("listSttModels", () => {
  it("loads and sorts Whisper models", async () => {
    __setXmlhttpResponder(() =>
      json({
        data: [
          { id: "other-model" },
          { id: "whisper-1" },
          { id: "whisper-large-v3" },
          { id: "whisper-large-v3-turbo" },
          { id: 42 },
        ],
      }),
    );
    const models = await listSttModels(makeConfig());
    expect(models.map((model) => model.id)).toEqual([
      "whisper-large-v3-turbo",
      "whisper-large-v3",
      "whisper-1",
      "other-model",
    ]);
    expect(models[0]).toEqual({
      id: "whisper-large-v3-turbo",
      label: "whisper-large-v3-turbo",
    });
    const request = __getRequests()[0];
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://api.groq.com/openai/v1/models");
    expect(request?.headers).toEqual({ Authorization: "Bearer stt-key" });
    expect(request?.timeout).toBe(15_000);
  });

  it("omits Authorization when the key is blank", async () => {
    __setXmlhttpResponder(() => json({ data: [{ id: "whisper-1" }] }));
    await listSttModels(
      makeConfig((c) => {
        c.stt.apiKey = "  ";
      }),
    );
    expect(__getRequests()[0]?.headers).toEqual({});
  });

  it("derives the models URL from different endpoints", () => {
    expect(sttModelsUrl("https://api.groq.com/openai/v1/audio/transcriptions")).toBe(
      "https://api.groq.com/openai/v1/models",
    );
    expect(sttModelsUrl("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1/models");
    expect(sttModelsUrl("https://proxy.example/transcribe")).toBe("https://proxy.example/models");
    expect(sttModelsUrl("transcribe")).toBe("transcribe/models");
  });

  it("throws on an empty list", async () => {
    __setXmlhttpResponder(() => json({ data: [] }));
    await expect(listSttModels(makeConfig())).rejects.toThrow(/пустой список/);
  });

  it("maps unsupported endpoints", async () => {
    __setXmlhttpResponder(() => ({ status: 404, responseText: "nope" }));
    await expect(listSttModels(makeConfig())).rejects.toBeInstanceOf(ModelsUnsupportedError);

    __setXmlhttpResponder(() => ({ status: 405, responseText: "nope" }));
    await expect(listSttModels(makeConfig())).rejects.toBeInstanceOf(ModelsUnsupportedError);
  });

  it("maps auth errors", async () => {
    __setXmlhttpResponder(() => ({ status: 401, responseText: "nope" }));
    await expect(listSttModels(makeConfig())).rejects.toThrow(/Неверный API-ключ/);
    __setXmlhttpResponder(() => ({ status: 403, responseText: "nope" }));
    await expect(listSttModels(makeConfig())).rejects.toThrow(/Неверный API-ключ/);
  });

  it("maps network and other HTTP errors", async () => {
    __setXmlhttpResponder(() => ({ error: "offline" }));
    await expect(listSttModels(makeConfig())).rejects.toThrow(/Не удалось связаться/);

    __setXmlhttpResponder(() => ({ status: 418, responseText: "teapot" }));
    await expect(listSttModels(makeConfig())).rejects.toThrow(/Ошибка загрузки моделей \(418\)/);
  });

  it("rejects invalid JSON", async () => {
    __setXmlhttpResponder(() => ({ status: 200, responseText: "not json" }));
    await expect(listSttModels(makeConfig())).rejects.toThrow(/некорректный JSON/);
  });

  it("caps retries at two attempts", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return { status: 500, responseText: "down" };
    });
    await expect(
      listSttModels(
        makeConfig((c) => {
          c.retry.maxAttempts = 5;
        }),
      ),
    ).rejects.toThrow(/Ошибка загрузки моделей \(500\)/);
    expect(calls).toBe(2);
  });

  it("propagates abort", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(listSttModels(makeConfig(), controller.signal)).rejects.toBeInstanceOf(AbortError);
  });
});

describe("listLlmModels", () => {
  it("loads OpenAI-compatible models from /v1/models", async () => {
    __setXmlhttpResponder(() => json({ data: [{ id: "model-a" }, { id: "model-b" }] }));
    const models = await listLlmModels(
      makeConfig((c) => {
        c.llm.provider = "custom-openai";
        c.llm.baseUrl = "https://example.com";
      }),
    );
    expect(models.map((model) => model.id)).toEqual(["model-a", "model-b"]);
    expect(__getRequests()[0]?.url).toBe("https://example.com/v1/models");
    expect(__getRequests()[0]?.headers).toEqual({ Authorization: "Bearer llm-key" });
  });

  it("loads Ollama models from /api/tags", async () => {
    __setXmlhttpResponder(() =>
      json({
        models: [{ name: "deepseek-v4.1-flash" }, { model: "legacy-name" }, { name: 42 }],
      }),
    );
    const models = await listLlmModels(makeConfig());
    expect(models.map((model) => model.id)).toEqual(["deepseek-v4.1-flash", "legacy-name"]);
    expect(__getRequests()[0]?.url).toBe("https://ollama.com/api/tags");
    expect(__getRequests()[0]?.headers).toEqual({ Authorization: "Bearer llm-key" });
  });

  it("loads local Ollama without auth", async () => {
    __setXmlhttpResponder(() => json({ models: [{ name: "qwen" }] }));
    await listLlmModels(
      makeConfig((c) => {
        c.llm.provider = "ollama-local";
        c.llm.baseUrl = "http://127.0.0.1:11434/";
        c.llm.apiKey = "";
      }),
    );
    expect(__getRequests()[0]?.url).toBe("http://127.0.0.1:11434/api/tags");
    expect(__getRequests()[0]?.headers).toEqual({});
  });

  it("throws on empty Ollama and OpenAI lists", async () => {
    __setXmlhttpResponder(() => json({ models: [] }));
    await expect(listLlmModels(makeConfig())).rejects.toThrow(/Ollama вернула пустой список/);

    __setXmlhttpResponder(() => json({ data: [] }));
    await expect(
      listLlmModels(
        makeConfig((c) => {
          c.llm.provider = "custom-openai";
        }),
      ),
    ).rejects.toThrow(/пустой список/);
  });

  it("maps unsupported and auth errors", async () => {
    __setXmlhttpResponder(() => ({ status: 404, responseText: "nope" }));
    await expect(listLlmModels(makeConfig())).rejects.toBeInstanceOf(ModelsUnsupportedError);
    __setXmlhttpResponder(() => ({ status: 401, responseText: "nope" }));
    await expect(listLlmModels(makeConfig())).rejects.toBeInstanceOf(ModelsError);
  });
});

describe("model payload helpers", () => {
  it("extracts OpenAI ids", () => {
    expect(extractOpenAiIds({ data: [{ id: "a" }, { id: "b" }, { nope: true }] })).toEqual([
      "a",
      "b",
    ]);
    expect(extractOpenAiIds({ data: "x" })).toEqual([]);
    expect(extractOpenAiIds(null)).toEqual([]);
  });

  it("extracts Ollama names", () => {
    expect(
      extractOllamaNames({ models: [{ name: "a" }, { model: "b" }, { name: 1 }, "c"] }),
    ).toEqual(["a", "b"]);
    expect(extractOllamaNames({})).toEqual([]);
    expect(extractOllamaNames([])).toEqual([]);
  });
});
