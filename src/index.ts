import { createAudioRecorder } from "./audio.js";
import { isFirstRun, loadConfig, registerMenuCommands, saveConfig } from "./config.js";
import { initI18n, resolveLocale, setLocale, t } from "./i18n.js";
import {
  insertText,
  isComposerSubmitBusy,
  isDraftChanged,
  isOpencodePage,
  isQuestionPromptOpen,
  rememberDraft,
  replaceText,
  resolveTarget,
  submitPrompt,
} from "./insert.js";
import { setupKeyboardShortcut } from "./keyboard.js";
import { cleanupText } from "./llm.js";
import { createPipeline, type Pipeline, type PipelineUi } from "./pipeline.js";
import { createSettingsPanel, type SettingsPanel } from "./settings-panel.js";
import {
  audioFromFailure,
  audioToArrayBuffer,
  clearFailures,
  getLatestFailure,
  removeFailure,
  requestPersistence,
  saveFailure,
} from "./storage.js";
import { transcribe } from "./transcribe.js";
import type { AppConfig, InsertTarget } from "./types.js";
import { createUi, type Ui } from "./ui.js";

let config: AppConfig | null = null;
let startupConfig: AppConfig | null = null;
let initialized = false;
let ui: Ui | null = null;
let settings: SettingsPanel | null = null;
let pipeline: Pipeline | null = null;

const storageAdapter = {
  save: saveFailure,
  latest: getLatestFailure,
  remove: removeFailure,
  toArrayBuffer: audioToArrayBuffer,
  fromAudio: audioFromFailure,
  requestPersistence,
};

function getStartupConfig(): AppConfig {
  if (!startupConfig) {
    startupConfig = loadConfig(resolveLocale("auto"));
  }
  return startupConfig;
}

function getConfig(): AppConfig {
  if (!config) {
    config = getStartupConfig();
  }
  return config;
}

function setup(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  config = getStartupConfig();

  settings = createSettingsPanel({
    getConfig,
    saveConfig: (next) => {
      saveConfig(next);
      config = next;
    },
    getLastRawText: () => pipeline?.getCurrentFailure()?.rawText ?? null,
    onSaved: (next) => {
      config = next;
      setLocale(resolveLocale(next.ui.language));
      ui?.refresh();
    },
    onClearFailures: async () => {
      await clearFailures();
      await pipeline?.forget();
      ui?.toast(t("index.failuresCleared"), { durationMs: 2500 });
    },
  });

  const pipelineUi: PipelineUi = {
    setState: (state, elapsed) => ui?.setState(state, elapsed),
    toast: (message, toastOptions) => ui?.toast(message, toastOptions),
    hideToast: () => ui?.hideToast(),
    showRecovery: (record, actions) => ui?.showRecovery(record, actions),
    hideRecovery: () => ui?.hideRecovery(),
    openSettings: () => settings?.open(),
  };

  pipeline = createPipeline({
    getConfig,
    createRecorder: createAudioRecorder,
    transcribe,
    cleanup: cleanupText,
    insertText,
    replaceText,
    submitPrompt,
    isSubmitBusy: isComposerSubmitBusy,
    isQuestionOpen: isQuestionPromptOpen,
    getSessionPath: () => window.location.pathname + window.location.search,
    rememberDraft,
    isDraftChanged,
    store: storageAdapter,
    ui: pipelineUi,
  });

  ui = createUi({
    onToggle: (target) => {
      void pipeline?.toggle(target);
    },
    onCancel: () => {
      void pipeline?.cancel();
    },
    onStop: () => {
      void pipeline?.stop();
    },
    onOpenSettings: () => settings?.open(),
  });

  ui.start();

  setupKeyboardShortcut(
    () => {
      if (settings?.isOpen()) {
        return;
      }
      const preferred: InsertTarget = isQuestionPromptOpen() ? "question" : "composer";
      void pipeline?.toggle(resolveTarget(preferred));
    },
    "ctrl+space",
    () => {
      void pipeline?.cancel();
    },
  );

  void pipeline.recover();

  if (isFirstRun(config)) {
    setTimeout(() => {
      if (!settings?.isOpen()) {
        settings?.open();
        ui?.toast(
          config?.stt.provider === "custom" ? t("index.firstRunCustom") : t("index.firstRunGroq"),
          { durationMs: 5000 },
        );
      }
    }, 700);
  }
}

function maybeSetup(): void {
  if (initialized) {
    return;
  }
  if (isOpencodePage()) {
    setup();
  }
}

function waitForOpencode(attempt = 0): void {
  if (initialized) {
    return;
  }
  if (isOpencodePage()) {
    setup();
    return;
  }
  if (attempt >= 20) {
    return;
  }
  const delay = Math.min(10_000, 500 * 1.5 ** attempt);
  window.setTimeout(() => waitForOpencode(attempt + 1), delay);
}

function toggleAutoSubmit(): void {
  const current = loadConfig(resolveLocale("auto"));
  current.behavior.autoSubmit = !current.behavior.autoSubmit;
  saveConfig(current);
  config = current;
  ui?.toast(t(current.behavior.autoSubmit ? "index.autoSubmitOn" : "index.autoSubmitOff"), {
    durationMs: 2500,
  });
}

async function clearSaved(): Promise<void> {
  await clearFailures();
  await pipeline?.forget();
  ui?.toast(t("index.failuresCleared"), { durationMs: 2500 });
}

function registerMenus(): void {
  registerMenuCommands({
    onSettings: () => settings?.open(),
    onToggleAutoSubmit: toggleAutoSubmit,
    onRetryLast: () => {
      void pipeline?.retryLast();
    },
    onClearFailures: () => {
      void clearSaved();
    },
  });
}

function isTopFrame(): boolean {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
}

if (isTopFrame()) {
  config = getStartupConfig();
  initI18n(config.ui.language);
  registerMenus();
  waitForOpencode();
  window.addEventListener("pageshow", maybeSetup);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      maybeSetup();
    }
  });
}
