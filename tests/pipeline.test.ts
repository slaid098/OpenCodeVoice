import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRecorder } from "../src/audio.js";
import { createDefaultConfig } from "../src/config.js";
import { AbortError } from "../src/http.js";
import type { ToastOptions } from "../src/pipeline.js";
import {
  createPipeline,
  type FailureStore,
  type PipelineDeps,
  type PipelineUi,
  type RecoveryActions,
} from "../src/pipeline.js";
import type {
  AppConfig,
  CleanupResult,
  FailedDictation,
  TranscriptionResult,
} from "../src/types.js";

interface ToastCall {
  message: string;
  options?: ToastOptions;
}

interface FakeUi {
  ui: PipelineUi;
  states: Array<{ phase: string; seconds?: number }>;
  toasts: ToastCall[];
  recoveries: Array<{ record: FailedDictation; actions: RecoveryActions }>;
  hideRecoveryCalls: number;
  settingsOpened: number;
}

function makeUi(): FakeUi {
  const states: FakeUi["states"] = [];
  const toasts: ToastCall[] = [];
  const recoveries: FakeUi["recoveries"] = [];
  const fake: FakeUi = {
    ui: {
      setState: (phase, seconds) => {
        states.push(seconds === undefined ? { phase } : { phase, seconds });
      },
      toast: (message, options) => {
        toasts.push({ message, options });
      },
      showRecovery: (record, actions) => {
        recoveries.push({ record, actions });
      },
      hideRecovery: () => {
        fake.hideRecoveryCalls += 1;
      },
      openSettings: () => {
        fake.settingsOpened += 1;
      },
    },
    states,
    toasts,
    recoveries,
    hideRecoveryCalls: 0,
    settingsOpened: 0,
  };
  return fake;
}

interface FakeStore extends FailureStore {
  records: Map<string, FailedDictation>;
  saves: number;
  removes: number;
  persistenceRequests: number;
}

function makeStore(): FakeStore {
  const records = new Map<string, FailedDictation>();
  const store: FakeStore = {
    records,
    saves: 0,
    removes: 0,
    persistenceRequests: 0,
    async save(record) {
      store.saves += 1;
      records.set(record.id, structuredClone(record));
    },
    async latest() {
      const items = [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
      return items[0] ?? null;
    },
    async remove(id) {
      store.removes += 1;
      records.delete(id);
    },
    async toArrayBuffer(blob) {
      return blob.arrayBuffer();
    },
    fromAudio(record) {
      if (!record.audio) {
        return null;
      }
      return new Blob([record.audio], { type: record.audioMimeType ?? "audio/webm" });
    },
    async requestPersistence() {
      store.persistenceRequests += 1;
      return true;
    },
  };
  return store;
}

interface FakeRecorder {
  recorder: AudioRecorder;
  starts: number;
  stops: number;
  cancels: number;
}

function makeRecorder(overrides: Partial<AudioRecorder> = {}): FakeRecorder {
  const state: FakeRecorder = {
    recorder: {
      async start() {
        state.starts += 1;
      },
      async stop() {
        state.stops += 1;
        return {
          blob: new Blob(["audio-bytes"], { type: "audio/webm" }),
          mimeType: "audio/webm",
          durationMs: 1200,
        };
      },
      cancel() {
        state.cancels += 1;
      },
      isRecording: () => true,
    },
    starts: 0,
    stops: 0,
    cancels: 0,
  };
  Object.assign(state.recorder, overrides);
  return state;
}

interface Harness {
  pipeline: ReturnType<typeof createPipeline>;
  config: AppConfig;
  store: FakeStore;
  ui: FakeUi;
  recorder: FakeRecorder;
  transcribe: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
  insertText: ReturnType<typeof vi.fn>;
  replaceText: ReturnType<typeof vi.fn>;
  submitPrompt: ReturnType<typeof vi.fn>;
  isSubmitBusy: ReturnType<typeof vi.fn>;
  isQuestionOpen: ReturnType<typeof vi.fn>;
  getSessionPath: ReturnType<typeof vi.fn>;
  rememberDraft: ReturnType<typeof vi.fn>;
  isDraftChanged: ReturnType<typeof vi.fn>;
}

function setup(overrides: Partial<PipelineDeps> = {}): Harness {
  const config = createDefaultConfig();
  const store = makeStore();
  const ui = makeUi();
  const recorder = makeRecorder();
  const transcribe = vi.fn(
    async (): Promise<TranscriptionResult> => ({
      text: "сырой текст",
      provider: "groq",
      model: "whisper-large-v3-turbo",
    }),
  );
  const cleanup = vi.fn(
    async (): Promise<CleanupResult> => ({
      text: "чистый текст",
      fallback: false,
      usedDefaultPrompt: false,
    }),
  );
  const insertText = vi.fn(() => true);
  const replaceText = vi.fn(() => true);
  const submitPrompt = vi.fn(() => true);
  const isSubmitBusy = vi.fn(() => false);
  const isQuestionOpen = vi.fn(() => true);
  const getSessionPath = vi.fn(() => "/server/local/session/a");
  const rememberDraft = vi.fn();
  const isDraftChanged = vi.fn(() => false);
  let counter = 0;

  const deps: PipelineDeps = {
    getConfig: () => config,
    createRecorder: () => recorder.recorder,
    transcribe,
    cleanup,
    insertText,
    replaceText,
    submitPrompt,
    isSubmitBusy,
    isQuestionOpen,
    getSessionPath,
    rememberDraft,
    isDraftChanged,
    store,
    ui: ui.ui,
    now: () => 1000,
    makeId: () => `id-${++counter}`,
    ...overrides,
  };

  return {
    pipeline: createPipeline(deps),
    config,
    store,
    ui,
    recorder,
    transcribe,
    cleanup,
    insertText,
    replaceText,
    submitPrompt,
    isSubmitBusy,
    isQuestionOpen,
    getSessionPath,
    rememberDraft,
    isDraftChanged,
  };
}

function phaseNames(ui: FakeUi): string[] {
  return ui.states.map((state) => state.phase);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pipeline happy path", () => {
  it("records, transcribes, cleans, inserts and submits", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    expect(h.pipeline.getState()).toBe("recording");
    expect(h.recorder.starts).toBe(1);
    expect(h.store.persistenceRequests).toBe(1);

    await h.pipeline.stop();

    expect(h.pipeline.getState()).toBe("idle");
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    expect(h.cleanup).toHaveBeenCalledWith("сырой текст", h.config, expect.any(Object));
    expect(h.insertText).toHaveBeenCalledWith("чистый текст", "composer");
    expect(h.submitPrompt).toHaveBeenCalledWith("composer");
    expect(h.store.records.size).toBe(0);
    expect(h.store.removes).toBe(1);
    expect(h.ui.hideRecoveryCalls).toBeGreaterThan(0);
    expect(h.ui.toasts.at(-1)?.message).toBe("Отправлено.");
    expect(phaseNames(h.ui)).toEqual(
      expect.arrayContaining(["recording", "stt", "llm", "insert", "submit", "idle"]),
    );
  });

  it("does not submit when auto-submit is off", async () => {
    const h = setup();
    h.config.behavior.autoSubmit = false;
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.insertText).toHaveBeenCalledWith("чистый текст", "composer");
    expect(h.submitPrompt).not.toHaveBeenCalled();
    expect(h.ui.toasts.at(-1)?.message).toBe("Текст вставлен.");
  });

  it("skips the LLM when cleanup is disabled", async () => {
    const h = setup();
    h.config.llm.enabled = false;
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.cleanup).not.toHaveBeenCalled();
    expect(h.insertText).toHaveBeenCalledWith("сырой текст", "composer");
    expect(h.submitPrompt).toHaveBeenCalled();
  });

  it("submits question prompts only when enabled", async () => {
    const h = setup();
    h.config.behavior.autoSubmitQuestion = false;
    await h.pipeline.start("question");
    await h.pipeline.stop();
    expect(h.insertText).toHaveBeenCalledWith("чистый текст", "question");
    expect(h.submitPrompt).not.toHaveBeenCalled();
    expect(h.store.records.size).toBe(0);
  });

  it("submits question prompts when the setting is on", async () => {
    const h = setup();
    h.config.behavior.autoSubmitQuestion = true;
    await h.pipeline.start("question");
    await h.pipeline.stop();
    expect(h.submitPrompt).toHaveBeenCalledWith("question");
  });

  it("falls back to the composer when the question closes", async () => {
    const h = setup();
    h.isQuestionOpen.mockReturnValue(false);
    await h.pipeline.start("question");
    await h.pipeline.stop();
    expect(h.insertText).toHaveBeenCalledWith("чистый текст", "question");
    expect(h.submitPrompt).toHaveBeenCalledWith("composer");
  });

  it("reports a fallback cleanup result and still inserts it", async () => {
    const h = setup();
    h.cleanup.mockResolvedValue({
      text: "сырой текст",
      fallback: true,
      reason: "refusal",
      usedDefaultPrompt: false,
    });
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.insertText).toHaveBeenCalledWith("сырой текст", "composer");
    expect(h.ui.toasts.some((toast) => /LLM отказался/.test(toast.message))).toBe(true);
  });

  it("warns when the default cleanup prompt was used", async () => {
    const h = setup();
    h.cleanup.mockResolvedValue({
      text: "чистый текст",
      fallback: false,
      usedDefaultPrompt: true,
    });
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.ui.toasts.some((toast) => /стандартный/.test(toast.message))).toBe(true);
  });

  it("requests persistence only once", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.store.persistenceRequests).toBe(1);
  });
});

describe("session guard", () => {
  it("remembers the session path and draft when recording starts", async () => {
    const h = setup();
    await h.pipeline.start("question");
    expect(h.getSessionPath).toHaveBeenCalled();
    expect(h.rememberDraft).toHaveBeenCalledWith("question");
    await h.pipeline.stop();
  });

  it("keeps the text when the session changed before insertion", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    h.getSessionPath.mockReturnValue("/server/local/session/b");
    await h.pipeline.stop();

    expect(h.insertText).not.toHaveBeenCalled();
    expect(h.submitPrompt).not.toHaveBeenCalled();
    const record = await h.store.latest();
    expect(record).toMatchObject({
      stage: "insert",
      originPath: "/server/local/session/a",
      cleanText: "чистый текст",
    });
    expect(h.ui.recoveries[0]?.record.stage).toBe("insert");
    expect(h.ui.toasts.some((toast) => /Сессия изменилась/.test(toast.message))).toBe(true);
    expect(h.pipeline.getState()).toBe("idle");
  });

  it("inserts and submits after the user returns to the original session", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    h.getSessionPath.mockReturnValue("/server/local/session/b");
    await h.pipeline.stop();
    expect(h.insertText).not.toHaveBeenCalled();

    h.getSessionPath.mockReturnValue("/server/local/session/a");
    await h.pipeline.retryLast();

    expect(h.insertText).toHaveBeenCalledWith("чистый текст", "composer");
    expect(h.submitPrompt).toHaveBeenCalledWith("composer");
    expect(h.store.records.size).toBe(0);
  });

  it("inserts the cleaned text from the recovery banner without inserting it twice", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    h.getSessionPath.mockReturnValue("/server/local/session/b");
    await h.pipeline.stop();
    h.getSessionPath.mockReturnValue("/server/local/session/a");

    h.ui.recoveries[0]?.actions.onInsertRaw?.();
    await vi.waitFor(() => {
      expect(h.insertText).toHaveBeenCalledWith("чистый текст", "composer");
    });

    const record = h.pipeline.getCurrentFailure();
    expect(record?.stage).toBe("submit");
    expect(record?.cleanText).toBe("чистый текст");
    expect(record?.rawInserted).toBe(true);
    await vi.waitFor(() => {
      expect(h.ui.recoveries.at(-1)?.actions.onSubmitRaw).toBeTypeOf("function");
    });
    expect(h.ui.recoveries.at(-1)?.actions.onInsertRaw).toBeUndefined();
  });

  it("does not submit when the session changes after insertion", async () => {
    const h = setup();
    h.insertText.mockImplementation(() => {
      h.getSessionPath.mockReturnValue("/server/local/session/b");
      return true;
    });
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    expect(h.insertText).toHaveBeenCalledTimes(1);
    expect(h.submitPrompt).not.toHaveBeenCalled();
    const record = await h.store.latest();
    expect(record?.stage).toBe("submit");
    expect(h.ui.toasts.some((toast) => /сессия изменилась/i.test(toast.message))).toBe(true);
  });

  it("does not insert raw fallback text into another session", async () => {
    const h = setup();
    h.cleanup.mockRejectedValue(new Error("LLM упал"));
    await h.pipeline.start("composer");
    h.getSessionPath.mockReturnValue("/server/local/session/b");
    await h.pipeline.stop();

    expect(h.insertText).not.toHaveBeenCalled();
    const record = await h.store.latest();
    expect(record?.stage).toBe("llm");
    expect(record?.rawInserted).toBeUndefined();
    expect(h.ui.toasts.some((toast) => /Сессия изменилась/.test(toast.message))).toBe(true);
    expect(h.ui.recoveries[0]?.actions.onInsertRaw).toBeTypeOf("function");
  });
});

describe("draft guard", () => {
  it("inserts but does not submit when the draft changed", async () => {
    const h = setup();
    h.isDraftChanged.mockReturnValue(true);
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    expect(h.isDraftChanged).toHaveBeenCalledWith("composer");
    expect(h.insertText).toHaveBeenCalledWith("чистый текст", "composer");
    expect(h.submitPrompt).not.toHaveBeenCalled();
    expect(h.ui.toasts.at(-1)?.message).toMatch(/изменили текст/);
    expect(h.store.records.size).toBe(0);
  });

  it("submits when the draft did not change", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.submitPrompt).toHaveBeenCalledWith("composer");
    expect(h.ui.toasts.at(-1)?.message).toBe("Отправлено.");
  });

  it("keeps the previous behavior when auto-submit is off", async () => {
    const h = setup();
    h.config.behavior.autoSubmit = false;
    h.isDraftChanged.mockReturnValue(true);
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.insertText).toHaveBeenCalled();
    expect(h.submitPrompt).not.toHaveBeenCalled();
    expect(h.ui.toasts.at(-1)?.message).toBe("Текст вставлен.");
  });
});

describe("pipeline failure recovery", () => {
  it("keeps audio when STT fails and retries from the saved blob", async () => {
    const h = setup();
    let fail = true;
    h.transcribe.mockImplementation(async () => {
      if (fail) {
        throw new Error("STT недоступен");
      }
      return { text: "после повтора", provider: "groq", model: "m" };
    });

    await h.pipeline.start("composer");
    await h.pipeline.stop();

    const record = await h.store.latest();
    expect(record).toMatchObject({ stage: "stt", error: "STT недоступен", attempts: 1 });
    expect(record?.audio).toBeInstanceOf(ArrayBuffer);
    expect(record?.audioMimeType).toBe("audio/webm");
    expect(h.pipeline.getState()).toBe("idle");
    expect(h.ui.recoveries).toHaveLength(1);
    expect(h.ui.recoveries[0]?.record.stage).toBe("stt");
    expect(h.ui.recoveries[0]?.actions.onInsertRaw).toBeUndefined();
    expect(h.ui.toasts.some((toast) => /Аудио сохранено/.test(toast.message))).toBe(true);

    fail = false;
    await h.pipeline.retryLast();

    expect(h.transcribe).toHaveBeenCalledTimes(2);
    expect(h.insertText).toHaveBeenCalledWith("чистый текст", "composer");
    expect(h.store.records.size).toBe(0);
  });

  it("warns when retrying STT without saved audio", async () => {
    const h = setup();
    h.config.behavior.saveFailedAudio = false;
    h.transcribe.mockRejectedValue(new Error("fail"));
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    const record = await h.store.latest();
    expect(record?.audio).toBeUndefined();
    h.ui.toasts.length = 0;
    await h.pipeline.retryLast();
    expect(h.ui.toasts.at(-1)?.message).toMatch(/Аудио не сохранилось/);
  });

  it("inserts raw text when cleanup fails and replaces it on retry", async () => {
    const h = setup();
    let fail = true;
    h.cleanup.mockImplementation(async () => {
      if (fail) {
        throw new Error("LLM упал");
      }
      return { text: "чистый текст", fallback: false, usedDefaultPrompt: false };
    });

    await h.pipeline.start("composer");
    await h.pipeline.stop();

    const record = await h.store.latest();
    expect(record).toMatchObject({ stage: "llm", rawInserted: true, rawText: "сырой текст" });
    expect(h.insertText).toHaveBeenCalledWith("сырой текст", "composer");
    expect(h.submitPrompt).not.toHaveBeenCalled();
    expect(h.ui.recoveries[0]?.actions.onSubmitRaw).toBeTypeOf("function");
    expect(h.ui.recoveries[0]?.actions.onInsertRaw).toBeUndefined();
    expect(h.ui.toasts.some((toast) => /вставлен сырой текст/.test(toast.message))).toBe(true);

    fail = false;
    await h.pipeline.retryLast();

    expect(h.replaceText).toHaveBeenCalledWith("чистый текст", "composer");
    expect(h.insertText).toHaveBeenCalledTimes(1);
    expect(h.submitPrompt).toHaveBeenCalledWith("composer");
    expect(h.store.records.size).toBe(0);
  });

  it("does not insert raw text when fallbackToRaw is off", async () => {
    const h = setup();
    h.config.behavior.fallbackToRaw = false;
    h.cleanup.mockRejectedValue(new Error("LLM упал"));
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    expect(h.insertText).not.toHaveBeenCalled();
    const actions = h.ui.recoveries[0]?.actions;
    expect(actions?.onInsertRaw).toBeTypeOf("function");
    expect(h.ui.toasts.some((toast) => /Очистка не удалась: LLM упал/.test(toast.message))).toBe(
      true,
    );
  });

  it("inserts raw text from the recovery action and submits it", async () => {
    const h = setup();
    h.config.behavior.fallbackToRaw = false;
    h.cleanup.mockRejectedValue(new Error("LLM упал"));
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    h.ui.recoveries[0]?.actions.onInsertRaw?.();
    await vi.waitFor(() => {
      expect(h.insertText).toHaveBeenCalledWith("сырой текст", "composer");
    });
    expect(h.pipeline.getCurrentFailure()?.rawInserted).toBe(true);
    await vi.waitFor(() => {
      expect(h.ui.recoveries.at(-1)?.actions.onSubmitRaw).toBeTypeOf("function");
    });

    const actions = h.ui.recoveries.at(-1)?.actions;
    actions?.onSubmitRaw?.();
    await vi.waitFor(() => {
      expect(h.submitPrompt).toHaveBeenCalledWith("composer");
    });
    await vi.waitFor(() => {
      expect(h.store.records.size).toBe(0);
    });
  });

  it("keeps the record when insertion fails and retries it", async () => {
    const h = setup();
    h.insertText.mockReturnValue(false);
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    const record = await h.store.latest();
    expect(record).toMatchObject({ stage: "insert", error: "Не удалось найти поле ввода." });
    expect(h.submitPrompt).not.toHaveBeenCalled();
    expect(h.ui.toasts.some((toast) => /Текст сохранён/.test(toast.message))).toBe(true);

    h.insertText.mockReturnValue(true);
    await h.pipeline.retryLast();
    expect(h.insertText).toHaveBeenCalledTimes(2);
    expect(h.submitPrompt).toHaveBeenCalled();
    expect(h.store.records.size).toBe(0);
  });

  it("does not insert the text twice when submission fails", async () => {
    const h = setup();
    h.submitPrompt.mockReturnValue(false);
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    const record = await h.store.latest();
    expect(record).toMatchObject({ stage: "submit" });
    expect(h.insertText).toHaveBeenCalledTimes(1);
    expect(h.ui.recoveries[0]?.record.stage).toBe("submit");

    h.submitPrompt.mockReturnValue(true);
    await h.pipeline.retryLast();
    expect(h.insertText).toHaveBeenCalledTimes(1);
    expect(h.submitPrompt).toHaveBeenCalledTimes(2);
    expect(h.store.records.size).toBe(0);
  });

  it("keeps the inserted text when the agent is still working", async () => {
    const h = setup();
    h.submitPrompt.mockReturnValue(false);
    h.isSubmitBusy.mockReturnValue(true);
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    expect(h.insertText).toHaveBeenCalledTimes(1);
    expect(h.ui.recoveries).toHaveLength(0);
    expect(h.ui.toasts.at(-1)?.message).toMatch(/Агент ещё работает/);
    expect(h.store.records.size).toBe(0);
  });

  it("warns when there is nothing to retry", async () => {
    const h = setup();
    await h.pipeline.retryLast();
    expect(h.ui.toasts.at(-1)?.message).toMatch(/Нет сохранённых/);
  });

  it("restores the latest failure on recover and forgets it", async () => {
    const h = setup();
    h.transcribe.mockRejectedValue(new Error("fail"));
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    const other = setup();
    await other.pipeline.recover();
    expect(other.ui.recoveries).toHaveLength(0);

    await h.pipeline.forget();
    expect(h.store.records.size).toBe(0);
    expect(h.pipeline.getCurrentFailure()).toBeNull();

    h.store.records.set("saved", {
      id: "saved",
      createdAt: 1,
      updatedAt: 1,
      target: "composer",
      stage: "stt",
      error: "x",
      attempts: 1,
    });
    await h.pipeline.recover();
    expect(h.ui.recoveries.at(-1)?.record.id).toBe("saved");
  });

  it("deletes the current failure from the recovery action", async () => {
    const h = setup();
    h.transcribe.mockRejectedValue(new Error("fail"));
    await h.pipeline.start("composer");
    await h.pipeline.stop();

    h.ui.recoveries[0]?.actions.onDelete?.();
    await vi.waitFor(() => {
      expect(h.store.records.size).toBe(0);
    });
    await vi.waitFor(() => {
      expect(h.pipeline.getCurrentFailure()).toBeNull();
    });
  });

  it("opens settings from the recovery action", async () => {
    const h = setup();
    h.transcribe.mockRejectedValue(new Error("fail"));
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    h.ui.recoveries[0]?.actions.onSettings?.();
    expect(h.ui.settingsOpened).toBe(1);
  });

  it("warns when draft persistence fails but continues", async () => {
    const h = setup();
    h.store.save = async () => {
      throw new Error("quota");
    };
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.ui.toasts.some((toast) => /Не удалось сохранить черновик/.test(toast.message))).toBe(
      true,
    );
    expect(h.submitPrompt).toHaveBeenCalled();
  });
});

describe("pipeline lifecycle", () => {
  it("cancels a recording", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    await h.pipeline.cancel();
    expect(h.recorder.cancels).toBe(1);
    expect(h.pipeline.getState()).toBe("idle");
    expect(h.store.records.size).toBe(0);
    expect(h.ui.toasts.at(-1)?.message).toBe("Отменено.");
  });

  it("cancels an in-flight STT and removes the draft", async () => {
    const h = setup();
    let resolveTranscribe: (value: TranscriptionResult) => void = () => {};
    h.transcribe.mockImplementation(
      () =>
        new Promise<TranscriptionResult>((resolve) => {
          resolveTranscribe = resolve;
        }),
    );
    await h.pipeline.start("composer");
    const stopping = h.pipeline.stop();
    await vi.waitFor(() => {
      expect(h.transcribe).toHaveBeenCalled();
    });
    expect(h.pipeline.getState()).toBe("stt");
    await h.pipeline.cancel();
    expect(h.pipeline.getState()).toBe("idle");
    expect(h.store.records.size).toBe(0);
    resolveTranscribe({ text: "late", provider: "groq", model: "m" });
    await stopping;
    expect(h.insertText).not.toHaveBeenCalled();
  });

  it("rejects concurrent processing actions with a toast", async () => {
    const h = setup();
    let resolveTranscribe: (value: TranscriptionResult) => void = () => {};
    h.transcribe.mockImplementation(
      () =>
        new Promise<TranscriptionResult>((resolve) => {
          resolveTranscribe = resolve;
        }),
    );
    await h.pipeline.start("composer");
    const stopping = h.pipeline.stop();
    await vi.waitFor(() => {
      expect(h.transcribe).toHaveBeenCalled();
    });
    expect(h.pipeline.getState()).toBe("stt");

    await h.pipeline.retryLast();
    await h.pipeline.toggle("composer");
    expect(h.ui.toasts.filter((toast) => /Дождитесь завершения/.test(toast.message))).toHaveLength(
      2,
    );

    await h.pipeline.cancel();
    resolveTranscribe({ text: "late", provider: "groq", model: "m" });
    await stopping;
  });

  it("reports recorder start failures with a retry action", async () => {
    const h = setup();
    const start = vi.fn(async (): Promise<void> => {
      throw new Error("Нет микрофона");
    });
    Object.assign(h.recorder.recorder, { start });

    await h.pipeline.start("composer");
    expect(h.pipeline.getState()).toBe("idle");
    const toast = h.ui.toasts.at(-1);
    expect(toast?.message).toBe("Нет микрофона");
    expect(toast?.options?.actionLabel).toBe("Повторить");

    start.mockResolvedValue(undefined);
    toast?.options?.action?.();
    await vi.waitFor(() => {
      expect(h.pipeline.getState()).toBe("recording");
    });
    await h.pipeline.cancel();
  });

  it("reports recorder stop failures with a retry action", async () => {
    const h = setup();
    Object.assign(h.recorder.recorder, {
      stop: async () => {
        throw new Error("Стоп не сработал");
      },
    });
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.pipeline.getState()).toBe("idle");
    expect(h.ui.toasts.at(-1)?.message).toBe("Стоп не сработал");
    expect(h.ui.toasts.at(-1)?.options?.actionLabel).toBe("Записать снова");
  });

  it("stops automatically at the recording limit", async () => {
    vi.useFakeTimers();
    const h = setup();
    h.config.behavior.maxRecordingSeconds = 1;
    await h.pipeline.start("composer");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.ui.toasts.some((toast) => /Достигнут лимит записи/.test(toast.message))).toBe(true);
    expect(h.submitPrompt).toHaveBeenCalled();
  });

  it("toggle starts and stops recording", async () => {
    const h = setup();
    await h.pipeline.toggle("composer");
    expect(h.pipeline.getState()).toBe("recording");
    await h.pipeline.toggle("composer");
    expect(h.pipeline.getState()).toBe("idle");
    expect(h.insertText).toHaveBeenCalled();
  });

  it("does not start while not idle", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    await h.pipeline.start("composer");
    expect(h.recorder.starts).toBe(1);
    await h.pipeline.cancel();
  });

  it("dispose cancels active recording and hides recovery", async () => {
    const h = setup();
    await h.pipeline.start("composer");
    h.pipeline.dispose();
    expect(h.recorder.cancels).toBe(1);
    expect(h.ui.hideRecoveryCalls).toBe(1);
  });

  it("rejects inserts while a recording is active", async () => {
    const h = setup();
    h.config.behavior.fallbackToRaw = false;
    h.cleanup.mockRejectedValue(new Error("LLM упал"));
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.ui.recoveries.at(-1)?.actions.onInsertRaw).toBeTypeOf("function");

    await h.pipeline.start("composer");
    h.ui.recoveries.at(-1)?.actions.onInsertRaw?.();
    expect(h.ui.toasts.some((toast) => /Дождитесь завершения/.test(toast.message))).toBe(true);
    await h.pipeline.cancel();
  });

  it("does nothing when there is no active operation to cancel", async () => {
    const h = setup();
    await h.pipeline.cancel();
    expect(h.ui.toasts).toHaveLength(0);
  });

  it("ignores abort errors from STT", async () => {
    const h = setup();
    h.transcribe.mockRejectedValue(new AbortError());
    await h.pipeline.start("composer");
    await h.pipeline.stop();
    expect(h.ui.recoveries).toHaveLength(0);
    expect(h.pipeline.getState()).toBe("stt");
  });
});
