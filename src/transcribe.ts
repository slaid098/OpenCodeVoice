import { AbortError, HttpError, type RetryHooks, type RetryPolicy, httpRequest } from "./http.js";
import type { AppConfig, SttProviderId, TranscriptionResult } from "./types.js";

export interface TranscribeOptions {
  signal?: AbortSignal;
  onRetry?: RetryHooks["onRetry"];
}

export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttError";
  }
}

export async function transcribe(
  audioBlob: Blob,
  config: AppConfig,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  if (audioBlob.size === 0) {
    throw new SttError("Запись пустая. Попробуйте записать ещё раз.");
  }

  const provider = config.stt.provider;
  const endpoint = config.stt.endpoint.trim();
  if (endpoint === "") {
    throw new SttError("Не задан STT endpoint. Откройте настройки.");
  }

  const responseFormat = resolveResponseFormat(provider, config.stt.model);
  const optionalFields = hasOptionalFields(config);
  const policy = retryPolicy(config);

  try {
    let response: { status: number; text: string };
    try {
      response = await sendRequest({
        audioBlob,
        config,
        endpoint,
        responseFormat,
        includeOptional: true,
        policy,
        options,
      });
    } catch (error) {
      if (error instanceof HttpError && error.status === 400 && optionalFields) {
        response = await sendRequest({
          audioBlob,
          config,
          endpoint,
          responseFormat,
          includeOptional: false,
          policy,
          options,
        });
      } else {
        throw error;
      }
    }

    const text = parseTranscription(response.text, responseFormat);
    if (text === "") {
      throw new SttError("Пустая расшифровка. Проверьте микрофон и попробуйте ещё раз.");
    }
    return { text, provider, model: config.stt.model };
  } catch (error) {
    if (error instanceof AbortError) {
      throw error;
    }
    if (error instanceof SttError) {
      throw error;
    }
    throw formatSttError(error);
  }
}

export function buildFormData(
  audioBlob: Blob,
  config: AppConfig,
  includeOptional = true,
): FormData {
  const formData = new FormData();
  formData.append("file", audioBlob, audioFileName(audioBlob.type));
  formData.append("model", config.stt.model);
  formData.append("response_format", resolveResponseFormat(config.stt.provider, config.stt.model));

  if (includeOptional) {
    const language = config.stt.language.trim();
    if (language !== "") {
      formData.append("language", language);
    }
    const prompt = config.stt.prompt.trim();
    if (prompt !== "") {
      formData.append("prompt", prompt);
    }
    formData.append("temperature", String(config.stt.temperature));
  }
  return formData;
}

export function parseTranscription(raw: string, responseFormat: "text" | "json"): string {
  const text = raw.replace(/^﻿/, "").trim();
  if (text === "") {
    return "";
  }
  if (responseFormat === "text") {
    return text;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed.text === "string") {
      return parsed.text.trim();
    }
    if (typeof parsed === "string") {
      return parsed.trim();
    }
  } catch {
    // Some custom proxies ignore response_format and return plain text.
  }
  return text;
}

export function resolveResponseFormat(provider: SttProviderId, model: string): "text" | "json" {
  if (provider === "custom") {
    return "json";
  }
  if (provider === "openai" && model.startsWith("gpt-4o")) {
    return "json";
  }
  return "text";
}

export function audioFileName(mimeType: string): string {
  if (mimeType.includes("mp4")) {
    return "audio.mp4";
  }
  if (mimeType.includes("ogg")) {
    return "audio.ogg";
  }
  if (mimeType.includes("wav")) {
    return "audio.wav";
  }
  return "audio.webm";
}

export function retryPolicy(config: AppConfig): RetryPolicy {
  return {
    maxAttempts: config.retry.maxAttempts,
    baseDelayMs: config.retry.baseDelayMs,
    maxDelayMs: config.retry.maxDelayMs,
  };
}

export function formatSttError(error: unknown): Error {
  if (error instanceof HttpError) {
    const detail = error.body.trim();
    switch (error.status) {
      case 0:
        return new SttError(`Не удалось связаться со STT: ${error.message}`);
      case 400:
        return new SttError(`STT отклонил запрос: ${shorten(detail) || error.message}`);
      case 401:
      case 403:
        return new SttError("Неверный или просроченный API-ключ STT. Проверьте настройки.");
      case 404:
        return new SttError("STT endpoint не найден (404). Проверьте URL в настройках.");
      case 413:
        return new SttError("Аудиофайл слишком большой для STT.");
      case 429:
        return new SttError("Слишком много запросов к STT. Подождите и повторите.");
      default:
        if (error.status >= 500) {
          return new SttError("Сервер STT временно недоступен. Попробуйте позже.");
        }
        return new SttError(`Ошибка STT (${error.status}): ${shorten(detail) || error.message}`);
    }
  }
  if (error instanceof Error) {
    return new SttError(error.message);
  }
  return new SttError("Неизвестная ошибка STT");
}

function hasOptionalFields(config: AppConfig): boolean {
  return (
    config.stt.language.trim() !== "" ||
    config.stt.prompt.trim() !== "" ||
    config.stt.temperature !== 0
  );
}

interface SendRequestArgs {
  audioBlob: Blob;
  config: AppConfig;
  endpoint: string;
  responseFormat: "text" | "json";
  includeOptional: boolean;
  policy: RetryPolicy;
  options: TranscribeOptions;
}

async function sendRequest(args: SendRequestArgs): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = {};
  const apiKey = args.config.stt.apiKey.trim();
  if (apiKey !== "") {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await httpRequest(
    {
      method: "POST",
      url: args.endpoint,
      headers,
      data: buildFormData(args.audioBlob, args.config, args.includeOptional),
      timeoutMs: 60_000,
      signal: args.options.signal,
    },
    args.policy,
    { onRetry: args.options.onRetry },
  );
  return { status: response.status, text: response.text };
}

function shorten(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
