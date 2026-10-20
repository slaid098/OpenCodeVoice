import type { AudioRecorder, RecordedAudio } from "./audio.js";
import { resolveSttModel } from "./config.js";
import { isAbortError } from "./http.js";
import { type MessageKey, t } from "./i18n.js";
import type { CleanupOptions } from "./llm.js";
import type { TranscribeOptions } from "./transcribe.js";
import type {
  AppConfig,
  CleanupResult,
  DictationPhase,
  FailedDictation,
  FailureStage,
  InsertTarget,
  TranscriptionResult,
} from "./types.js";

export interface ToastOptions {
  error?: boolean;
  actionLabel?: string;
  action?: () => void;
  durationMs?: number;
}

export interface RecoveryActions {
  onRetry: () => void;
  onInsertRaw?: () => void;
  onSubmitRaw?: () => void;
  onDelete: () => void;
  onSettings: () => void;
}

export interface PipelineUi {
  setState(state: DictationPhase, elapsedSeconds?: number): void;
  toast(message: string, options?: ToastOptions): void;
  showRecovery(record: FailedDictation, actions: RecoveryActions): void;
  hideRecovery(): void;
  openSettings(): void;
}

export interface FailureStore {
  save(record: FailedDictation): Promise<void>;
  latest(): Promise<FailedDictation | null>;
  remove(id: string): Promise<void>;
  toArrayBuffer(blob: Blob): Promise<ArrayBuffer>;
  fromAudio(record: FailedDictation): Blob | null;
  requestPersistence(): Promise<boolean>;
}

export interface PipelineDeps {
  getConfig: () => AppConfig;
  createRecorder: () => AudioRecorder;
  transcribe: (
    blob: Blob,
    config: AppConfig,
    options: TranscribeOptions,
  ) => Promise<TranscriptionResult>;
  cleanup: (text: string, config: AppConfig, options: CleanupOptions) => Promise<CleanupResult>;
  insertText: (text: string, target: InsertTarget) => boolean;
  replaceText: (text: string, target: InsertTarget) => boolean;
  submitPrompt: (target: InsertTarget) => boolean;
  isSubmitBusy: () => boolean;
  isQuestionOpen: () => boolean;
  getSessionPath: () => string;
  rememberDraft: (target: InsertTarget) => void;
  isDraftChanged: (target: InsertTarget) => boolean;
  store: FailureStore;
  ui: PipelineUi;
  now?: () => number;
  makeId?: () => string;
}

export interface Pipeline {
  toggle(target: InsertTarget): Promise<void>;
  start(target: InsertTarget): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  retryLast(): Promise<void>;
  forget(): Promise<void>;
  recover(): Promise<void>;
  getState(): DictationPhase;
  getCurrentFailure(): FailedDictation | null;
  dispose(): void;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  let phase: DictationPhase = "idle";
  let recorder: AudioRecorder | null = null;
  let target: InsertTarget = "composer";
  let current: FailedDictation | null = null;
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let limitTimer: ReturnType<typeof setTimeout> | null = null;
  let elapsed = 0;
  let token = 0;
  let persistenceRequested = false;
  let originPath: string | null = null;

  const now = (): number => deps.now?.() ?? Date.now();
  const newId = (): string =>
    deps.makeId?.() ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `ocvd-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const setPhase = (next: DictationPhase, seconds = 0): void => {
    phase = next;
    deps.ui.setState(next, seconds);
  };

  const clearTimers = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (limitTimer) {
      clearTimeout(limitTimer);
      limitTimer = null;
    }
  };

  const safeSave = async (record: FailedDictation): Promise<void> => {
    record.updatedAt = now();
    try {
      await deps.store.save(record);
    } catch {
      deps.ui.toast(t("pipeline.draftSaveFailed"), {
        error: true,
        durationMs: 6000,
      });
    }
  };

  const safeRemove = async (id: string): Promise<void> => {
    try {
      await deps.store.remove(id);
    } catch {
      // ignore
    }
  };

  const retryToast = (
    label: string,
  ): ((error: unknown, attempt: number, delayMs: number) => void) => {
    return (_error, attempt, delayMs) => {
      const max = deps.getConfig().retry.maxAttempts;
      deps.ui.toast(
        t("pipeline.retryIn", {
          label,
          attempt: attempt + 1,
          max,
          seconds: Math.round(delayMs / 100) / 10,
        }),
        {
          durationMs: Math.min(2500, delayMs),
        },
      );
    };
  };

  const sessionChanged = (record: FailedDictation): boolean =>
    typeof record.originPath === "string" &&
    record.originPath !== "" &&
    record.originPath !== deps.getSessionPath();

  const failSessionChanged = async (
    record: FailedDictation,
    localToken: number,
    stage: "insert" | "submit",
  ): Promise<void> => {
    record.stage = stage;
    record.error = t(
      stage === "insert" ? "pipeline.sessionChanged" : "pipeline.sessionChangedAfterInsert",
    );
    record.attempts += 1;
    current = record;
    await safeSave(record);
    if (localToken !== token) {
      return;
    }
    setPhase("idle");
    showRecovery(record);
    deps.ui.toast(
      t(
        stage === "insert"
          ? "pipeline.sessionChangedToast"
          : "pipeline.sessionChangedAfterInsertToast",
      ),
      { error: true, durationMs: 10_000 },
    );
  };

  const start = async (nextTarget: InsertTarget): Promise<void> => {
    if (phase !== "idle") {
      return;
    }
    target = nextTarget;
    originPath = deps.getSessionPath();
    deps.rememberDraft(nextTarget);
    const localToken = ++token;
    const localRecorder = deps.createRecorder();
    recorder = localRecorder;

    try {
      await localRecorder.start();
    } catch (error) {
      if (localToken !== token) {
        return;
      }
      recorder = null;
      setPhase("idle");
      const message = error instanceof Error ? error.message : t("pipeline.recordStartFailed");
      deps.ui.toast(message, {
        error: true,
        actionLabel: t("pipeline.retry"),
        action: () => void start(nextTarget),
        durationMs: 8000,
      });
      return;
    }

    if (localToken !== token) {
      localRecorder.cancel();
      return;
    }

    elapsed = 0;
    setPhase("recording", 0);
    timer = setInterval(() => {
      elapsed += 1;
      deps.ui.setState("recording", elapsed);
    }, 1000);

    if (!persistenceRequested) {
      persistenceRequested = true;
      void deps.store.requestPersistence();
    }

    const maxSeconds = deps.getConfig().behavior.maxRecordingSeconds;
    limitTimer = setTimeout(() => {
      if (phase === "recording") {
        deps.ui.toast(t("pipeline.recordLimit", { seconds: maxSeconds }), { durationMs: 3000 });
        void stop();
      }
    }, maxSeconds * 1000);
  };

  const stop = async (): Promise<void> => {
    if (phase !== "recording" || !recorder) {
      return;
    }
    const localToken = ++token;
    clearTimers();
    const localRecorder = recorder;
    recorder = null;
    setPhase("stt");

    let audio: RecordedAudio;
    try {
      audio = await localRecorder.stop();
    } catch (error) {
      if (localToken !== token) {
        return;
      }
      setPhase("idle");
      const message = error instanceof Error ? error.message : t("pipeline.recordStopFailed");
      deps.ui.toast(message, {
        error: true,
        actionLabel: t("pipeline.recordAgain"),
        action: () => void start(target),
        durationMs: 8000,
      });
      return;
    }
    if (localToken !== token) {
      return;
    }

    const config = deps.getConfig();
    const record: FailedDictation = {
      id: newId(),
      createdAt: now(),
      updatedAt: now(),
      target,
      stage: "stt",
      originPath: originPath ?? undefined,
      error: "",
      attempts: 0,
      provider: config.stt.provider,
      model: resolveSttModel(config.stt),
    };

    if (config.behavior.saveFailedAudio) {
      try {
        record.audio = await deps.store.toArrayBuffer(audio.blob);
        record.audioMimeType = audio.mimeType || audio.blob.type;
      } catch {
        // keep going without the audio copy
      }
    }
    if (localToken !== token) {
      return;
    }

    current = record;
    await safeSave(record);
    if (localToken !== token) {
      return;
    }
    await runStt(record, audio.blob, localToken);
  };

  const runStt = async (record: FailedDictation, blob: Blob, localToken: number): Promise<void> => {
    setPhase("stt");
    abort = new AbortController();
    try {
      const result = await deps.transcribe(blob, deps.getConfig(), {
        signal: abort.signal,
        onRetry: retryToast(t("pipeline.retryLabel.stt")),
      });
      if (localToken !== token) {
        return;
      }
      record.rawText = result.text;
      record.provider = result.provider;
      record.model = result.model;
      record.stage = "llm";
      record.error = "";
      record.audio = undefined;
      record.audioMimeType = undefined;
      await safeSave(record);
      if (localToken !== token) {
        return;
      }
      await runLlm(record, localToken);
    } catch (error) {
      if (localToken !== token || isAbortError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : t("pipeline.sttFailedGeneric");
      await fail(record, "stt", message, localToken, t("pipeline.sttFailedSaved"));
    }
  };

  const runLlm = async (record: FailedDictation, localToken: number): Promise<void> => {
    const config = deps.getConfig();
    if (!config.llm.enabled) {
      await runInsert(record, localToken);
      return;
    }

    setPhase("llm");
    abort = new AbortController();
    try {
      const result = await deps.cleanup(record.rawText ?? "", config, {
        signal: abort.signal,
        onRetry: retryToast(t("pipeline.retryLabel.llm")),
      });
      if (localToken !== token) {
        return;
      }
      if (result.usedDefaultPrompt) {
        deps.ui.toast(t("pipeline.promptEmpty"), { durationMs: 4000 });
      }
      record.cleanText = result.text;
      record.stage = "insert";
      record.error = "";
      await safeSave(record);
      if (localToken !== token) {
        return;
      }

      if (result.fallback) {
        deps.ui.toast(cleanupFallbackMessage(result.reason), { durationMs: 5000 });
      }
      await runInsert(record, localToken);
    } catch (error) {
      if (localToken !== token || isAbortError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : t("pipeline.cleanupFailedGeneric");
      const changed = sessionChanged(record);
      record.stage = "llm";
      record.error = changed ? t("pipeline.sessionChanged") : message;
      record.attempts += 1;

      const fallbackConfig = deps.getConfig();
      let insertedRaw = false;
      if (fallbackConfig.behavior.fallbackToRaw && record.rawText && !changed) {
        insertedRaw = deps.insertText(record.rawText, record.target);
        if (insertedRaw) {
          record.rawInserted = true;
          if (record.target === "question" && !deps.isQuestionOpen()) {
            record.target = "composer";
          }
        }
      }
      await safeSave(record);
      if (localToken !== token) {
        return;
      }
      current = record;
      setPhase("idle");
      showRecovery(record);
      deps.ui.toast(
        changed
          ? t("pipeline.sessionChangedToast")
          : insertedRaw
            ? t("pipeline.cleanupFailedRaw")
            : t("pipeline.cleanupFailed", { message }),
        {
          error: true,
          durationMs: 10_000,
          actionLabel: insertedRaw ? t("pipeline.submitRaw") : t("pipeline.retryCleanup"),
          action: insertedRaw ? () => void submitRaw(record) : () => void retryLast(),
        },
      );
    }
  };

  const runInsert = async (record: FailedDictation, localToken: number): Promise<void> => {
    setPhase("insert");
    const text = record.cleanText ?? record.rawText;
    if (!text) {
      await fail(
        record,
        "insert",
        t("pipeline.noText"),
        localToken,
        t("pipeline.noTextRecordAgain"),
      );
      return;
    }

    if (sessionChanged(record)) {
      await failSessionChanged(record, localToken, "insert");
      return;
    }

    const draftChanged = deps.isDraftChanged(record.target);
    const inserted = record.rawInserted
      ? deps.replaceText(text, record.target)
      : deps.insertText(text, record.target);
    if (localToken !== token) {
      return;
    }
    if (!inserted) {
      await fail(
        record,
        "insert",
        t("pipeline.insertFailed"),
        localToken,
        t("pipeline.insertFailedSaved"),
      );
      return;
    }

    record.rawInserted = true;
    if (record.target === "question" && !deps.isQuestionOpen()) {
      record.target = "composer";
    }
    record.stage = "submit";
    record.error = "";
    await safeSave(record);
    if (localToken !== token) {
      return;
    }

    const config = deps.getConfig();
    const autoSubmit =
      record.target === "composer"
        ? config.behavior.autoSubmit
        : config.behavior.autoSubmitQuestion;
    if (!autoSubmit) {
      await finishSuccess(record, t("pipeline.inserted"));
      return;
    }
    if (draftChanged) {
      await finishSuccess(record, t("pipeline.draftChanged"), 6000);
      return;
    }
    await runSubmit(record, localToken);
  };

  const runSubmit = async (record: FailedDictation, localToken: number): Promise<void> => {
    if (sessionChanged(record)) {
      await failSessionChanged(record, localToken, "submit");
      return;
    }
    setPhase("submit");
    const submitted = deps.submitPrompt(record.target);
    if (localToken !== token) {
      return;
    }
    if (submitted) {
      await finishSuccess(record, t("pipeline.sent"));
      return;
    }
    // The agent is still working or the session is blocked. The text is
    // already in the composer; keep it there instead of showing an error.
    if (deps.isSubmitBusy()) {
      await finishSuccess(record, t("pipeline.agentBusy"), 6000);
      return;
    }
    await fail(
      record,
      "submit",
      t("pipeline.submitFailed"),
      localToken,
      t("pipeline.submitFailedSaved"),
    );
  };

  const fail = async (
    record: FailedDictation,
    stage: FailureStage,
    message: string,
    localToken: number,
    userMessage: string,
  ): Promise<void> => {
    record.stage = stage;
    record.error = message;
    record.attempts += 1;
    current = record;
    await safeSave(record);
    if (localToken !== token) {
      return;
    }
    setPhase("idle");
    showRecovery(record);
    deps.ui.toast(userMessage, {
      error: true,
      actionLabel: retryLabel(stage),
      action: () => void retryLast(),
      durationMs: 10_000,
    });
  };

  const finishSuccess = async (
    record: FailedDictation,
    message: string,
    durationMs = 2000,
  ): Promise<void> => {
    await safeRemove(record.id);
    current = null;
    deps.ui.hideRecovery();
    setPhase("idle");
    deps.ui.toast(message, { durationMs });
  };

  const showRecovery = (record: FailedDictation): void => {
    deps.ui.showRecovery(record, {
      onRetry: () => void retryLast(),
      onInsertRaw:
        (record.cleanText || record.rawText) && !record.rawInserted
          ? () => void insertRaw(record)
          : undefined,
      onSubmitRaw: record.rawInserted ? () => void submitRaw(record) : undefined,
      onDelete: () => void deleteCurrent(),
      onSettings: () => deps.ui.openSettings(),
    });
  };

  const insertRaw = async (record: FailedDictation): Promise<void> => {
    if (phase !== "idle") {
      deps.ui.toast(t("pipeline.waitCurrent"), { durationMs: 2500 });
      return;
    }
    const text = record.cleanText || record.rawText;
    if (!text) {
      deps.ui.toast(t("pipeline.rawNotSaved"), { error: true });
      return;
    }
    const localToken = ++token;
    const inserted = record.rawInserted
      ? deps.replaceText(text, record.target)
      : deps.insertText(text, record.target);
    if (localToken !== token) {
      return;
    }
    if (!inserted) {
      deps.ui.toast(t("pipeline.insertFailed"), { error: true });
      return;
    }
    const usedClean = Boolean(record.cleanText);
    record.rawInserted = true;
    record.stage = usedClean ? "submit" : "llm";
    record.error = "";
    current = record;
    await safeSave(record);
    if (localToken !== token) {
      return;
    }
    showRecovery(record);
    deps.ui.toast(usedClean ? t("pipeline.textInserted") : t("pipeline.rawInserted"), {
      durationMs: 4000,
      actionLabel: usedClean ? t("pipeline.sendNow") : t("pipeline.submitRaw"),
      action: () => void submitRaw(record),
    });
  };

  const submitRaw = async (record: FailedDictation): Promise<void> => {
    if (phase !== "idle") {
      deps.ui.toast(t("pipeline.waitCurrent"), { durationMs: 2500 });
      return;
    }
    const localToken = ++token;
    record.cleanText = record.cleanText || record.rawText;
    record.stage = "submit";
    record.error = "";
    current = record;
    await safeSave(record);
    if (localToken !== token) {
      return;
    }
    await runSubmit(record, localToken);
  };

  const retryLast = async (): Promise<void> => {
    if (phase !== "idle") {
      deps.ui.toast(t("pipeline.waitCurrent"), { durationMs: 2500 });
      return;
    }
    const record = current ?? (await deps.store.latest());
    if (!record) {
      deps.ui.toast(t("pipeline.noSavedDictations"), { durationMs: 3000 });
      return;
    }
    current = record;
    const localToken = ++token;

    switch (record.stage) {
      case "stt": {
        const blob = deps.store.fromAudio(record);
        if (!blob) {
          deps.ui.toast(t("pipeline.audioNotSaved"), {
            error: true,
            durationMs: 6000,
          });
          return;
        }
        await runStt(record, blob, localToken);
        return;
      }
      case "llm":
        await runLlm(record, localToken);
        return;
      case "insert":
        await runInsert(record, localToken);
        return;
      case "submit":
        await runSubmit(record, localToken);
        return;
    }
  };

  const deleteCurrent = async (): Promise<void> => {
    if (current) {
      await safeRemove(current.id);
    }
    current = null;
    deps.ui.hideRecovery();
    deps.ui.toast(t("pipeline.savedDeleted"), { durationMs: 2200 });
  };

  const cancel = async (): Promise<void> => {
    if (phase === "idle" && !current) {
      return;
    }
    token++;
    clearTimers();
    abort?.abort();
    abort = null;
    if (recorder) {
      recorder.cancel();
      recorder = null;
    }
    if (current) {
      await safeRemove(current.id);
      current = null;
    }
    deps.ui.hideRecovery();
    setPhase("idle");
    deps.ui.toast(t("pipeline.cancelled"), { durationMs: 1500 });
  };

  const toggle = async (nextTarget: InsertTarget): Promise<void> => {
    if (phase === "idle") {
      await start(nextTarget);
      return;
    }
    if (phase === "recording") {
      await stop();
      return;
    }
    deps.ui.toast(t("pipeline.waitProcessing"), { durationMs: 2500 });
  };

  const forget = async (): Promise<void> => {
    if (current) {
      await safeRemove(current.id);
      current = null;
    }
    deps.ui.hideRecovery();
  };

  const recover = async (): Promise<void> => {
    const record = await deps.store.latest();
    if (!record) {
      return;
    }
    current = record;
    showRecovery(record);
  };

  const dispose = (): void => {
    token++;
    clearTimers();
    abort?.abort();
    abort = null;
    recorder?.cancel();
    recorder = null;
    deps.ui.hideRecovery();
  };

  return {
    toggle,
    start,
    stop,
    cancel,
    retryLast,
    forget,
    recover,
    getState: () => phase,
    getCurrentFailure: () => current,
    dispose,
  };
}

const RETRY_KEY: Record<FailureStage, MessageKey> = {
  stt: "ui.retry.stt",
  llm: "ui.retry.llm",
  insert: "ui.retry.insert",
  submit: "ui.retry.submit",
};

function retryLabel(stage: FailureStage): string {
  return t(RETRY_KEY[stage]);
}

function cleanupFallbackMessage(reason: string | undefined): string {
  switch (reason) {
    case "refusal":
      return t("pipeline.cleanupReason.refusal");
    case "too-long":
      return t("pipeline.cleanupReason.tooLong");
    case "empty":
    case "empty-result":
      return t("pipeline.cleanupReason.empty");
    case "empty-prompt":
      return t("pipeline.cleanupReason.emptyPrompt");
    default:
      return t("pipeline.cleanupReason.unknown");
  }
}
