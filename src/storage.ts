import { t } from "./i18n.js";
import type { FailedDictation } from "./types.js";

const DB_NAME = "opencode-voice-dictation";
const STORE_NAME = "failures";
const DB_VERSION = 1;
const MAX_RECORDS = 5;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StorageEstimate {
  available: boolean;
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let persistenceRequested = false;
const memoryStore = new Map<string, FailedDictation>();

export function isStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function requestPersistence(): Promise<boolean> {
  if (persistenceRequested) {
    return false;
  }
  persistenceRequested = true;
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore
  }
  return false;
}

export async function saveFailure(record: FailedDictation): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryStore.set(record.id, record);
    pruneMemory();
    return;
  }
  try {
    await putRecord(db, record);
  } catch (error) {
    if (isQuotaError(error)) {
      await deleteOldest(db);
      await putRecord(db, record);
      return;
    }
    throw error;
  }
  await pruneFailures();
}

export async function getFailure(id: string): Promise<FailedDictation | null> {
  const db = await getDb();
  if (!db) {
    return memoryStore.get(id) ?? null;
  }
  const tx = db.transaction(STORE_NAME, "readonly");
  const request = tx.objectStore(STORE_NAME).get(id);
  const result = await requestToPromise<FailedDictation | undefined>(request);
  return result ?? null;
}

export async function getLatestFailure(): Promise<FailedDictation | null> {
  const all = await listFailures();
  return all[0] ?? null;
}

export async function listFailures(): Promise<FailedDictation[]> {
  const db = await getDb();
  if (!db) {
    return [...memoryStore.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  const tx = db.transaction(STORE_NAME, "readonly");
  const request = tx.objectStore(STORE_NAME).getAll();
  const records = await requestToPromise<FailedDictation[]>(request);
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateFailure(
  id: string,
  patch: Partial<FailedDictation>,
): Promise<FailedDictation | null> {
  const current = await getFailure(id);
  if (!current) {
    return null;
  }
  const updated: FailedDictation = { ...current, ...patch, id, updatedAt: Date.now() };
  await saveFailure(updated);
  return updated;
}

export async function removeFailure(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryStore.delete(id);
    return;
  }
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  await transactionDone(tx);
}

export async function clearFailures(): Promise<void> {
  memoryStore.clear();
  const db = await getDb();
  if (!db) {
    return;
  }
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  await transactionDone(tx);
}

export async function pruneFailures(): Promise<void> {
  const records = await listFailures();
  const now = Date.now();
  const stale = records.filter((record) => now - record.createdAt > MAX_AGE_MS);
  const overflow = records.slice(MAX_RECORDS);
  for (const record of [...stale, ...overflow]) {
    await removeFailure(record.id);
  }
}

export async function estimateStorage(): Promise<StorageEstimate> {
  const available = isStorageAvailable() && (await getDb()) !== null;
  let usage: number | undefined;
  let quota: number | undefined;
  let persisted: boolean | undefined;
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage;
      quota = estimate.quota;
    }
    if (typeof navigator !== "undefined" && navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted();
    }
  } catch {
    // ignore
  }
  return { available, usage, quota, persisted };
}

export async function audioToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error(t("storage.readAudioFailed")));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error(t("storage.readAudioFailed")));
    reader.readAsArrayBuffer(blob);
  });
}

export function audioFromFailure(record: FailedDictation): Blob | null {
  if (!record.audio || !record.audioMimeType) {
    return null;
  }
  return new Blob([record.audio], { type: record.audioMimeType });
}

async function getDb(): Promise<IDBDatabase | null> {
  if (!isStorageAvailable()) {
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDb().catch(() => null);
  }
  return dbPromise;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(t("storage.openFailed")));
    request.onblocked = () => reject(new Error(t("storage.blocked")));
  });
}

function putRecord(db: IDBDatabase, record: FailedDictation): Promise<void> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(record);
  return transactionDone(tx);
}

async function deleteOldest(db: IDBDatabase): Promise<void> {
  const records = await listFailures();
  const oldest = records[records.length - 1];
  if (oldest) {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(oldest.id);
    await transactionDone(tx);
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(t("storage.error")));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(t("storage.txError")));
    tx.onabort = () => reject(tx.error ?? new Error(t("storage.txAborted")));
  });
}

function isQuotaError(error: unknown): boolean {
  return error instanceof Error && /quota/i.test(error.name);
}

function pruneMemory(): void {
  const records = [...memoryStore.values()].sort((a, b) => b.createdAt - a.createdAt);
  for (const record of records.slice(MAX_RECORDS)) {
    memoryStore.delete(record.id);
  }
}
