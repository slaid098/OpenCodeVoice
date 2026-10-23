import { resolveSttEndpoint } from "./config.js";
import { HttpError, httpRequest, type RetryPolicy } from "./http.js";
import { t } from "./i18n.js";
import { joinOpenAiEndpoint } from "./llm.js";
import { isSttRegionBlock, retryPolicy } from "./transcribe.js";
import type { AppConfig, ModelInfo } from "./types.js";

export class ModelsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelsError";
  }
}

export class ModelsUnsupportedError extends ModelsError {
  constructor(message = t("models.unsupported")) {
    super(message);
    this.name = "ModelsUnsupportedError";
  }
}

export async function listSttModels(config: AppConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const url = sttModelsUrl(resolveSttEndpoint(config.stt));
  const headers = authHeaders(config.stt.apiKey);
  const payload = await fetchJson(url, headers, retryPolicy(config), signal);
  const ids = extractOpenAiIds(payload);
  if (ids.length === 0) {
    throw new ModelsError(t("models.empty"));
  }
  return sortSttModels(ids);
}

export async function listLlmModels(config: AppConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  if (config.llm.provider === "custom-openai") {
    const url = joinOpenAiEndpoint(config.llm.baseUrl, "models");
    const payload = await fetchJson(
      url,
      authHeaders(config.llm.apiKey),
      retryPolicy(config),
      signal,
    );
    const ids = extractOpenAiIds(payload);
    if (ids.length === 0) {
      throw new ModelsError(t("models.empty"));
    }
    return ids.map(toModelInfo);
  }

  const base = config.llm.baseUrl.trim().replace(/\/+$/, "");
  const url = `${base}/api/tags`;
  const payload = await fetchJson(url, authHeaders(config.llm.apiKey), retryPolicy(config), signal);
  const names = extractOllamaNames(payload);
  if (names.length === 0) {
    throw new ModelsError(t("models.ollamaEmpty"));
  }
  return names.map(toModelInfo);
}

export function sttModelsUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/audio/transcriptions")) {
    return `${trimmed.slice(0, -"/audio/transcriptions".length)}/models`;
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/models`;
  }
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash > 0) {
    return `${trimmed.slice(0, lastSlash)}/models`;
  }
  return `${trimmed}/models`;
}

export function extractOpenAiIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }
  return payload.data
    .map((item) => {
      if (isRecord(item) && typeof item.id === "string") {
        return item.id;
      }
      return "";
    })
    .filter((id) => id !== "");
}

export function extractOllamaNames(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    return [];
  }
  return payload.models
    .map((item) => {
      if (isRecord(item)) {
        if (typeof item.name === "string") {
          return item.name;
        }
        if (typeof item.model === "string") {
          return item.model;
        }
      }
      return "";
    })
    .filter((name) => name !== "");
}

function sortSttModels(ids: string[]): ModelInfo[] {
  const score = (id: string): number => {
    if (/whisper-large-v3-turbo/i.test(id)) return 0;
    if (/whisper-large-v3/i.test(id)) return 1;
    if (/whisper|transcribe/i.test(id)) return 2;
    return 3;
  };
  return ids.map(toModelInfo).sort((a, b) => score(a.id) - score(b.id) || a.id.localeCompare(b.id));
}

function toModelInfo(id: string): ModelInfo {
  return { id, label: id };
}

function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  return key === "" ? {} : { Authorization: `Bearer ${key}` };
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  policy: RetryPolicy,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const response = await httpRequest(
      { method: "GET", url, headers, timeoutMs: 15_000, signal },
      { ...policy, maxAttempts: Math.min(2, policy.maxAttempts) },
    );
    try {
      return JSON.parse(response.text);
    } catch {
      throw new ModelsError(t("models.invalidJson"));
    }
  } catch (error) {
    if (error instanceof HttpError) {
      const body = error.body ?? "";
      if (error.status === 404 || error.status === 405) {
        throw new ModelsUnsupportedError();
      }
      if (error.status === 401) {
        throw new ModelsError(t("models.invalidKey"));
      }
      if (isSttRegionBlock(error.status, body, url)) {
        throw new ModelsError(t("models.regionBlocked"));
      }
      if (error.status === 403) {
        throw new ModelsError(t("models.forbidden"));
      }
      if (error.status === 0) {
        throw new ModelsError(t("models.network", { message: error.message }));
      }
      throw new ModelsError(t("models.httpError", { status: error.status }));
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
