import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../src/config.js";
import { AbortError, HttpError } from "../src/http.js";
import { setLocale } from "../src/i18n.js";
import {
  SttError,
  audioFileName,
  buildFormData,
  formatSttError,
  isSttRegionBlock,
  parseTranscription,
  resolveResponseFormat,
  transcribe,
} from "../src/transcribe.js";
import type { AppConfig } from "../src/types.js";
import { __getRequests, __setXmlhttpResponder } from "./__mocks__/$/index.js";

function makeConfig(overrides: (config: AppConfig) => void = () => {}): AppConfig {
  const config = createDefaultConfig();
  config.stt.apiKey = "stt-key";
  config.retry.maxAttempts = 1;
  config.retry.baseDelayMs = 0;
  config.retry.maxDelayMs = 0;
  overrides(config);
  return config;
}

function audio(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
}

describe("transcribe", () => {
  it("posts audio to the configured endpoint and returns plain text", async () => {
    __setXmlhttpResponder(() => ({ status: 200, responseText: "  привет мир  " }));
    const config = makeConfig();
    const result = await transcribe(audio(), config);
    expect(result).toEqual({
      text: "привет мир",
      provider: "groq",
      model: "whisper-large-v3-turbo",
    });

    const request = __getRequests()[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(request?.headers).toEqual({ Authorization: "Bearer stt-key" });
    expect(request?.timeout).toBe(60_000);
    const body = request?.data as FormData;
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect((body.get("file") as Blob).size).toBe(3);
    expect(body.get("model")).toBe("whisper-large-v3-turbo");
    expect(body.get("response_format")).toBe("text");
    expect(body.get("language")).toBeNull();
    expect(body.get("prompt")).toBeNull();
    expect(body.get("temperature")).toBe("0");
  });

  it("passes language, prompt and temperature when set", async () => {
    __setXmlhttpResponder(() => ({ status: 200, responseText: "ok" }));
    const config = makeConfig((c) => {
      c.stt.language = " ru ";
      c.stt.prompt = " OpenCode ";
      c.stt.temperature = 0.2;
    });
    await transcribe(audio(), config);
    const body = __getRequests()[0]?.data as FormData;
    expect(body.get("language")).toBe("ru");
    expect(body.get("prompt")).toBe("OpenCode");
    expect(body.get("temperature")).toBe("0.2");
  });

  it("parses JSON responses for custom endpoints", async () => {
    __setXmlhttpResponder(() => ({
      status: 200,
      responseText: JSON.stringify({ text: "  JSON текст  " }),
    }));
    const config = makeConfig((c) => {
      c.stt.provider = "custom";
      c.stt.customEndpoint = "https://example.com/transcribe";
      c.stt.customModel = "whisper-local";
      c.stt.apiKey = "";
    });
    const result = await transcribe(audio(), config);
    expect(result.text).toBe("JSON текст");
    expect(result.provider).toBe("custom");
    expect(result.model).toBe("whisper-local");
    const body = __getRequests()[0]?.data as FormData;
    expect(body.get("response_format")).toBe("json");
    expect(body.get("model")).toBe("whisper-local");
    expect(__getRequests()[0]?.url).toBe("https://example.com/transcribe");
    expect(__getRequests()[0]?.headers).toEqual({});
  });

  it("retries without optional fields when the endpoint rejects them with 400", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return calls === 1
        ? { status: 400, responseText: "unknown field temperature" }
        : { status: 200, responseText: "fallback works" };
    });
    const config = makeConfig((c) => {
      c.stt.prompt = "подсказка";
      c.stt.language = "ru";
    });
    const result = await transcribe(audio(), config);
    expect(result.text).toBe("fallback works");
    expect(calls).toBe(2);
    const first = __getRequests()[0]?.data as FormData;
    const second = __getRequests()[1]?.data as FormData;
    expect(first.get("prompt")).toBe("подсказка");
    expect(second.get("prompt")).toBeNull();
    expect(second.get("language")).toBeNull();
    expect(second.get("temperature")).toBeNull();
    expect(second.get("model")).toBe("whisper-large-v3-turbo");
  });

  it("does not retry a 400 when there are no optional fields", async () => {
    __setXmlhttpResponder(() => ({ status: 400, responseText: "bad audio" }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(
      /STT отклонил запрос: bad audio/,
    );
    expect(__getRequests()).toHaveLength(1);
  });

  it("rejects an empty transcription", async () => {
    __setXmlhttpResponder(() => ({ status: 200, responseText: "   " }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(/Пустая расшифровка/);
  });

  it("rejects empty audio and empty endpoint", async () => {
    await expect(transcribe(new Blob([]), makeConfig())).rejects.toBeInstanceOf(SttError);
    const config = makeConfig((c) => {
      c.stt.provider = "custom";
      c.stt.customEndpoint = "  ";
      c.stt.customModel = "my-model";
    });
    await expect(transcribe(audio(), config)).rejects.toThrow(/Не задан STT endpoint/);
    expect(__getRequests()).toHaveLength(0);
  });

  it("maps auth errors", async () => {
    __setXmlhttpResponder(() => ({ status: 401, responseText: "unauthorized" }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(/API-ключ STT/);
  });

  it("reports the OpenAI region block for a 403 with the official body", async () => {
    __setXmlhttpResponder(() => ({
      status: 403,
      responseText: JSON.stringify({
        error: {
          code: "unsupported_country_region_territory",
          message: "Country, region, or territory not supported",
          param: null,
          type: "request_forbidden",
        },
      }),
    }));
    const config = makeConfig((c) => {
      c.stt.provider = "custom";
      c.stt.customEndpoint = "https://api.openai.com/v1/audio/transcriptions";
      c.stt.customModel = "whisper-1";
    });
    await expect(transcribe(audio(), config)).rejects.toThrow(
      /блокирует запросы из вашего региона/,
    );
  });

  it("reports the Groq region block for a plain Forbidden body", async () => {
    __setXmlhttpResponder(() => ({
      status: 403,
      responseText: JSON.stringify({ error: { message: "Forbidden" } }),
    }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(
      /блокирует запросы из вашего региона/,
    );
  });

  it("reports a 451 as a region block", async () => {
    __setXmlhttpResponder(() => ({ status: 451, responseText: "unavailable for legal reasons" }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(
      /блокирует запросы из вашего региона/,
    );
  });

  it("reports a key error for a 403 that mentions the key", async () => {
    __setXmlhttpResponder(() => ({ status: 403, responseText: "Invalid API key provided" }));
    const config = makeConfig((c) => {
      c.stt.provider = "custom";
      c.stt.customEndpoint = "https://proxy.example.com/transcribe";
      c.stt.customModel = "my-model";
    });
    await expect(transcribe(audio(), config)).rejects.toThrow(/API-ключ STT/);
  });

  it("reports a generic forbidden for an unknown 403", async () => {
    __setXmlhttpResponder(() => ({ status: 403, responseText: "nope" }));
    const config = makeConfig((c) => {
      c.stt.provider = "custom";
      c.stt.customEndpoint = "https://proxy.example.com/transcribe";
      c.stt.customModel = "my-model";
    });
    await expect(transcribe(audio(), config)).rejects.toThrow(/Доступ к STT запрещён \(403\)/);
  });

  it("maps not found errors", async () => {
    __setXmlhttpResponder(() => ({ status: 404, responseText: "not found" }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(/endpoint не найден/);
  });

  it("maps too-large errors", async () => {
    __setXmlhttpResponder(() => ({ status: 413, responseText: "too large" }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(/слишком большой/);
  });

  it("retries 429 and reports a friendly error", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return { status: 429, responseText: "rate limit" };
    });
    const config = makeConfig((c) => {
      c.retry.maxAttempts = 2;
    });
    await expect(transcribe(audio(), config)).rejects.toThrow(/Слишком много запросов/);
    expect(calls).toBe(2);
  });

  it("maps server and network errors", async () => {
    __setXmlhttpResponder(() => ({ status: 503, responseText: "down" }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(/временно недоступен/);

    __setXmlhttpResponder(() => ({ error: "offline" }));
    await expect(transcribe(audio(), makeConfig())).rejects.toThrow(/Не удалось связаться/);
  });

  it("rethrows AbortError without wrapping", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribe(audio(), makeConfig(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortError);
  });

  it("passes retry hooks to the HTTP layer", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return calls === 1
        ? { status: 500, responseText: "down" }
        : { status: 200, responseText: "ok" };
    });
    const retries: number[] = [];
    const config = makeConfig((c) => {
      c.retry.maxAttempts = 2;
    });
    await transcribe(audio(), config, {
      onRetry: (_error, attempt) => retries.push(attempt),
    });
    expect(retries).toEqual([1]);
  });
});

describe("transcribe helpers", () => {
  it("builds FormData with optional fields disabled", () => {
    const config = makeConfig((c) => {
      c.stt.language = "ru";
      c.stt.prompt = "prompt";
      c.stt.temperature = 1;
    });
    const data = buildFormData(audio(), config, false);
    expect(data.get("language")).toBeNull();
    expect(data.get("prompt")).toBeNull();
    expect(data.get("temperature")).toBeNull();
  });

  it("parses text, JSON, JSON strings and malformed JSON", () => {
    expect(parseTranscription("﻿ hello ", "text")).toBe("hello");
    expect(parseTranscription("", "text")).toBe("");
    expect(parseTranscription('{"text":" hi "}', "json")).toBe("hi");
    expect(parseTranscription('" quoted "', "json")).toBe("quoted");
    expect(parseTranscription("not json", "json")).toBe("not json");
    expect(parseTranscription('{"other":1}', "json")).toBe('{"other":1}');
  });

  it("resolves response formats", () => {
    expect(resolveResponseFormat("custom", "x")).toBe("json");
    expect(resolveResponseFormat("groq", "whisper-large-v3")).toBe("text");
  });

  it("classifies regional blocks only for known bodies and hosts", () => {
    expect(
      isSttRegionBlock(
        403,
        '{"error":{"code":"unsupported_country_region_territory"}}',
        "https://example.com/transcribe",
      ),
    ).toBe(true);
    expect(
      isSttRegionBlock(403, '{"error":{"message":"Forbidden"}}', "https://api.groq.com/x"),
    ).toBe(true);
    expect(
      isSttRegionBlock(403, '{"error":{"message":"Forbidden"}}', "https://proxy.example.com/x"),
    ).toBe(false);
    expect(isSttRegionBlock(451, "blocked", "https://api.groq.com/x")).toBe(true);
    expect(isSttRegionBlock(403, "invalid api key", "https://api.groq.com/x")).toBe(false);
    expect(isSttRegionBlock(401, "unauthorized", "https://api.groq.com/x")).toBe(false);
  });

  it("picks file names from MIME types", () => {
    expect(audioFileName("audio/mp4")).toBe("audio.mp4");
    expect(audioFileName("audio/ogg;codecs=opus")).toBe("audio.ogg");
    expect(audioFileName("audio/wav")).toBe("audio.wav");
    expect(audioFileName("audio/webm;codecs=opus")).toBe("audio.webm");
    expect(audioFileName("")).toBe("audio.webm");
  });

  it("formats errors", () => {
    expect(formatSttError(new SttError("custom")).message).toBe("custom");
    expect(formatSttError(new HttpError(0, "nope", true)).message).toMatch(/Не удалось связаться/);
    expect(formatSttError(new HttpError(418, "teapot", false, "short body")).message).toMatch(
      /Ошибка STT \(418\): short body/,
    );
    expect(formatSttError(new HttpError(500, "down", true)).message).toMatch(/временно недоступен/);
    expect(formatSttError(new Error("plain")).message).toBe("plain");
    expect(formatSttError("weird").message).toMatch(/Неизвестная ошибка/);
  });

  it("uses the endpoint for the 403 classification", () => {
    const groq = formatSttError(new HttpError(403, "forbidden", false, "Forbidden"), {
      endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
      provider: "groq",
    });
    expect(groq.message).toMatch(/блокирует запросы из вашего региона/);

    const proxy = formatSttError(new HttpError(403, "forbidden", false, "Forbidden"), {
      endpoint: "https://proxy.example.com/transcribe",
      provider: "custom",
    });
    expect(proxy.message).toMatch(/Доступ к STT запрещён/);
  });

  it("localizes messages for English", () => {
    setLocale("en");
    const english = formatSttError(new HttpError(401, "unauthorized", false), {});
    expect(english.message).toMatch(/Invalid or expired STT API key/);
  });
});
