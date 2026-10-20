import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AbortError,
  HttpError,
  computeDelay,
  extractErrorMessage,
  httpRequest,
  isAbortError,
  isRetryableStatus,
  parseRetryAfterMs,
  requestOnce,
  sleep,
} from "../src/http.js";
import { __getRequests, __setXmlhttpResponder } from "./__mocks__/$/index.js";

const fastPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1,
  maxDelayMs: 2,
  sleep: async () => {},
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpRequest", () => {
  it("resolves a 2xx response", async () => {
    __setXmlhttpResponder(() => ({
      status: 200,
      statusText: "OK",
      responseText: "hello",
      responseHeaders: "x-test: 1",
      finalUrl: "https://example.com/final",
    }));
    const response = await httpRequest(
      { url: "https://example.com", method: "POST", headers: { "X-Test": "1" } },
      fastPolicy,
    );
    expect(response).toEqual({
      status: 200,
      statusText: "OK",
      text: "hello",
      headers: "x-test: 1",
      finalUrl: "https://example.com/final",
    });
    const request = __getRequests()[0];
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({ "X-Test": "1" });
    expect(request?.timeout).toBe(60_000);
  });

  it("retries retryable statuses and then succeeds", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return calls < 3
        ? { status: 503, responseText: "busy" }
        : { status: 200, responseText: "ok" };
    });
    const onRetry = vi.fn();
    const response = await httpRequest({ url: "https://example.com" }, fastPolicy, { onRetry });
    expect(response.text).toBe("ok");
    expect(calls).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0]?.[1]).toBe(1);
  });

  it("does not retry a 400 response", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return { status: 400, responseText: '{"error":{"message":"bad request"}}' };
    });
    await expect(httpRequest({ url: "https://example.com" }, fastPolicy)).rejects.toMatchObject({
      status: 400,
      retryable: false,
      message: "bad request",
    });
    expect(calls).toBe(1);
  });

  it("throws the last retryable error after max attempts", async () => {
    __setXmlhttpResponder(() => ({ status: 500, responseText: "down" }));
    await expect(
      httpRequest({ url: "https://example.com" }, { ...fastPolicy, maxAttempts: 2 }),
    ).rejects.toMatchObject({ status: 500, body: "down" });
    expect(__getRequests()).toHaveLength(2);
  });

  it("uses Retry-After from headers", async () => {
    __setXmlhttpResponder(() => ({
      status: 429,
      responseText: "slow down",
      responseHeaders: "Retry-After: 0.01",
    }));
    const sleepFn = vi.fn(async () => {});
    await expect(
      httpRequest(
        { url: "https://example.com" },
        { ...fastPolicy, maxDelayMs: 1000, sleep: sleepFn },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(sleepFn).toHaveBeenCalledWith(10, undefined);
  });

  it("retries network errors", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return calls === 1 ? { error: "offline" } : { status: 200, responseText: "ok" };
    });
    const response = await httpRequest({ url: "https://example.com" }, fastPolicy);
    expect(response.text).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries timeouts", async () => {
    let calls = 0;
    __setXmlhttpResponder(() => {
      calls += 1;
      return calls === 1 ? { timeout: true } : { status: 200, responseText: "ok" };
    });
    const response = await httpRequest({ url: "https://example.com" }, fastPolicy);
    expect(response.text).toBe("ok");
    expect(calls).toBe(2);
  });

  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestOnce({ url: "https://example.com", signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortError);
    expect(__getRequests()).toHaveLength(0);
  });

  it("aborts an in-flight request and calls the GM abort handle", async () => {
    __setXmlhttpResponder(() => ({ status: 200, responseText: "late", delayMs: 10 }));
    const controller = new AbortController();
    const promise = httpRequest(
      { url: "https://example.com", signal: controller.signal },
      fastPolicy,
    );
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(AbortError);
    expect(isAbortError(new AbortError())).toBe(true);
    expect(isAbortError(new Error("AbortError"))).toBe(false);
  });

  it("does not retry an aborted request", async () => {
    __setXmlhttpResponder(() => ({ status: 200, responseText: "late", delayMs: 5 }));
    const controller = new AbortController();
    const promise = httpRequest(
      { url: "https://example.com", signal: controller.signal },
      { ...fastPolicy, maxAttempts: 5 },
    );
    setTimeout(() => controller.abort(), 0);
    await expect(promise).rejects.toBeInstanceOf(AbortError);
    expect(__getRequests()).toHaveLength(1);
  });
});

describe("status and headers helpers", () => {
  it("marks only transient statuses as retryable", () => {
    for (const status of [408, 425, 429, 500, 502, 599]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 422, 499]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  it("parses Retry-After as seconds or a date", () => {
    expect(parseRetryAfterMs("Retry-After: 2")).toBe(2000);
    expect(parseRetryAfterMs("retry-after: 0")).toBe(0);
    expect(parseRetryAfterMs("x: y")).toBeUndefined();
    expect(parseRetryAfterMs("Retry-After: soon")).toBeUndefined();
    const future = new Date(Date.now() + 5000).toUTCString();
    const parsed = parseRetryAfterMs(`Retry-After: ${future}`);
    expect(parsed).toBeGreaterThan(3000);
    expect(parsed).toBeLessThanOrEqual(5000);
  });

  it("extracts messages from JSON, nested errors, strings and plain text", () => {
    expect(extractErrorMessage(400, '{"message":"direct"}')).toBe("direct");
    expect(extractErrorMessage(400, '{"error":{"message":"nested"}}')).toBe("nested");
    expect(extractErrorMessage(400, '{"error":"string error"}')).toBe("string error");
    expect(extractErrorMessage(400, "plain text")).toBe("plain text");
    expect(extractErrorMessage(400, "x".repeat(300))).toBe("HTTP 400");
    expect(extractErrorMessage(400, "")).toBe("HTTP 400");
  });

  it("caps computed delays and honours Retry-After", () => {
    const retryAfter = new HttpError(429, "slow", true, "", 50);
    expect(computeDelay(retryAfter, 3, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 20 })).toBe(
      20,
    );
    vi.spyOn(Math, "random").mockReturnValue(0);
    const error = new HttpError(500, "down", true);
    expect(computeDelay(error, 1, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 10_000 })).toBe(
      50,
    );
    expect(computeDelay(error, 3, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 })).toBe(
      200,
    );
  });

  it("sleep resolves and can be aborted", async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(AbortError);
    const aborted = new AbortController();
    aborted.abort();
    await expect(sleep(10, aborted.signal)).rejects.toBeInstanceOf(AbortError);
  });
});
