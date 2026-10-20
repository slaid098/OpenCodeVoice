import { describe, expect, it } from "vitest";
import { DEFAULT_CLEANUP_PROMPT_RU, createDefaultConfig } from "../src/config.js";
import { AbortError, HttpError } from "../src/http.js";
import {
  LlmError,
  cleanupText,
  extractOllamaContent,
  extractOpenAiContent,
  formatLlmError,
  joinOpenAiEndpoint,
  normalizeOpenAiBase,
  parseContent,
  sanitizeCleanup,
  validateCleanup,
} from "../src/llm.js";
import type { AppConfig } from "../src/types.js";
import { __getRequests, __setXmlhttpResponder } from "./__mocks__/$/index.js";

function makeConfig(overrides: (config: AppConfig) => void = () => {}): AppConfig {
  const config = createDefaultConfig();
  config.llm.apiKey = "llm-key";
  config.retry.maxAttempts = 1;
  config.retry.baseDelayMs = 0;
  config.retry.maxDelayMs = 0;
  overrides(config);
  return config;
}

function jsonResponse(payload: unknown): { status: number; responseText: string } {
  return { status: 200, responseText: JSON.stringify(payload) };
}

function sentBody(index = 0): Record<string, unknown> {
  return JSON.parse(String(__getRequests()[index]?.data)) as Record<string, unknown>;
}

describe("cleanupText with Ollama", () => {
  it("sends the prompt, raw text and think=false, then returns cleaned text", async () => {
    __setXmlhttpResponder(() => jsonResponse({ message: { content: "  Чистый текст.  " } }));
    const config = makeConfig();
    const result = await cleanupText("ну вот сырой текст", config);

    expect(result).toEqual({
      text: "Чистый текст.",
      fallback: false,
      usedDefaultPrompt: false,
    });
    const request = __getRequests()[0];
    expect(request?.url).toBe("https://ollama.com/api/chat");
    expect(request?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer llm-key",
    });
    expect(request?.timeout).toBe(45_000);
    const body = sentBody();
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.options).toEqual({ temperature: 0.1, num_predict: 2048 });
    expect(body.messages).toEqual([
      { role: "system", content: DEFAULT_CLEANUP_PROMPT_RU },
      { role: "user", content: "ну вот сырой текст" },
    ]);
  });

  it("enables thinking when reasoning is on", async () => {
    __setXmlhttpResponder(() => jsonResponse({ message: { content: "ok" } }));
    await cleanupText(
      "raw",
      makeConfig((c) => {
        c.llm.reasoning = true;
      }),
    );
    expect(sentBody().think).toBe(true);
  });

  it("does not send Authorization for ollama-local", async () => {
    __setXmlhttpResponder(() => jsonResponse({ message: { content: "ok" } }));
    await cleanupText(
      "raw",
      makeConfig((c) => {
        c.llm.provider = "ollama-local";
        c.llm.baseUrl = "http://127.0.0.1:11434/";
        c.llm.apiKey = "";
      }),
    );
    expect(__getRequests()[0]?.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(__getRequests()[0]?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("retries once without think on a 400 response", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return calls === 1
        ? { status: 400, responseText: "unknown field think" }
        : jsonResponse({ message: { content: "после повтора" } });
    });
    const result = await cleanupText("raw", makeConfig());
    expect(result.text).toBe("после повтора");
    expect(calls).toBe(2);
    expect(sentBody(0).think).toBe(false);
    expect(sentBody(1)).not.toHaveProperty("think");
  });

  it("uses the default prompt when the custom prompt is blank", async () => {
    __setXmlhttpResponder(() => jsonResponse({ message: { content: "ok" } }));
    const result = await cleanupText(
      "raw",
      makeConfig((c) => {
        c.llm.prompt = "   ";
      }),
    );
    expect(result.usedDefaultPrompt).toBe(true);
    const messages = sentBody().messages as Array<{ content: string }>;
    expect(messages[0]?.content).toBe(DEFAULT_CLEANUP_PROMPT_RU);
  });

  it("supports the legacy response field", async () => {
    __setXmlhttpResponder(() => jsonResponse({ response: "legacy content" }));
    const result = await cleanupText("raw", makeConfig());
    expect(result.text).toBe("legacy content");
  });
});

describe("cleanupText with an OpenAI-compatible provider", () => {
  it("uses /v1/chat/completions and reasoning_effort none", async () => {
    __setXmlhttpResponder(() =>
      jsonResponse({ choices: [{ message: { content: "  OpenAI cleaned  " } }] }),
    );
    const config = makeConfig((c) => {
      c.llm.provider = "custom-openai";
      c.llm.baseUrl = "https://example.com/";
      c.llm.model = "my-model";
      c.llm.apiKey = "openai-key";
    });
    const result = await cleanupText("raw text", config);
    expect(result.text).toBe("OpenAI cleaned");
    expect(__getRequests()[0]?.url).toBe("https://example.com/v1/chat/completions");
    expect(__getRequests()[0]?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer openai-key",
    });
    const body = sentBody();
    expect(body.model).toBe("my-model");
    expect(body.reasoning_effort).toBe("none");
    expect(body.max_tokens).toBe(2048);
    expect(body.temperature).toBe(0.1);
  });

  it("sends reasoning_effort medium when reasoning is on", async () => {
    __setXmlhttpResponder(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    await cleanupText(
      "raw",
      makeConfig((c) => {
        c.llm.provider = "custom-openai";
        c.llm.reasoning = true;
      }),
    );
    expect(sentBody().reasoning_effort).toBe("medium");
  });

  it("retries without reasoning_effort on 400", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return calls === 1
        ? { status: 400, responseText: "reasoning_effort unsupported" }
        : jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });
    const result = await cleanupText(
      "raw",
      makeConfig((c) => {
        c.llm.provider = "custom-openai";
      }),
    );
    expect(result.text).toBe("ok");
    expect(calls).toBe(2);
    expect(sentBody(1)).not.toHaveProperty("reasoning_effort");
  });

  it("parses content arrays and text choices", async () => {
    __setXmlhttpResponder(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "part one " },
                { type: "text", text: "part two" },
              ],
            },
          },
        ],
      }),
    );
    const result = await cleanupText(
      "raw",
      makeConfig((c) => {
        c.llm.provider = "custom-openai";
      }),
    );
    expect(result.text).toBe("part one part two");
  });
});

describe("cleanup fallbacks and errors", () => {
  it("returns raw text when cleanup is disabled", async () => {
    const result = await cleanupText(
      " raw ",
      makeConfig((c) => {
        c.llm.enabled = false;
      }),
    );
    expect(result).toEqual({
      text: " raw ",
      fallback: false,
      usedDefaultPrompt: false,
    });
    expect(__getRequests()).toHaveLength(0);
  });

  it("returns a fallback for empty input", async () => {
    const result = await cleanupText("   ", makeConfig());
    expect(result).toEqual({
      text: "   ",
      fallback: true,
      reason: "empty",
      usedDefaultPrompt: false,
    });
  });

  it("requires a key for Ollama Cloud", async () => {
    await expect(
      cleanupText(
        "raw",
        makeConfig((c) => {
          c.llm.apiKey = "  ";
        }),
      ),
    ).rejects.toThrow(/Не задан API-ключ Ollama Cloud/);
  });

  it("rejects invalid JSON from the provider", async () => {
    __setXmlhttpResponder(() => ({ status: 200, responseText: "not json" }));
    await expect(cleanupText("raw", makeConfig())).rejects.toBeInstanceOf(LlmError);
    await expect(cleanupText("raw", makeConfig())).rejects.toThrow(/некорректный JSON/);
  });

  it("falls back when the provider returns an empty answer", async () => {
    __setXmlhttpResponder(() => jsonResponse({ message: { content: "   " } }));
    const result = await cleanupText("raw", makeConfig());
    expect(result).toMatchObject({ text: "raw", fallback: true, reason: "empty-result" });
  });

  it("falls back when the provider refuses", async () => {
    __setXmlhttpResponder(() =>
      jsonResponse({ message: { content: "Извините, я не могу это сделать." } }),
    );
    const result = await cleanupText("raw", makeConfig());
    expect(result).toMatchObject({ text: "raw", fallback: true, reason: "refusal" });
  });

  it("falls back when the answer is implausibly long", async () => {
    __setXmlhttpResponder(() => jsonResponse({ message: { content: "x".repeat(600) } }));
    const result = await cleanupText("short", makeConfig());
    expect(result).toMatchObject({ text: "short", fallback: true, reason: "too-long" });
  });

  it("maps HTTP errors", async () => {
    __setXmlhttpResponder(() => ({ status: 401, responseText: "nope" }));
    await expect(cleanupText("raw", makeConfig())).rejects.toThrow(/API-ключ LLM/);

    __setXmlhttpResponder(() => ({ status: 404, responseText: "nope" }));
    await expect(cleanupText("raw", makeConfig())).rejects.toThrow(/LLM endpoint не найден/);
  });

  it("rethrows AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      cleanupText("raw", makeConfig(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortError);
  });

  it("passes retry hooks", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return calls === 1
        ? { status: 503, responseText: "down" }
        : jsonResponse({ message: { content: "ok" } });
    });
    const attempts: number[] = [];
    await cleanupText(
      "raw",
      makeConfig((c) => {
        c.retry.maxAttempts = 2;
      }),
      { onRetry: (_error, attempt) => attempts.push(attempt) },
    );
    expect(attempts).toEqual([1]);
  });
});

describe("cleanup helpers", () => {
  it("sanitizes code fences, prefixes and quotes", () => {
    expect(sanitizeCleanup("```text\nПривет\n```")).toBe("Привет");
    expect(sanitizeCleanup("Очищенный текст: Привет.")).toBe("Привет.");
    expect(sanitizeCleanup("«Привет.»")).toBe("Привет.");
    expect(sanitizeCleanup('"Привет."')).toBe("Привет.");
    expect(sanitizeCleanup("  Просто текст  ")).toBe("Просто текст");
    expect(sanitizeCleanup("''")).toBe("''");
    expect(sanitizeCleanup("«»")).toBe("«»");
  });

  it("validates cleanup output", () => {
    expect(validateCleanup("raw", "", false)).toMatchObject({
      fallback: true,
      reason: "empty-result",
    });
    expect(validateCleanup("raw", "не могу помочь", false)).toMatchObject({
      fallback: true,
      reason: "refusal",
    });
    expect(validateCleanup("raw", "x".repeat(504), false)).toMatchObject({
      fallback: true,
      reason: "too-long",
    });
    expect(validateCleanup("raw", "x".repeat(503), false)).toEqual({
      text: "x".repeat(503),
      fallback: false,
      usedDefaultPrompt: false,
    });
    expect(validateCleanup("raw", "cleaned", true)).toEqual({
      text: "cleaned",
      fallback: false,
      usedDefaultPrompt: true,
    });
  });

  it("normalizes OpenAI-compatible base URLs", () => {
    expect(normalizeOpenAiBase("https://api.openai.com")).toBe("https://api.openai.com/v1");
    expect(normalizeOpenAiBase("https://api.openai.com/")).toBe("https://api.openai.com/v1");
    expect(normalizeOpenAiBase("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1");
    expect(normalizeOpenAiBase("https://x/v1/chat/completions")).toBe("https://x/v1");
    expect(normalizeOpenAiBase("https://x/v1/models")).toBe("https://x/v1");
    expect(joinOpenAiEndpoint("https://x", "/chat/completions")).toBe(
      "https://x/v1/chat/completions",
    );
  });

  it("extracts content from provider payloads", () => {
    expect(extractOllamaContent({ message: { content: "a" } })).toBe("a");
    expect(extractOllamaContent({ response: "b" })).toBe("b");
    expect(extractOllamaContent(null)).toBe("");
    expect(extractOpenAiContent({ choices: [{ message: { content: "c" } }] })).toBe("c");
    expect(extractOpenAiContent({ choices: [{ text: "d" }] })).toBe("d");
    expect(extractOpenAiContent({ choices: [] })).toBe("");
    expect(extractOpenAiContent({})).toBe("");
    expect(parseContent({ text: "e" })).toBe("e");
    expect(parseContent([{ content: "f" }, "g", 1])).toBe("fg");
    expect(parseContent(42)).toBe("");
  });

  it("formats LLM errors", () => {
    expect(formatLlmError(new LlmError("own")).message).toBe("own");
    expect(formatLlmError(new HttpError(0, "offline", true)).message).toMatch(
      /Не удалось связаться/,
    );
    expect(formatLlmError(new HttpError(401, "x", false)).message).toMatch(/API-ключ LLM/);
    expect(formatLlmError(new HttpError(403, "x", false)).message).toMatch(/API-ключ LLM/);
    expect(formatLlmError(new HttpError(429, "x", true)).message).toMatch(/Слишком много/);
    expect(formatLlmError(new HttpError(500, "x", true)).message).toMatch(/временно недоступен/);
    expect(formatLlmError(new HttpError(418, "x", false, "body")).message).toMatch(
      /Ошибка LLM \(418\)/,
    );
    expect(formatLlmError(new HttpError(400, "x", false, "bad")).message).toMatch(
      /LLM отклонил запрос: bad/,
    );
    expect(formatLlmError(new Error("plain")).message).toBe("plain");
    expect(formatLlmError(1).message).toMatch(/Неизвестная ошибка/);
  });
});
