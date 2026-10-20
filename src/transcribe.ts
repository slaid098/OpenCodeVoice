import { resolveSttEndpoint, resolveSttModel } from "./config.js";
import { AbortError, HttpError, type RetryHooks, type RetryPolicy, httpRequest } from "./http.js";
import { t } from "./i18n.js";
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
    throw new SttError(t("stt.emptyRecording"));
  }

  const provider = config.stt.provider;
  const endpoint = resolveSttEndpoint(config.stt);
  if (endpoint === "") {
    throw new SttError(t("stt.noEndpoint"));
  }
  const model = resolveSttModel(config.stt);

  const responseFormat = resolveResponseFormat(provider, model);
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
      throw new SttError(t("stt.emptyTranscript"));
    }
    return { text, provider, model };
  } catch (error) {
    if (error instanceof AbortError) {
      throw error;
    }
    if (error instanceof SttError) {
      throw error;
    }
    throw formatSttError(error, { endpoint, provider });
  }
}

export function buildFormData(
  audioBlob: Blob,
  config: AppConfig,
  includeOptional = true,
): FormData {
  const formData = new FormData();
  formData.append("file", audioBlob, audioFileName(audioBlob.type));
  const model = resolveSttModel(config.stt);
  formData.append("model", model);
  formData.append("response_format", resolveResponseFormat(config.stt.provider, model));

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

export function resolveResponseFormat(provider: SttProviderId, _model: string): "text" | "json" {
  return provider === "custom" ? "json" : "text";
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

const KEY_ERROR_PATTERNS = [
  "invalid api key",
  "invalid_api_key",
  "incorrect api key",
  "unauthorized",
];

const REGION_ERROR_PATTERNS = [
  "unsupported_country_region_territory",
  "country, region, or territory not supported",
  "not available in your country",
  "region is not supported",
  "unsupported region",
  "unsupported country",
];

function hasKeyError(body: string): boolean {
  const text = body.toLowerCase();
  return KEY_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

/** A 403/451 that comes from a regional block, not from a bad API key. */
export function isSttRegionBlock(status: number, body: string, endpoint?: string): boolean {
  if (status !== 403 && status !== 451) {
    return false;
  }
  const text = body.toLowerCase();
  if (hasKeyError(text)) {
    return false;
  }
  if (REGION_ERROR_PATTERNS.some((pattern) => text.includes(pattern))) {
    return true;
  }
  if (status === 451) {
    return true;
  }
  const host = hostOf(endpoint);
  return (host === "api.groq.com" || host === "api.openai.com") && text.includes("forbidden");
}

function hostOf(endpoint: string | undefined): string {
  if (!endpoint) {
    return "";
  }
  try {
    return new URL(endpoint).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function formatSttError(
  error: unknown,
  context: { endpoint?: string; provider?: SttProviderId } = {},
): Error {
  if (error instanceof HttpError) {
    const detail = error.body.trim();
    switch (error.status) {
      case 0:
        return new SttError(t("stt.network", { message: error.message }));
      case 400:
        return new SttError(t("stt.rejected", { detail: shorten(detail) || error.message }));
      case 401:
        return new SttError(t("stt.invalidKey"));
      case 403:
        if (hasKeyError(detail)) {
          return new SttError(t("stt.invalidKey"));
        }
        if (isSttRegionBlock(error.status, detail, context.endpoint)) {
          return new SttError(t("stt.regionBlocked"));
        }
        return new SttError(t("stt.forbidden"));
      case 404:
        return new SttError(t("stt.notFound"));
      case 413:
        return new SttError(t("stt.tooLarge"));
      case 429:
        return new SttError(t("stt.rateLimited"));
      case 451:
        return new SttError(t("stt.regionBlocked"));
      default:
        if (error.status >= 500) {
          return new SttError(t("stt.unavailable"));
        }
        return new SttError(
          t("stt.httpError", { status: error.status, detail: shorten(detail) || error.message }),
        );
    }
  }
  if (error instanceof Error) {
    return new SttError(error.message);
  }
  return new SttError(t("stt.unknown"));
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
