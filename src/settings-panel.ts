import { GM_info } from "$";
import {
  DEFAULT_CLEANUP_PROMPT,
  applyLlmPreset,
  applySttPreset,
  validateConfig,
} from "./config.js";
import { isAbortError } from "./http.js";
import { getSelectorStatus } from "./insert.js";
import { cleanupText } from "./llm.js";
import { ModelsUnsupportedError, listLlmModels, listSttModels } from "./models.js";
import { clearFailures, estimateStorage, listFailures } from "./storage.js";
import type { AppConfig, CleanupResult, LlmProviderId, ModelInfo, SttProviderId } from "./types.js";

export interface SettingsPanelDeps {
  getConfig: () => AppConfig;
  saveConfig: (config: AppConfig) => void;
  getLastRawText?: () => string | null;
  onSaved?: (config: AppConfig) => void;
  onClearFailures?: () => Promise<void> | void;
}

export interface SettingsPanel {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

type TabId = "stt" | "llm" | "behavior" | "diagnostics";
type StatusKind = "ok" | "warn" | "error" | "info";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "stt", label: "STT" },
  { id: "llm", label: "Очистка" },
  { id: "behavior", label: "Поведение" },
  { id: "diagnostics", label: "Диагностика" },
];

const SAMPLE_TEXT = "ну вот, ээ, это тест очистки текста, как бы, короче, проверка связи.";

const STT_OPTIONS: ReadonlyArray<{ value: SttProviderId; label: string }> = [
  { value: "groq", label: "Groq (Whisper)" },
  { value: "openai", label: "OpenAI (Whisper)" },
  { value: "custom", label: "Свой OpenAI-compatible" },
];

const LLM_OPTIONS: ReadonlyArray<{ value: LlmProviderId; label: string }> = [
  { value: "ollama-cloud", label: "Ollama Cloud" },
  { value: "ollama-local", label: "Ollama Local" },
  { value: "custom-openai", label: "Свой OpenAI-compatible" },
];

const STAGE_LABELS: Record<string, string> = {
  stt: "распознавание",
  llm: "очистка",
  insert: "вставка",
  submit: "отправка",
};

let idCounter = 0;

export function createSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let contentEl: HTMLElement | null = null;
  let footerStatusEl: HTMLElement | null = null;
  let saveButton: HTMLButtonElement | null = null;
  let closeButton: HTMLButtonElement | null = null;
  let promptTextarea: HTMLTextAreaElement | null = null;
  let draft: AppConfig | null = null;
  let activeTab: TabId = "stt";
  let previousFocus: HTMLElement | null = null;
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  let testController: AbortController | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const scriptVersion = (): string => {
    try {
      const version = GM_info?.script?.version;
      return typeof version === "string" && version !== "" ? version : "2.0.0";
    } catch {
      return "2.0.0";
    }
  };

  const uid = (prefix: string): string => {
    idCounter += 1;
    return `ocvd-${prefix}-${idCounter}`;
  };

  const setStatus = (message: string, kind: StatusKind = "info"): void => {
    if (!footerStatusEl) {
      return;
    }
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    footerStatusEl.textContent = message;
    footerStatusEl.className = `footer-status ${kind}`;
    if (kind !== "error") {
      statusTimer = setTimeout(() => {
        statusTimer = null;
        if (footerStatusEl) {
          footerStatusEl.textContent = "";
          footerStatusEl.className = "footer-status";
        }
      }, 5000);
    }
  };

  const setInlineStatus = (node: HTMLElement, message: string, kind: StatusKind = "info"): void => {
    node.hidden = false;
    node.className = `inline-status ${kind}`;
    node.textContent = message;
  };

  const startTest = (): AbortController => {
    testController?.abort();
    const controller = new AbortController();
    testController = controller;
    return controller;
  };

  const finishTest = (controller: AbortController): void => {
    if (testController === controller) {
      testController = null;
    }
  };

  const setBusy = (button: HTMLButtonElement, busy: boolean, busyLabel = "Проверяю…"): void => {
    if (busy) {
      button.dataset.idleLabel = button.textContent ?? "";
      button.textContent = busyLabel;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.idleLabel ?? button.textContent;
      delete button.dataset.idleLabel;
      button.disabled = false;
    }
  };

  const errorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message.trim() !== "") {
      return error.message;
    }
    return "Неизвестная ошибка.";
  };

  const cloneConfig = (config: AppConfig): AppConfig =>
    JSON.parse(JSON.stringify(config)) as AppConfig;

  const save = (): void => {
    if (!draft) {
      return;
    }
    if (promptTextarea?.isConnected) {
      draft.llm.prompt = promptTextarea.value;
    }
    const config = cloneConfig(draft);
    config.stt.endpoint = config.stt.endpoint.trim();
    config.stt.apiKey = config.stt.apiKey.trim();
    config.stt.model = config.stt.model.trim();
    config.stt.language = config.stt.language.trim();
    config.llm.baseUrl = config.llm.baseUrl.trim();
    config.llm.apiKey = config.llm.apiKey.trim();
    config.llm.model = config.llm.model.trim();

    const errors = validateConfig(config);
    if (errors.length > 0) {
      setStatus(errors.slice(0, 3).join(" • "), "error");
      return;
    }

    try {
      deps.saveConfig(config);
      deps.onSaved?.(cloneConfig(config));
      setStatus("Сохранено.", "ok");
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
      closeTimer = setTimeout(() => {
        closeTimer = null;
        close();
      }, 450);
    } catch (error) {
      setStatus(`Не удалось сохранить: ${errorMessage(error)}`, "error");
    }
  };

  const buildHeader = (): HTMLElement => {
    const header = element("div", "header");
    const titleWrap = element("div", "title-wrap");
    titleWrap.append(
      element("h2", "title", "Голосовой ввод"),
      element("div", "subtitle", `OpenCode 2 · v${scriptVersion()}`),
    );
    closeButton = element("button", "icon-btn", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Закрыть настройки");
    closeButton.addEventListener("click", close);
    header.append(titleWrap, closeButton);
    return header;
  };

  const buildTabs = (): HTMLElement => {
    const tabs = element("div", "tabs");
    tabs.setAttribute("role", "tablist");
    for (const tab of TABS) {
      const button = element("button", "tab", tab.label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.dataset.tab = tab.id;
      button.setAttribute("aria-selected", String(tab.id === activeTab));
      button.addEventListener("click", () => setTab(tab.id));
      tabs.appendChild(button);
    }
    return tabs;
  };

  const setTab = (tab: TabId): void => {
    activeTab = tab;
    for (const button of shadow?.querySelectorAll<HTMLButtonElement>(".tab") ?? []) {
      button.setAttribute("aria-selected", String(button.dataset.tab === tab));
    }
    renderContent();
  };

  const renderContent = (): void => {
    if (!contentEl || !draft) {
      return;
    }
    contentEl.replaceChildren();
    promptTextarea = null;
    switch (activeTab) {
      case "stt":
        contentEl.appendChild(buildSttTab());
        break;
      case "llm":
        contentEl.appendChild(buildLlmTab());
        break;
      case "behavior":
        contentEl.appendChild(buildBehaviorTab());
        break;
      case "diagnostics":
        contentEl.appendChild(buildDiagnosticsTab());
        break;
    }
    contentEl.scrollTop = 0;
  };

  const open = (): void => {
    if (host) {
      close();
    }
    draft = cloneConfig(deps.getConfig());
    activeTab = "stt";
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    build();
    keydownHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", keydownHandler, true);
    closeButton?.focus();
  };

  const close = (): void => {
    testController?.abort();
    testController = null;
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (keydownHandler) {
      document.removeEventListener("keydown", keydownHandler, true);
      keydownHandler = null;
    }
    host?.remove();
    host = null;
    shadow = null;
    contentEl = null;
    footerStatusEl = null;
    saveButton = null;
    closeButton = null;
    promptTextarea = null;
    draft = null;
    if (previousFocus?.isConnected) {
      previousFocus.focus();
    }
    previousFocus = null;
  };

  const build = (): void => {
    host = document.createElement("div");
    host.dataset.ocvdUi = "settings";
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483600;display:block;pointer-events:auto;";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
:host { all: initial; }
:host {
  --bg: #111827;
  --fg: #f9fafb;
  --muted: rgba(249, 250, 251, 0.62);
  --border: rgba(255, 255, 255, 0.16);
  --field: rgba(255, 255, 255, 0.06);
  --field-focus: rgba(96, 165, 250, 0.35);
  --accent: #2563eb;
  --ok: #86efac;
  --warn: #fbbf24;
  --bad: #fca5a5;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :host {
    --bg: #ffffff;
    --fg: #111827;
    --muted: rgba(17, 24, 39, 0.6);
    --border: rgba(17, 24, 39, 0.18);
    --field: rgba(17, 24, 39, 0.04);
    --field-focus: rgba(37, 99, 235, 0.3);
    --accent: #2563eb;
    --ok: #15803d;
    --warn: #b45309;
    --bad: #b91c1c;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: min(760px, 100%);
  max-height: 92vh;
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--fg);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.35);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.35;
}
.header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
}
.title-wrap { flex: 1 1 auto; min-width: 0; }
.title { margin: 0; font-size: 18px; line-height: 1.2; }
.subtitle { margin-top: 3px; font-size: 12px; color: var(--muted); }
.icon-btn {
  all: unset;
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
  flex: 0 0 auto;
}
.icon-btn:hover { background: var(--field); color: var(--fg); }
.icon-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  all: unset;
  box-sizing: border-box;
  flex: 0 0 auto;
  min-height: 40px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
}
.tab:hover { background: var(--field); color: var(--fg); }
.tab[aria-selected="true"] { background: var(--accent); color: #fff; }
.tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.content {
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px 22px;
  flex: 1 1 auto;
}
.section { margin-bottom: 20px; }
.section:last-child { margin-bottom: 0; }
.section-title { margin: 0 0 4px; font-size: 15px; line-height: 1.25; }
.section-hint { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
.field { margin-bottom: 12px; }
.field:last-child { margin-bottom: 0; }
.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}
.input, .textarea, .select {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--field);
  color: var(--fg);
  font: inherit;
  font-size: 16px;
  outline: none;
}
.input:focus, .textarea:focus, .select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--field-focus);
}
.input::placeholder, .textarea::placeholder { color: var(--muted); }
.textarea { min-height: 84px; resize: vertical; line-height: 1.45; }
.prompt-textarea { min-height: 190px; }
.hint { margin-top: 5px; font-size: 12px; color: var(--muted); }
.password-row, .model-row { display: flex; gap: 8px; align-items: stretch; }
.password-row .input, .model-row .input { flex: 1 1 auto; min-width: 0; }
.inline-btn, .secondary-btn {
  all: unset;
  box-sizing: border-box;
  min-height: 44px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--field);
  color: var(--fg);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
  flex: 0 0 auto;
}
.inline-btn:hover, .secondary-btn:hover { background: rgba(127, 127, 127, 0.14); }
.inline-btn:focus-visible, .secondary-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.inline-btn[disabled], .secondary-btn[disabled] { opacity: 0.55; cursor: default; }
.check-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-height: 44px;
  padding: 8px 0;
  cursor: pointer;
}
.check-row input {
  width: 20px;
  height: 20px;
  margin: 1px 0 0;
  accent-color: var(--accent);
  flex: 0 0 auto;
}
.check-title { display: block; font-size: 14px; font-weight: 500; }
.check-hint { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); }
.tools-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.inline-status {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--field);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 140px;
  overflow: auto;
}
.inline-status.ok { color: var(--ok); }
.inline-status.warn { color: var(--warn); }
.inline-status.error { color: var(--bad); }
.prompt-result {
  margin-top: 8px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--field);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 180px;
  overflow: auto;
}
.footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.footer-status {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.footer-status.ok { color: var(--ok); }
.footer-status.error { color: var(--bad); }
.footer-status.warn { color: var(--warn); }
.primary-btn {
  all: unset;
  box-sizing: border-box;
  min-height: 48px;
  min-width: 132px;
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  flex: 0 0 auto;
}
.primary-btn:hover { filter: brightness(1.08); }
.primary-btn:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.diag-card {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--field);
}
.diag-card-title { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.diag-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}
.diag-row:last-child { border-bottom: none; }
.diag-key { color: var(--muted); flex: 0 0 auto; }
.diag-value { text-align: right; overflow-wrap: anywhere; }
.diag-ok { color: var(--ok); }
.diag-bad { color: var(--bad); }
.diag-error {
  margin-top: 6px;
  font-size: 12px;
  color: var(--bad);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 120px;
  overflow: auto;
}
@media (pointer: coarse) {
  .primary-btn { min-height: 50px; }
}
@media (min-width: 760px) {
  .backdrop { align-items: center; padding: 24px; }
  .sheet { border-radius: 16px; max-height: 86vh; max-height: 86dvh; }
}
`;
    const backdrop = element("div", "backdrop");
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close();
      }
    });

    const sheet = element("div", "sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Настройки голосового ввода");

    contentEl = element("div", "content");

    const footer = element("div", "footer");
    footerStatusEl = element("div", "footer-status");
    footerStatusEl.setAttribute("role", "status");
    footerStatusEl.setAttribute("aria-live", "polite");
    saveButton = element("button", "primary-btn", "Сохранить");
    saveButton.type = "button";
    saveButton.addEventListener("click", save);
    footer.append(footerStatusEl, saveButton);

    sheet.append(buildHeader(), buildTabs(), contentEl, footer);
    backdrop.appendChild(sheet);
    shadow.append(style, backdrop);
    document.documentElement.appendChild(host);
    renderContent();
  };

  const buildSttTab = (): HTMLElement => {
    const panel = element("div", "tab-panel");
    const recognition = section(
      "Распознавание речи",
      "Аудио уходит напрямую выбранному STT-провайдеру. Ключ хранится в настройках Tampermonkey.",
    );

    addSelect(recognition, "Провайдер", STT_OPTIONS, draft?.stt.provider ?? "groq", (value) => {
      if (!draft) return;
      draft.stt = applySttPreset(draft.stt, value);
      renderContent();
    });

    addPasswordField(recognition, "API-ключ", draft?.stt.apiKey ?? "", (value) => {
      if (draft) draft.stt.apiKey = value;
    });

    addTextInput(
      recognition,
      "Endpoint",
      draft?.stt.endpoint ?? "",
      (value) => {
        if (draft) draft.stt.endpoint = value;
      },
      { type: "url", placeholder: "https://api.groq.com/openai/v1/audio/transcriptions" },
    );

    addModelInput(
      recognition,
      "Модель",
      draft?.stt.model ?? "",
      (value) => {
        if (draft) draft.stt.model = value;
      },
      "Загрузить модели",
      async (button, status, input, datalist) => {
        if (!draft) {
          setBusy(button, false);
          return;
        }
        const controller = startTest();
        try {
          const models = await listSttModels(draft, controller.signal);
          fillDatalist(datalist, models);
          if (input.value.trim() === "" && models[0]) {
            input.value = models[0].id;
            draft.stt.model = models[0].id;
          }
          setInlineStatus(status, `Модели загружены: ${models.length}.`, "ok");
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            return;
          }
          if (error instanceof ModelsUnsupportedError) {
            setInlineStatus(status, error.message, "warn");
          } else {
            setInlineStatus(status, errorMessage(error), "error");
          }
        } finally {
          finishTest(controller);
          setBusy(button, false);
        }
      },
    );

    addTextInput(
      recognition,
      "Язык",
      draft?.stt.language ?? "",
      (value) => {
        if (draft) draft.stt.language = value;
      },
      { placeholder: "ru или пусто — автоопределение" },
    );

    addTextArea(
      recognition,
      "Подсказка распознаванию",
      draft?.stt.prompt ?? "",
      (value) => {
        if (draft) draft.stt.prompt = value;
      },
      "Имена, термины и названия, которые Whisper должен узнать. Необязательно.",
      3,
    );

    addNumberInput(
      recognition,
      "Temperature",
      draft?.stt.temperature ?? 0,
      (value) => {
        if (draft) draft.stt.temperature = value;
      },
      { min: 0, max: 1, step: 0.1, hint: "Для расшифровки обычно 0." },
    );

    const testStatus = element("div", "inline-status");
    testStatus.hidden = true;
    const testButton = element("button", "secondary-btn", "Проверить подключение");
    testButton.type = "button";
    testButton.addEventListener("click", async () => {
      if (!draft) return;
      const controller = startTest();
      setBusy(testButton, true);
      setInlineStatus(testStatus, "Проверяю доступность и список моделей…", "info");
      try {
        const models = await listSttModels(draft, controller.signal);
        setInlineStatus(
          testStatus,
          `Подключение работает. Доступно моделей: ${models.length}.`,
          "ok",
        );
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        if (error instanceof ModelsUnsupportedError) {
          setInlineStatus(
            testStatus,
            "Endpoint доступен, но список моделей не поддерживается. Это нормально для некоторых прокси.",
            "warn",
          );
        } else {
          setInlineStatus(testStatus, errorMessage(error), "error");
        }
      } finally {
        finishTest(controller);
        setBusy(testButton, false);
      }
    });
    recognition.append(testButton, testStatus);
    panel.appendChild(recognition);
    return panel;
  };

  const buildLlmTab = (): HTMLElement => {
    const panel = element("div", "tab-panel");
    const cleanup = section(
      "Очистка текста",
      "Расшифровка отправляется в LLM, которая убирает слова-паразиты и мат, исправляет пунктуацию и сохраняет смысл.",
    );

    addCheckbox(cleanup, "Включить очистку LLM", draft?.llm.enabled ?? true, (checked) => {
      if (draft) draft.llm.enabled = checked;
    });

    addSelect(cleanup, "Провайдер", LLM_OPTIONS, draft?.llm.provider ?? "ollama-cloud", (value) => {
      if (!draft) return;
      draft.llm = applyLlmPreset(draft.llm, value);
      renderContent();
    });

    addTextInput(
      cleanup,
      "Base URL",
      draft?.llm.baseUrl ?? "",
      (value) => {
        if (draft) draft.llm.baseUrl = value;
      },
      { type: "url", placeholder: "https://ollama.com" },
    );

    addPasswordField(cleanup, "API-ключ", draft?.llm.apiKey ?? "", (value) => {
      if (draft) draft.llm.apiKey = value;
    });

    addModelInput(
      cleanup,
      "Модель",
      draft?.llm.model ?? "",
      (value) => {
        if (draft) draft.llm.model = value;
      },
      "Загрузить модели",
      async (button, status, input, datalist) => {
        if (!draft) {
          setBusy(button, false);
          return;
        }
        const controller = startTest();
        try {
          const models = await listLlmModels(draft, controller.signal);
          fillDatalist(datalist, models);
          if (input.value.trim() === "" && models[0]) {
            input.value = models[0].id;
            draft.llm.model = models[0].id;
          }
          setInlineStatus(status, `Модели загружены: ${models.length}.`, "ok");
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            return;
          }
          if (error instanceof ModelsUnsupportedError) {
            setInlineStatus(status, error.message, "warn");
          } else {
            setInlineStatus(status, errorMessage(error), "error");
          }
        } finally {
          finishTest(controller);
          setBusy(button, false);
        }
      },
    );

    addCheckbox(
      cleanup,
      "Reasoning",
      draft?.llm.reasoning ?? false,
      (checked) => {
        if (draft) draft.llm.reasoning = checked;
      },
      "Обычно выключен: быстрее, дешевле и меньше лишних рассуждений.",
    );

    const testStatus = element("div", "inline-status");
    testStatus.hidden = true;
    const testButton = element("button", "secondary-btn", "Проверить подключение");
    testButton.type = "button";
    testButton.addEventListener("click", async () => {
      if (!draft) return;
      const controller = startTest();
      setBusy(testButton, true);
      setInlineStatus(testStatus, "Проверяю модели и очистку тестовой фразы…", "info");
      try {
        const models = await listLlmModels(draft, controller.signal);
        if (!draft.llm.enabled) {
          setInlineStatus(
            testStatus,
            `Модели доступны (${models.length}), но очистка выключена. Включите её для проверки LLM.`,
            "warn",
          );
          return;
        }
        const result = await cleanupText(SAMPLE_TEXT, draft, { signal: controller.signal });
        if (result.fallback) {
          setInlineStatus(
            testStatus,
            `Модели доступны (${models.length}), очистка вернула сырой текст: ${reasonLabel(result.reason)}.`,
            "warn",
          );
        } else {
          setInlineStatus(
            testStatus,
            `Подключение работает. Пример: ${truncate(result.text, 240)}`,
            "ok",
          );
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        setInlineStatus(testStatus, errorMessage(error), "error");
      } finally {
        finishTest(controller);
        setBusy(testButton, false);
      }
    });
    cleanup.append(testButton, testStatus);
    panel.appendChild(cleanup);
    panel.appendChild(buildPromptSection());
    return panel;
  };

  const buildPromptSection = (): HTMLElement => {
    const promptSection = section(
      "Промпт очистки",
      "Текст диктовки добавляется автоматически отдельным сообщением — не вставляйте его в промпт.",
    );
    const textarea = element("textarea", "textarea prompt-textarea");
    textarea.id = uid("cleanup-prompt");
    textarea.rows = 10;
    textarea.spellcheck = true;
    const initial = draft?.llm.prompt.trim() === "" ? DEFAULT_CLEANUP_PROMPT : draft?.llm.prompt;
    textarea.value = initial ?? DEFAULT_CLEANUP_PROMPT;
    promptTextarea = textarea;
    const label = element("label", "field-label", "Системная инструкция");
    label.htmlFor = textarea.id;
    const counter = element("div", "hint", `Символов: ${textarea.value.length}`);
    const field = element("div", "field");
    field.append(label, textarea, counter);
    textarea.addEventListener("input", () => {
      if (draft) draft.llm.prompt = textarea.value;
      counter.textContent = `Символов: ${textarea.value.length}`;
    });

    const tools = element("div", "tools-row");
    const reset = element("button", "secondary-btn", "Сбросить к стандартному");
    reset.type = "button";
    let resetArmed = false;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    reset.addEventListener("click", () => {
      if (!resetArmed) {
        resetArmed = true;
        reset.textContent = "Нажмите ещё раз для сброса";
        resetTimer = setTimeout(() => {
          resetArmed = false;
          resetTimer = null;
          reset.textContent = "Сбросить к стандартному";
        }, 3000);
        return;
      }
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      resetArmed = false;
      reset.textContent = "Сбросить к стандартному";
      textarea.value = DEFAULT_CLEANUP_PROMPT;
      if (draft) draft.llm.prompt = DEFAULT_CLEANUP_PROMPT;
      counter.textContent = `Символов: ${textarea.value.length}`;
      setStatus("Промпт сброшен к стандартному. Нажмите «Сохранить».", "warn");
    });

    const testButton = element("button", "secondary-btn", "Проверить на примере");
    testButton.type = "button";
    const testStatus = element("div", "inline-status");
    testStatus.hidden = true;
    const resultEl = element("div", "prompt-result");
    resultEl.hidden = true;

    testButton.addEventListener("click", async () => {
      if (!draft) return;
      if (!draft.llm.enabled) {
        setInlineStatus(
          testStatus,
          "Очистка выключена. Включите её на этой вкладке, чтобы проверить промпт.",
          "warn",
        );
        return;
      }
      if (promptTextarea?.isConnected) {
        draft.llm.prompt = promptTextarea.value;
      }
      const controller = startTest();
      setBusy(testButton, true, "Проверяю…");
      setInlineStatus(testStatus, "Отправляю пример в LLM…", "info");
      resultEl.hidden = true;
      const sample = deps.getLastRawText?.()?.trim() || SAMPLE_TEXT;
      try {
        const result: CleanupResult = await cleanupText(sample, draft, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        if (result.fallback) {
          setInlineStatus(
            testStatus,
            `LLM вернул сырой текст: ${reasonLabel(result.reason)}.`,
            "warn",
          );
        } else {
          setInlineStatus(testStatus, "Готово. Результат ниже.", "ok");
        }
        resultEl.hidden = false;
        resultEl.textContent = result.text;
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        setInlineStatus(testStatus, errorMessage(error), "error");
      } finally {
        finishTest(controller);
        setBusy(testButton, false);
      }
    });

    tools.append(reset, testButton);
    promptSection.append(field, tools, testStatus, resultEl);
    return promptSection;
  };

  const buildBehaviorTab = (): HTMLElement => {
    const panel = element("div", "tab-panel");

    const submitSection = section(
      "Автоотправка",
      "После вставки текст можно отправить в OpenCode без второго нажатия.",
    );
    addCheckbox(
      submitSection,
      "Отправлять сообщения в composer",
      draft?.behavior.autoSubmit ?? true,
      (checked) => {
        if (draft) draft.behavior.autoSubmit = checked;
      },
    );
    addCheckbox(
      submitSection,
      "Отправлять ответы на вопросы OpenCode",
      draft?.behavior.autoSubmitQuestion ?? false,
      (checked) => {
        if (draft) draft.behavior.autoSubmitQuestion = checked;
      },
      "По умолчанию выключено: ответ на вопрос лучше проверить перед отправкой.",
    );
    panel.appendChild(submitSection);

    const failureSection = section("Ошибки и восстановление");
    addCheckbox(
      failureSection,
      "При ошибке очистки вставлять сырой текст",
      draft?.behavior.fallbackToRaw ?? true,
      (checked) => {
        if (draft) draft.behavior.fallbackToRaw = checked;
      },
      "Если LLM недоступна, расшифровка всё равно попадёт в поле ввода.",
    );
    addCheckbox(
      failureSection,
      "Сохранять аудио при ошибке STT",
      draft?.behavior.saveFailedAudio ?? true,
      (checked) => {
        if (draft) draft.behavior.saveFailedAudio = checked;
      },
      "Позволяет повторить распознавание без повторной записи.",
    );
    panel.appendChild(failureSection);

    const recordingSection = section("Запись и повторы");
    addNumberInput(
      recordingSection,
      "Максимальная длительность записи, сек",
      draft?.behavior.maxRecordingSeconds ?? 120,
      (value) => {
        if (draft) draft.behavior.maxRecordingSeconds = value;
      },
      { min: 5, max: 600, step: 5 },
    );
    addNumberInput(
      recordingSection,
      "Попыток при сетевых ошибках",
      draft?.retry.maxAttempts ?? 3,
      (value) => {
        if (draft) draft.retry.maxAttempts = Math.round(value);
      },
      {
        min: 1,
        max: 5,
        step: 1,
        hint: "Повторы действуют только для временных ошибок: сеть, 429, 5xx.",
      },
    );
    panel.appendChild(recordingSection);
    return panel;
  };

  const buildDiagnosticsTab = (): HTMLElement => {
    const panel = element("div", "tab-panel");
    const info = section("Версия и страница");
    const versionCard = element("div", "diag-card");
    versionCard.append(
      diagRow("Userscript", scriptVersion()),
      diagRow("Хост", window.location.host || "—"),
      diagRow("Страница OpenCode", getSelectorStatus().composerDock ? "да" : "не обнаружена"),
    );
    info.appendChild(versionCard);

    const selectorsSection = section(
      "Селекторы OpenCode 2",
      "Если какой-то селектор пропал после обновления OpenCode, кнопка микрофона может не появиться.",
    );
    const selectorsCard = element("div", "diag-card");
    const renderSelectors = (): void => {
      selectorsCard.replaceChildren();
      const status = getSelectorStatus();
      const labels: Record<keyof typeof status, string> = {
        composerDock: "Composer dock",
        composerEditor: "Поле ввода",
        composerActions: "Панель действий",
        composerSubmit: "Кнопка отправки",
        questionDock: "Question dock",
        questionInput: "Поле вопроса",
        questionFooter: "Футер вопроса",
      };
      for (const key of Object.keys(labels) as Array<keyof typeof status>) {
        selectorsCard.appendChild(
          diagRow(labels[key], status[key] ? "✓ есть" : "✗ нет", status[key]),
        );
      }
    };
    renderSelectors();
    const refreshSelectors = element("button", "secondary-btn", "Проверить снова");
    refreshSelectors.type = "button";
    refreshSelectors.addEventListener("click", () => {
      renderSelectors();
      setStatus("Селекторы проверены.", "info");
    });
    selectorsSection.append(selectorsCard, refreshSelectors);
    info.appendChild(selectorsSection);
    panel.appendChild(info);

    const storageSection = section("Хранилище IndexedDB");
    const storageCard = element("div", "diag-card", "Загрузка…");
    storageSection.appendChild(storageCard);
    panel.appendChild(storageSection);

    const failuresSection = section("Сохранённые ошибки");
    const failuresCard = element("div", "diag-card", "Загрузка…");
    failuresSection.appendChild(failuresCard);
    panel.appendChild(failuresSection);

    void (async () => {
      try {
        const estimate = await estimateStorage();
        if (!storageCard.isConnected) {
          return;
        }
        storageCard.replaceChildren(
          diagRow("Доступно", estimate.available ? "да" : "нет", estimate.available),
          diagRow("Использовано", formatBytes(estimate.usage)),
          diagRow("Квота", formatBytes(estimate.quota)),
          diagRow(
            "Постоянное хранение",
            estimate.persisted === undefined ? "—" : estimate.persisted ? "да" : "нет",
            estimate.persisted,
          ),
        );
      } catch (error) {
        if (storageCard.isConnected) {
          storageCard.replaceChildren(element("div", "diag-error", errorMessage(error)));
        }
      }
    })();

    void (async () => {
      try {
        const records = await listFailures();
        if (!failuresCard.isConnected) {
          return;
        }
        failuresCard.replaceChildren();
        if (records.length === 0) {
          failuresCard.appendChild(element("div", "hint", "Сохранённых ошибок нет."));
          return;
        }
        const latest = records[0];
        if (!latest) {
          return;
        }
        failuresCard.append(
          diagRow("Записей", String(records.length)),
          diagRow("Последняя стадия", STAGE_LABELS[latest.stage] ?? latest.stage),
          diagRow(
            "Время",
            new Date(latest.createdAt).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
          ),
        );
        const error = element("div", "diag-error", truncate(latest.error || "Без описания", 320));
        failuresCard.appendChild(error);

        const clearButton = element("button", "secondary-btn", "Очистить сохранённые ошибки");
        clearButton.type = "button";
        clearButton.addEventListener("click", async () => {
          setBusy(clearButton, true, "Очищаю…");
          try {
            if (deps.onClearFailures) {
              await deps.onClearFailures();
            } else {
              await clearFailures();
            }
            setStatus("Сохранённые ошибки очищены.", "ok");
            if (activeTab === "diagnostics") {
              renderContent();
            }
          } catch (clearError) {
            setStatus(`Не удалось очистить: ${errorMessage(clearError)}`, "error");
          } finally {
            setBusy(clearButton, false);
          }
        });
        failuresCard.appendChild(clearButton);
      } catch (error) {
        if (failuresCard.isConnected) {
          failuresCard.replaceChildren(element("div", "diag-error", errorMessage(error)));
        }
      }
    })();

    return panel;
  };

  const destroy = (): void => {
    close();
  };

  return {
    open,
    close,
    isOpen: () => host !== null,
    destroy,
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function section(title: string, hint?: string): HTMLElement {
  const node = element("section", "section");
  node.appendChild(element("h3", "section-title", title));
  if (hint) {
    node.appendChild(element("p", "section-hint", hint));
  }
  return node;
}

function addField(
  parent: HTMLElement,
  labelText: string,
  control: HTMLElement,
  hint?: string,
): void {
  const field = element("div", "field");
  const label = element("label", "field-label", labelText);
  const target = control.querySelector<HTMLElement>("input, textarea, select") ?? control;
  if (target.id) {
    label.htmlFor = target.id;
  }
  field.append(label, control);
  if (hint) {
    field.appendChild(element("div", "hint", hint));
  }
  parent.appendChild(field);
}

function addTextInput(
  parent: HTMLElement,
  labelText: string,
  value: string,
  onChange: (value: string) => void,
  options: {
    type?: "text" | "url" | "password";
    placeholder?: string;
    hint?: string;
  } = {},
): HTMLInputElement {
  const input = element("input", "input");
  input.id = `ocvd-input-${++idCounter}`;
  input.type = options.type ?? "text";
  input.value = value;
  input.autocomplete = "off";
  input.spellcheck = false;
  if (options.placeholder) {
    input.placeholder = options.placeholder;
  }
  input.addEventListener("input", () => onChange(input.value));
  addField(parent, labelText, input, options.hint);
  return input;
}

function addPasswordField(
  parent: HTMLElement,
  labelText: string,
  value: string,
  onChange: (value: string) => void,
): HTMLInputElement {
  const row = element("div", "password-row");
  const input = element("input", "input");
  input.id = `ocvd-input-${++idCounter}`;
  input.type = "password";
  input.value = value;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("input", () => onChange(input.value));

  const toggle = element("button", "inline-btn", "Показать");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Скрыть" : "Показать";
  });
  row.append(input, toggle);
  addField(parent, labelText, row);
  return input;
}

function addTextArea(
  parent: HTMLElement,
  labelText: string,
  value: string,
  onChange: (value: string) => void,
  hint?: string,
  rows = 4,
): HTMLTextAreaElement {
  const textarea = element("textarea", "textarea");
  textarea.id = `ocvd-input-${++idCounter}`;
  textarea.rows = rows;
  textarea.value = value;
  textarea.spellcheck = true;
  textarea.addEventListener("input", () => onChange(textarea.value));
  addField(parent, labelText, textarea, hint);
  return textarea;
}

function addNumberInput(
  parent: HTMLElement,
  labelText: string,
  value: number,
  onChange: (value: number) => void,
  options: { min?: number; max?: number; step?: number; hint?: string } = {},
): HTMLInputElement {
  const input = element("input", "input");
  input.id = `ocvd-input-${++idCounter}`;
  input.type = "number";
  input.inputMode = "decimal";
  input.value = Number.isFinite(value) ? String(value) : "";
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.step !== undefined) input.step = String(options.step);
  input.addEventListener("input", () => {
    onChange(input.value.trim() === "" ? Number.NaN : Number(input.value));
  });
  addField(parent, labelText, input, options.hint);
  return input;
}

function addSelect<T extends string>(
  parent: HTMLElement,
  labelText: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = element("select", "select");
  select.id = `ocvd-input-${++idCounter}`;
  for (const option of options) {
    const node = element("option", undefined, option.label);
    node.value = option.value;
    select.appendChild(node);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value as T));
  addField(parent, labelText, select);
  return select;
}

function addCheckbox(
  parent: HTMLElement,
  title: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  hint?: string,
): HTMLInputElement {
  const label = element("label", "check-row");
  const input = element("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const textWrap = element("span");
  textWrap.appendChild(element("span", "check-title", title));
  if (hint) {
    textWrap.appendChild(element("span", "check-hint", hint));
  }
  label.append(input, textWrap);
  parent.appendChild(label);
  return input;
}

function addModelInput(
  parent: HTMLElement,
  labelText: string,
  value: string,
  onChange: (value: string) => void,
  loadLabel: string,
  onLoad: (
    button: HTMLButtonElement,
    status: HTMLElement,
    input: HTMLInputElement,
    datalist: HTMLDataListElement,
  ) => Promise<void>,
): { input: HTMLInputElement; status: HTMLElement } {
  const listId = `ocvd-models-${++idCounter}`;
  const row = element("div", "model-row");
  const input = element("input", "input");
  input.id = `ocvd-input-${++idCounter}`;
  input.type = "text";
  input.value = value;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("list", listId);
  input.placeholder = "Имя модели";
  input.addEventListener("input", () => onChange(input.value));

  const datalist = element("datalist");
  datalist.id = listId;

  const button = element("button", "inline-btn", loadLabel);
  button.type = "button";
  const status = element("div", "inline-status");
  status.hidden = true;

  button.addEventListener("click", async () => {
    const idleLabel = button.textContent ?? loadLabel;
    button.textContent = "Загружаю…";
    button.disabled = true;
    status.hidden = true;
    try {
      await onLoad(button, status, input, datalist);
    } finally {
      button.textContent = idleLabel;
      button.disabled = false;
    }
  });

  row.append(input, button, datalist);
  addField(parent, labelText, row);
  parent.appendChild(status);
  return { input, status };
}

function fillDatalist(datalist: HTMLDataListElement, models: ModelInfo[]): void {
  datalist.replaceChildren();
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.label = model.label;
    datalist.appendChild(option);
  }
}

function diagRow(key: string, value: string, ok?: boolean): HTMLElement {
  const row = element("div", "diag-row");
  row.append(
    element("span", "diag-key", key),
    element(
      "span",
      ok === undefined ? "diag-value" : `diag-value ${ok ? "diag-ok" : "diag-bad"}`,
      value,
    ),
  );
  return row;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const mb = value / (1024 * 1024);
  if (mb >= 100) {
    return `${Math.round(mb)} МБ`;
  }
  return `${mb.toFixed(1)} МБ`;
}

function reasonLabel(reason: string | undefined): string {
  switch (reason) {
    case "empty":
      return "пустой текст";
    case "empty-prompt":
      return "пустой промпт";
    case "empty-result":
      return "пустой ответ";
    case "refusal":
      return "отказ модели";
    case "too-long":
      return "слишком длинный ответ";
    default:
      return "неизвестная причина";
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
