import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  audioFromFailure,
  audioToArrayBuffer,
  clearFailures,
  estimateStorage,
  getFailure,
  getLatestFailure,
  isStorageAvailable,
  listFailures,
  pruneFailures,
  removeFailure,
  requestPersistence,
  saveFailure,
  updateFailure,
} from "../src/storage.js";
import type { FailedDictation } from "../src/types.js";

function record(id: string, createdAt = Date.now()): FailedDictation {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    target: "composer",
    stage: "stt",
    error: "boom",
    attempts: 1,
  };
}

beforeEach(async () => {
  await clearFailures();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("failure storage", () => {
  it("reports IndexedDB availability", () => {
    expect(isStorageAvailable()).toBe(true);
  });

  it("saves, reads and lists records newest first", async () => {
    const base = Date.now() - 10_000;
    await saveFailure(record("a", base));
    await saveFailure(record("b", base + 3000));
    await saveFailure(record("c", base + 2000));

    expect(await getFailure("b")).toMatchObject({ id: "b", createdAt: base + 3000 });
    expect(await getFailure("missing")).toBeNull();
    expect((await listFailures()).map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(await getLatestFailure()).toMatchObject({ id: "b" });
  });

  it("updates an existing record and returns null for a missing one", async () => {
    const base = Date.now() - 10_000;
    await saveFailure(record("a", base));
    const updated = await updateFailure("a", { stage: "llm", rawText: "raw" });
    expect(updated).toMatchObject({ id: "a", stage: "llm", rawText: "raw", createdAt: base });
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(base);
    expect(await updateFailure("missing", { stage: "llm" })).toBeNull();
  });

  it("removes records and clears the store", async () => {
    await saveFailure(record("a"));
    await saveFailure(record("b"));
    await removeFailure("a");
    expect(await getFailure("a")).toBeNull();
    expect(await listFailures()).toHaveLength(1);
    await clearFailures();
    expect(await listFailures()).toEqual([]);
    expect(await getLatestFailure()).toBeNull();
  });

  it("keeps only the five newest records", async () => {
    const base = Date.now() - 10_000;
    for (let index = 0; index < 7; index++) {
      await saveFailure(record(`r${index}`, base + index));
    }
    const items = await listFailures();
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.id)).toEqual(["r6", "r5", "r4", "r3", "r2"]);
  });

  it("prunes stale records older than seven days", async () => {
    const now = Date.now();
    await saveFailure(record("old", now - 8 * 24 * 60 * 60 * 1000));
    await saveFailure(record("fresh", now));
    await pruneFailures();
    expect((await listFailures()).map((item) => item.id)).toEqual(["fresh"]);
  });
});

describe("audio conversion", () => {
  it("converts a Blob to an ArrayBuffer and back", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const buffer = await audioToArrayBuffer(blob);
    expect(buffer.byteLength).toBe(3);
    const failed = { ...record("a"), audio: buffer, audioMimeType: "audio/webm" };
    const restored = audioFromFailure(failed);
    expect(restored).toBeInstanceOf(Blob);
    expect(restored?.type).toBe("audio/webm");
    expect(restored?.size).toBe(3);
  });

  it("returns null when audio is missing", () => {
    expect(audioFromFailure(record("a"))).toBeNull();
    expect(audioFromFailure({ ...record("a"), audio: new ArrayBuffer(1) })).toBeNull();
    expect(audioFromFailure({ ...record("a"), audioMimeType: "audio/webm" })).toBeNull();
  });
});

describe("storage diagnostics", () => {
  it("reports IndexedDB estimate and persistence when available", async () => {
    const storage = {
      estimate: vi.fn(async () => ({ usage: 10, quota: 1000 })),
      persisted: vi.fn(async () => true),
      persist: vi.fn(async () => true),
    };
    Object.defineProperty(navigator, "storage", { value: storage, configurable: true });

    const estimate = await estimateStorage();
    expect(estimate).toEqual({ available: true, usage: 10, quota: 1000, persisted: true });
    expect(await requestPersistence()).toBe(true);
    expect(await requestPersistence()).toBe(false);
  });

  it("survives a storage estimate failure", async () => {
    const storage = {
      estimate: vi.fn(async () => {
        throw new Error("nope");
      }),
      persisted: vi.fn(async () => false),
      persist: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
    const estimate = await estimateStorage();
    expect(estimate).toEqual({
      available: true,
      usage: undefined,
      quota: undefined,
      persisted: undefined,
    });

    vi.resetModules();
    const fresh = await import("../src/storage.js");
    expect(await fresh.requestPersistence()).toBe(false);
  });
});

describe("memory fallback without IndexedDB", () => {
  it("stores, prunes and clears records in memory", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", undefined);
    const memory = await import("../src/storage.js");

    expect(memory.isStorageAvailable()).toBe(false);
    for (let index = 0; index < 7; index++) {
      await memory.saveFailure(record(`m${index}`, 1000 + index));
    }
    expect((await memory.listFailures()).map((item) => item.id)).toEqual([
      "m6",
      "m5",
      "m4",
      "m3",
      "m2",
    ]);
    await memory.updateFailure("m6", { stage: "insert" });
    expect(await memory.getFailure("m6")).toMatchObject({ stage: "insert" });
    await memory.removeFailure("m6");
    expect(await memory.getFailure("m6")).toBeNull();
    await memory.clearFailures();
    expect(await memory.listFailures()).toEqual([]);

    const estimate = await memory.estimateStorage();
    expect(estimate.available).toBe(false);
  });
});
