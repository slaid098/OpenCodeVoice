import { GM_xmlhttpRequest, type GmAbortHandle } from "$";
import { t } from "./i18n.js";

export interface HttpRequestOptions {
  method?: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  data?: BodyInit;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  text: string;
  headers: string;
  finalUrl: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly body: string;

  constructor(
    status: number,
    message: string,
    retryable: boolean,
    body = "",
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryable = retryable;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

export class AbortError extends Error {
  constructor(message = t("http.aborted")) {
    super(message);
    this.name = "AbortError";
  }
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RetryHooks {
  onRetry?: (error: HttpError, attempt: number, delayMs: number) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function httpRequest(
  options: HttpRequestOptions,
  policy: RetryPolicy,
  hooks: RetryHooks = {},
): Promise<HttpResponse> {
  const maxAttempts = Math.max(1, policy.maxAttempts);
  let lastError: HttpError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestOnce(options);
    } catch (error) {
      if (error instanceof AbortError) {
        throw error;
      }
      if (!(error instanceof HttpError)) {
        throw error;
      }
      lastError = error;
      if (!error.retryable || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = computeDelay(error, attempt, policy);
      hooks.onRetry?.(error, attempt, delayMs);
      await (policy.sleep ?? sleep)(delayMs, options.signal);
    }
  }

  throw lastError ?? new HttpError(0, t("http.failed"), false);
}

export function requestOnce(options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise<HttpResponse>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new AbortError());
      return;
    }

    let handle: GmAbortHandle | null = null;
    let abortedBeforeHandle = false;
    let settled = false;

    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (handle) {
        handle.abort();
      } else {
        abortedBeforeHandle = true;
      }
      reject(new AbortError());
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    handle = GM_xmlhttpRequest({
      method: options.method ?? "GET",
      url: options.url,
      headers: options.headers,
      data: options.data,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onload: (response) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (response.status >= 200 && response.status < 300) {
          resolve({
            status: response.status,
            statusText: response.statusText,
            text: response.responseText,
            headers: response.responseHeaders,
            finalUrl: response.finalUrl,
          });
          return;
        }
        reject(
          new HttpError(
            response.status,
            extractErrorMessage(response.status, response.responseText),
            isRetryableStatus(response.status),
            response.responseText,
            parseRetryAfterMs(response.responseHeaders),
          ),
        );
      },
      onerror: (event) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(
          new HttpError(
            0,
            t("http.network", { message: event.error || t("http.noConnection") }),
            true,
          ),
        );
      },
      ontimeout: () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new HttpError(0, t("http.timeout"), true));
      },
      onabort: () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new AbortError());
      },
    });

    if (abortedBeforeHandle) {
      handle.abort();
    }
  });
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function parseRetryAfterMs(headers: string): number | undefined {
  const match = /retry-after\s*:\s*([^\r\n]+)/i.exec(headers);
  if (!match) {
    return undefined;
  }
  const value = match[1]?.trim();
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

export function extractErrorMessage(status: number, body: string): string {
  const text = body.trim();
  if (text !== "") {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) {
        const direct = parsed.message;
        if (typeof direct === "string" && direct !== "") {
          return direct;
        }
        const nested = parsed.error;
        if (isRecord(nested) && typeof nested.message === "string" && nested.message !== "") {
          return nested.message;
        }
        if (typeof nested === "string" && nested !== "") {
          return nested;
        }
      }
    } catch {
      // not JSON — use a short plain-text excerpt
      if (text.length <= 200) {
        return text;
      }
    }
  }
  return `HTTP ${status}`;
}

export function computeDelay(error: HttpError, attempt: number, policy: RetryPolicy): number {
  if (error.retryAfterMs !== undefined) {
    return Math.min(policy.maxDelayMs, Math.max(0, error.retryAfterMs));
  }
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(policy.maxDelayMs, Math.round(exponential * jitter));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isAbortError(error: unknown): error is AbortError {
  return error instanceof AbortError || (error instanceof Error && error.name === "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
