import type { AudioRecorder, RecordedAudio } from "./audio.js";
import { isAbortError } from "./http.js";
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
  isQuestionOpen: () => boolean;
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
      deps.ui.toast("Не удалось сохранить черновик: хранилище недоступно.", {
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
        `Повтор ${label} (${attempt + 1}/${max}) через ${Math.round(delayMs / 100) / 10} с…`,
        {
          durationMs: Math.min(2500, delayMs),
        },
      );
    };
  };

  const start = async (nextTarget: InsertTarget): Promise<void> => {
    if (phase !== "idle") {
      return;
    }
    target = nextTarget;
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
      const message = error instanceof Error ? error.message : "Не удалось начать запись.";
      deps.ui.toast(message, {
        error: true,
        actionLabel: "Повторить",
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
        deps.ui.toast(`Достигнут лимит записи (${maxSeconds} с).`, { durationMs: 3000 });
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
      const message = error instanceof Error ? error.message : "Не удалось остановить запись.";
      deps.ui.toast(message, {
        error: true,
        actionLabel: "Записать снова",
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
      error: "",
      attempts: 0,
      provider: config.stt.provider,
      model: config.stt.model,
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
        onRetry: retryToast("STT"),
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
      const message = error instanceof Error ? error.message : "Ошибка распознавания.";
      await fail(
        record,
        "stt",
        message,
        localToken,
        "Не удалось распознать речь. Аудио сохранено — можно повторить.",
      );
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
        onRetry: retryToast("очистки"),
      });
      if (localToken !== token) {
        return;
      }
      if (result.usedDefaultPrompt) {
        deps.ui.toast("Промпт очистки пуст — использован стандартный.", { durationMs: 4000 });
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
      const message = error instanceof Error ? error.message : "Ошибка очистки текста.";
      record.stage = "llm";
      record.error = message;
      record.attempts += 1;

      const fallbackConfig = deps.getConfig();
      let insertedRaw = false;
      if (fallbackConfig.behavior.fallbackToRaw && record.rawText) {
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
        insertedRaw
          ? "Очистка не удалась — вставлен сырой текст. Проверьте и отправьте или повторите очистку."
          : `Очистка не удалась: ${message}`,
        {
          error: true,
          durationMs: 10_000,
          actionLabel: insertedRaw ? "Отправить как есть" : "Повторить очистку",
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
        "Нет текста для вставки.",
        localToken,
        "Нет текста для вставки. Запишите диктовку заново.",
      );
      return;
    }

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
        "Не удалось найти поле ввода.",
        localToken,
        "Не удалось найти поле ввода. Текст сохранён — можно повторить.",
      );
      return;
    }

    record.rawInserted = false;
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
      await finishSuccess(record, "Текст вставлен.");
      return;
    }
    await runSubmit(record, localToken);
  };

  const runSubmit = async (record: FailedDictation, localToken: number): Promise<void> => {
    setPhase("submit");
    const submitted = deps.submitPrompt(record.target);
    if (localToken !== token) {
      return;
    }
    if (submitted) {
      await finishSuccess(record, "Отправлено.");
      return;
    }
    await fail(
      record,
      "submit",
      "Не удалось отправить сообщение.",
      localToken,
      "Не удалось отправить. Текст остался в поле ввода — можно повторить.",
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

  const finishSuccess = async (record: FailedDictation, message: string): Promise<void> => {
    await safeRemove(record.id);
    current = null;
    deps.ui.hideRecovery();
    setPhase("idle");
    deps.ui.toast(message, { durationMs: 2000 });
  };

  const showRecovery = (record: FailedDictation): void => {
    deps.ui.showRecovery(record, {
      onRetry: () => void retryLast(),
      onInsertRaw: record.rawText && !record.rawInserted ? () => void insertRaw(record) : undefined,
      onSubmitRaw: record.rawInserted ? () => void submitRaw(record) : undefined,
      onDelete: () => void deleteCurrent(),
      onSettings: () => deps.ui.openSettings(),
    });
  };

  const insertRaw = async (record: FailedDictation): Promise<void> => {
    if (phase !== "idle") {
      deps.ui.toast("Дождитесь завершения текущей операции.", { durationMs: 2500 });
      return;
    }
    if (!record.rawText) {
      deps.ui.toast("Сырой текст не сохранён.", { error: true });
      return;
    }
    const localToken = ++token;
    const inserted = record.rawInserted
      ? deps.replaceText(record.rawText, record.target)
      : deps.insertText(record.rawText, record.target);
    if (localToken !== token) {
      return;
    }
    if (!inserted) {
      deps.ui.toast("Не удалось найти поле ввода.", { error: true });
      return;
    }
    record.rawInserted = true;
    record.cleanText = undefined;
    record.stage = "llm";
    record.error = "";
    current = record;
    await safeSave(record);
    if (localToken !== token) {
      return;
    }
    showRecovery(record);
    deps.ui.toast("Сырой текст вставлен. Можно отправить или повторить очистку.", {
      durationMs: 4000,
      actionLabel: "Отправить как есть",
      action: () => void submitRaw(record),
    });
  };

  const submitRaw = async (record: FailedDictation): Promise<void> => {
    if (phase !== "idle") {
      deps.ui.toast("Дождитесь завершения текущей операции.", { durationMs: 2500 });
      return;
    }
    const localToken = ++token;
    record.cleanText = record.rawText;
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
      deps.ui.toast("Дождитесь завершения текущей операции.", { durationMs: 2500 });
      return;
    }
    const record = current ?? (await deps.store.latest());
    if (!record) {
      deps.ui.toast("Нет сохранённых диктовок для повтора.", { durationMs: 3000 });
      return;
    }
    current = record;
    const localToken = ++token;

    switch (record.stage) {
      case "stt": {
        const blob = deps.store.fromAudio(record);
        if (!blob) {
          deps.ui.toast("Аудио не сохранилось. Запишите диктовку заново.", {
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
    deps.ui.toast("Сохранённая запись удалена.", { durationMs: 2200 });
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
    deps.ui.toast("Отменено.", { durationMs: 1500 });
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
    deps.ui.toast("Дождитесь завершения обработки.", { durationMs: 2500 });
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

function retryLabel(stage: FailureStage): string {
  switch (stage) {
    case "stt":
      return "Повторить STT";
    case "llm":
      return "Повторить очистку";
    case "insert":
      return "Повторить вставку";
    case "submit":
      return "Отправить снова";
  }
}

function cleanupFallbackMessage(reason: string | undefined): string {
  switch (reason) {
    case "refusal":
      return "LLM отказался обрабатывать текст — использован сырой текст.";
    case "too-long":
      return "LLM вернул слишком длинный текст — использован сырой.";
    case "empty-result":
      return "LLM вернул пустой текст — использован сырой.";
    case "empty-prompt":
      return "Промпт очистки пуст — использован стандартный.";
    default:
      return "LLM не смог очистить текст — использован сырой.";
  }
}
