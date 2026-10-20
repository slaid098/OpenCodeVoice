import { DEFAULT_CLEANUP_PROMPT, getCleanupPrompt } from "./config.js";
import { AbortError, HttpError, type RetryHooks, type RetryPolicy, httpRequest } from "./http.js";
import { retryPolicy } from "./transcribe.js";
import type { AppConfig, CleanupResult } from "./types.js";

export interface CleanupOptions {
  signal?: AbortSignal;
  onRetry?: RetryHooks["onRetry"];
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export async function cleanupText(
  rawText: string,
  config: AppConfig,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const raw = rawText.trim();
  if (raw === "") {
    return { text: rawText, fallback: true, reason: "empty", usedDefaultPrompt: false };
  }
  if (!config.llm.enabled) {
    return { text: rawText, fallback: false, usedDefaultPrompt: false };
  }

  const prompt = getCleanupPrompt(config);
  const usedDefaultPrompt = config.llm.prompt.trim() === "";
  if (prompt.trim() === "") {
    return { text: rawText, fallback: true, reason: "empty-prompt", usedDefaultPrompt: true };
  }
  if (config.llm.provider === "ollama-cloud" && config.llm.apiKey.trim() === "") {
    throw new LlmError("Не задан API-ключ Ollama Cloud. Откройте настройки LLM.");
  }

  const policy = retryPolicy(config);
  try {
    const content = await requestCleanup(raw, prompt, config, policy, options);
    return validateCleanup(raw, content, usedDefaultPrompt);
  } catch (error) {
    if (error instanceof AbortError) {
      throw error;
    }
    if (error instanceof LlmError) {
      throw error;
    }
    throw formatLlmError(error);
  }
}

export function validateCleanup(
  raw: string,
  content: string,
  usedDefaultPrompt: boolean,
): CleanupResult {
  const cleaned = sanitizeCleanup(content);
  if (cleaned === "") {
    return {
      text: raw,
      fallback: true,
      reason: "empty-result",
      usedDefaultPrompt,
    };
  }
  if (looksLikeRefusal(cleaned)) {
    return {
      text: raw,
      fallback: true,
      reason: "refusal",
      usedDefaultPrompt,
    };
  }
  const maxLength = Math.max(raw.length * 3, raw.length + 500);
  if (cleaned.length > maxLength) {
    return {
      text: raw,
      fallback: true,
      reason: "too-long",
      usedDefaultPrompt,
    };
  }
  return { text: cleaned, fallback: false, usedDefaultPrompt };
}

export function sanitizeCleanup(content: string): string {
  let text = content.trim();
  const fence = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(text);
  if (fence?.[1] !== undefined) {
    text = fence[1].trim();
  }
  text = text.replace(
    /^(очищенный текст|очищенный вариант|cleaned text|clean text|текст)\s*:\s*/i,
    "",
  );
  text = stripWrappingQuotes(text.trim());
  return text.trim();
}

export function joinOpenAiEndpoint(baseUrl: string, path: string): string {
  return `${normalizeOpenAiBase(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

export function normalizeOpenAiBase(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) {
    base = base.slice(0, -"/chat/completions".length);
  } else if (base.endsWith("/models")) {
    base = base.slice(0, -"/models".length);
  }
  if (base.endsWith("/v1")) {
    return base;
  }
  return `${base}/v1`;
}

export function formatLlmError(error: unknown): Error {
  if (error instanceof HttpError) {
    const detail = shorten(error.body);
    switch (error.status) {
      case 0:
        return new LlmError(`Не удалось связаться с LLM: ${error.message}`);
      case 400:
        return new LlmError(`LLM отклонил запрос: ${detail || error.message}`);
      case 401:
      case 403:
        return new LlmError("Неверный или просроченный API-ключ LLM. Проверьте настройки.");
      case 404:
        return new LlmError("LLM endpoint не найден (404). Проверьте Base URL и модель.");
      case 429:
        return new LlmError("Слишком много запросов к LLM. Подождите и повторите.");
      default:
        if (error.status >= 500) {
          return new LlmError("Сервер LLM временно недоступен. Попробуйте позже.");
        }
        return new LlmError(`Ошибка LLM (${error.status}): ${detail || error.message}`);
    }
  }
  if (error instanceof Error) {
    return new LlmError(error.message);
  }
  return new LlmError("Неизвестная ошибка LLM");
}

async function requestCleanup(
  raw: string,
  prompt: string,
  config: AppConfig,
  policy: RetryPolicy,
  options: CleanupOptions,
): Promise<string> {
  if (config.llm.provider === "custom-openai") {
    return requestOpenAi(raw, prompt, config, policy, options);
  }
  return requestOllama(raw, prompt, config, policy, options);
}

async function requestOllama(
  raw: string,
  prompt: string,
  config: AppConfig,
  policy: RetryPolicy,
  options: CleanupOptions,
): Promise<string> {
  const base = config.llm.baseUrl.trim().replace(/\/+$/, "");
  const url = `${base}/api/chat`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = config.llm.apiKey.trim();
  if (apiKey !== "") {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: config.llm.model,
    messages: buildMessages(prompt, raw),
    stream: false,
    think: config.llm.reasoning,
    options: { temperature: 0.1, num_predict: 2048 },
  };

  try {
    const response = await postJson(url, headers, body, policy, options);
    return extractOllamaContent(response);
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) {
      const retryBody = { ...body };
      retryBody.think = undefined;
      const response = await postJson(url, headers, retryBody, policy, options);
      return extractOllamaContent(response);
    }
    throw error;
  }
}

async function requestOpenAi(
  raw: string,
  prompt: string,
  config: AppConfig,
  policy: RetryPolicy,
  options: CleanupOptions,
): Promise<string> {
  const url = joinOpenAiEndpoint(config.llm.baseUrl, "chat/completions");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = config.llm.apiKey.trim();
  if (apiKey !== "") {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: config.llm.model,
    messages: buildMessages(prompt, raw),
    stream: false,
    temperature: 0.1,
    max_tokens: 2048,
    reasoning_effort: config.llm.reasoning ? "medium" : "none",
  };

  try {
    const response = await postJson(url, headers, body, policy, options);
    return extractOpenAiContent(response);
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) {
      const retryBody = { ...body };
      retryBody.reasoning_effort = undefined;
      const response = await postJson(url, headers, retryBody, policy, options);
      return extractOpenAiContent(response);
    }
    throw error;
  }
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  policy: RetryPolicy,
  options: CleanupOptions,
): Promise<unknown> {
  const response = await httpRequest(
    {
      method: "POST",
      url,
      headers,
      data: JSON.stringify(body),
      timeoutMs: 45_000,
      signal: options.signal,
    },
    policy,
    { onRetry: options.onRetry },
  );
  try {
    return JSON.parse(response.text);
  } catch {
    throw new LlmError("LLM вернул некорректный JSON.");
  }
}

export function extractOllamaContent(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const message = payload.message;
  if (isRecord(message)) {
    return parseContent(message.content);
  }
  return parseContent(payload.response);
}

export function extractOpenAiContent(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (isRecord(first)) {
      const message = first.message;
      if (isRecord(message)) {
        return parseContent(message.content);
      }
      return parseContent(first.text);
    }
  }
  return "";
}

export function parseContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (isRecord(part)) {
          if (typeof part.text === "string") {
            return part.text;
          }
          if (typeof part.content === "string") {
            return part.content;
          }
        }
        return "";
      })
      .join("")
      .trim();
  }
  if (isRecord(value) && typeof value.text === "string") {
    return value.text;
  }
  return "";
}

function buildMessages(prompt: string, raw: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: prompt || DEFAULT_CLEANUP_PROMPT },
    { role: "user", content: raw },
  ];
}

function stripWrappingQuotes(text: string): string {
  const pairs: Array<[string, string]> = [
    ["«", "»"],
    ["“", "”"],
    ['"', '"'],
    ["'", "'"],
  ];
  for (const [open, close] of pairs) {
    if (
      text.startsWith(open) &&
      text.endsWith(close) &&
      text.length >= open.length + close.length + 1
    ) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }
  return text;
}

function looksLikeRefusal(text: string): boolean {
  return /^(извините|к сожалению|не могу|я не могу|не получится|sorry|i can't|i cannot|i'm sorry)/i.test(
    text,
  );
}

function shorten(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
