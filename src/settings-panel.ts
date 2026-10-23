import { GM_info } from "$";
import {
  applyLlmPreset,
  applySttPreset,
  defaultCleanupPrompt,
  STT_PRESETS,
  validateConfig,
} from "./config.js";
import { isAbortError } from "./http.js";
import { getLocale, type MessageKey, resolveLocale, setLocale, t } from "./i18n.js";
import { getSelectorStatus } from "./insert.js";
import { cleanupText } from "./llm.js";
import { listLlmModels, listSttModels, ModelsUnsupportedError } from "./models.js";
import { clearFailures, estimateStorage, listFailures } from "./storage.js";
import type {
  AppConfig,
  CleanupResult,
  FailureStage,
  LlmProviderId,
  LocalePreference,
  ModelInfo,
  SttProviderId,
} from "./types.js";

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

interface ModelListControl {
  setModels(models: ModelInfo[]): void;
}

const TABS: ReadonlyArray<{ id: TabId; key: MessageKey }> = [
  { id: "stt", key: "settings.tabs.stt" },
  { id: "llm", key: "settings.tabs.llm" },
  { id: "behavior", key: "settings.tabs.behavior" },
  { id: "diagnostics", key: "settings.tabs.diagnostics" },
];

const STT_OPTIONS: ReadonlyArray<{ value: SttProviderId; key: MessageKey }> = [
  { value: "groq", key: "settings.stt.provider.groq" },
  { value: "custom", key: "settings.stt.provider.custom" },
];

const LLM_OPTIONS: ReadonlyArray<{ value: LlmProviderId; key: MessageKey }> = [
  { value: "ollama-cloud", key: "settings.llm.provider.ollama-cloud" },
  { value: "ollama-local", key: "settings.llm.provider.ollama-local" },
  { value: "custom-openai", key: "settings.llm.provider.custom" },
];

const STAGE_KEY: Record<FailureStage, MessageKey> = {
  stt: "settings.stage.stt",
  llm: "settings.stage.llm",
  insert: "settings.stage.insert",
  submit: "settings.stage.submit",
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
  let activeModelListClose: (() => void) | null = null;

  const scriptVersion = (): string => {
    try {
      const version = GM_info?.script?.version;
      return typeof version === "string" && version !== "" ? version : "0.9.5";
    } catch {
      return "0.9.5";
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

  const closeActiveModelList = (): boolean => {
    const closeList = activeModelListClose;
    if (!closeList) {
      return false;
    }
    closeList();
    return true;
  };

  const setBusy = (
    button: HTMLButtonElement,
    busy: boolean,
    busyLabel = t("settings.loading"),
  ): void => {
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
    return t("common.unknownError");
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
    config.stt.apiKey = config.stt.apiKey.trim();
    config.stt.groqModel = config.stt.groqModel.trim();
    config.stt.customEndpoint = config.stt.customEndpoint.trim();
    config.stt.customModel = config.stt.customModel.trim();
    config.stt.language = config.stt.language.trim();
    config.llm.baseUrl = config.llm.baseUrl.trim();
    config.llm.apiKey = config.llm.apiKey.trim();
    config.llm.model = config.llm.model.trim();

    const targetLocale = resolveLocale(config.ui.language);
    const errors = validateConfig(config, targetLocale);
    if (errors.length > 0) {
      setStatus(errors.slice(0, 3).join(" • "), "error");
      return;
    }

    try {
      deps.saveConfig(config);
      setLocale(targetLocale);
      deps.onSaved?.(cloneConfig(config));
      setStatus(t("settings.saved"), "ok");
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
      closeTimer = setTimeout(() => {
        closeTimer = null;
        close();
      }, 450);
    } catch (error) {
      setStatus(t("settings.saveFailed", { message: errorMessage(error) }), "error");
    }
  };

  const buildHeader = (): HTMLElement => {
    const header = element("div", "header");
    const titleWrap = element("div", "title-wrap");
    titleWrap.append(
      element("h2", "title", t("settings.title")),
      element("div", "subtitle", t("settings.subtitle", { version: scriptVersion() })),
    );
    closeButton = element("button", "icon-btn", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", t("settings.close"));
    closeButton.addEventListener("click", close);
    header.append(titleWrap, closeButton);
    return header;
  };

  const buildTabs = (): HTMLElement => {
    const tabs = element("div", "tabs");
    tabs.setAttribute("role", "tablist");
    for (const tab of TABS) {
      const button = element("button", "tab", t(tab.key));
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
    closeActiveModelList();
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
        if (closeActiveModelList()) {
          return;
        }
        close();
      }
    };
    document.addEventListener("keydown", keydownHandler, true);
    closeButton?.focus();
  };

  const close = (): void => {
    testController?.abort();
    testController = null;
    closeActiveModelList();
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
  height: 92vh;
  height: 92dvh;
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
  flex: 0 0 auto;
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
  min-height: 0;
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
.select option {
  background: var(--bg);
  color: var(--fg);
}
.input::placeholder, .textarea::placeholder { color: var(--muted); }
.textarea { min-height: 84px; resize: vertical; line-height: 1.45; }
.prompt-textarea { min-height: 190px; }
.hint { margin-top: 5px; font-size: 12px; color: var(--muted); }
.password-row, .model-row { display: flex; gap: 8px; align-items: stretch; }
.password-row .input, .model-row .input { flex: 1 1 auto; min-width: 0; }
.model-list {
  margin-top: 6px;
  padding: 4px;
  max-height: 260px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28);
}
.model-list[hidden] { display: none; }
.model-option, .model-empty {
  padding: 9px 10px;
  border-radius: 8px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.model-option {
  display: flex;
  align-items: center;
  min-height: 40px;
  cursor: pointer;
}
.model-option:hover, .model-option--active { background: var(--field); }
.model-option[aria-selected="true"] { color: var(--accent); font-weight: 600; }
.model-empty { color: var(--muted); }
@media (pointer: coarse) {
  .model-option { min-height: 48px; }
}
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
  white-space: nowrap;
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
  white-space: nowrap;
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
@media (max-width: 520px) {
  .tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow-x: visible;
  }
  .tab {
    min-width: 0;
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
@media (max-width: 480px) {
  .password-row, .model-row { flex-wrap: wrap; }
  .password-row .input, .model-row .input { flex: 1 1 100%; }
  .password-row .inline-btn, .model-row .inline-btn { flex: 1 1 100%; }
  .footer { flex-wrap: wrap; }
  .footer-status { flex: 1 1 100%; }
  .primary-btn { flex: 1 1 100%; min-width: 0; }
}
@media (min-width: 760px) {
  .backdrop { align-items: center; padding: 24px; }
  .sheet {
    border-radius: 16px;
    height: min(86vh, 760px);
    height: min(86dvh, 760px);
  }
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
    sheet.setAttribute("aria-label", t("settings.title"));

    contentEl = element("div", "content");

    const footer = element("div", "footer");
    footerStatusEl = element("div", "footer-status");
    footerStatusEl.setAttribute("role", "status");
    footerStatusEl.setAttribute("aria-live", "polite");
    saveButton = element("button", "primary-btn", t("common.save"));
    saveButton.type = "button";
    saveButton.addEventListener("click", save);
    footer.append(footerStatusEl, saveButton);

    sheet.append(buildHeader(), buildTabs(), contentEl, footer);
    backdrop.appendChild(sheet);
    shadow.append(style, backdrop);
    document.documentElement.appendChild(host);
    renderContent();
  };

  const sampleText = (): string =>
    resolveLocale(draft?.ui.language ?? "auto") === "ru"
      ? t("settings.sample.ru")
      : t("settings.sample.en");

  const addModelInput = (
    parent: HTMLElement,
    labelText: string,
    value: string,
    onChange: (value: string) => void,
    loadLabel: string,
    onLoad: (status: HTMLElement, picker: ModelListControl) => Promise<void>,
    placeholder = "",
  ): { input: HTMLInputElement; status: HTMLElement } => {
    const row = element("div", "model-row");
    const input = element("input", "input");
    input.id = `ocvd-input-${++idCounter}`;
    input.type = "text";
    input.value = value;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = placeholder || t("settings.modelPlaceholder");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-autocomplete", "list");

    const list = element("div", "model-list");
    list.id = `ocvd-models-${++idCounter}`;
    list.setAttribute("role", "listbox");
    list.hidden = true;
    input.setAttribute("aria-controls", list.id);

    let models: ModelInfo[] = [];
    let matches: ModelInfo[] = [];
    let options: HTMLElement[] = [];
    let activeIndex = -1;

    const setActive = (index: number): void => {
      activeIndex = index;
      options.forEach((option, optionIndex) => {
        option.classList.toggle("model-option--active", optionIndex === index);
      });
      const active = options[index];
      if (!active) {
        input.removeAttribute("aria-activedescendant");
        return;
      }
      input.setAttribute("aria-activedescendant", active.id);
      if (typeof active.scrollIntoView === "function") {
        active.scrollIntoView({ block: "nearest" });
      }
    };

    const choose = (id: string): void => {
      input.value = id;
      onChange(id);
      closeList();
      input.focus();
    };

    const renderOptions = (filter: string): void => {
      const query = filter.trim().toLowerCase();
      matches =
        query === ""
          ? [...models]
          : models.filter(
              (model) =>
                model.id.toLowerCase().includes(query) || model.label.toLowerCase().includes(query),
            );
      options = [];
      list.replaceChildren();
      if (matches.length === 0) {
        list.appendChild(element("div", "model-empty", t("settings.models.noMatches")));
        setActive(-1);
        return;
      }
      const current = input.value.trim();
      let highlighted = 0;
      matches.forEach((model, index) => {
        const option = element("div", "model-option", model.label || model.id);
        option.id = `${list.id}-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(model.id === current));
        if (model.id === current) {
          highlighted = index;
        }
        option.addEventListener("click", () => choose(model.id));
        list.appendChild(option);
        options.push(option);
      });
      setActive(highlighted);
    };

    const onOutsidePointerDown = (event: PointerEvent): void => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.includes(input) || path.includes(list)) {
        return;
      }
      closeList();
    };

    const closeList = (): void => {
      if (list.hidden) {
        return;
      }
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      activeIndex = -1;
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      if (activeModelListClose === closeList) {
        activeModelListClose = null;
      }
    };

    const openList = (filter: string): void => {
      if (models.length === 0) {
        return;
      }
      if (activeModelListClose && activeModelListClose !== closeList) {
        activeModelListClose();
      }
      renderOptions(filter);
      if (list.hidden) {
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        document.addEventListener("pointerdown", onOutsidePointerDown, true);
        if (typeof list.scrollIntoView === "function") {
          list.scrollIntoView({ block: "nearest" });
        }
      }
      activeModelListClose = closeList;
    };

    input.addEventListener("input", () => {
      onChange(input.value);
      if (models.length > 0) {
        openList(input.value);
      }
    });

    input.addEventListener("click", () => {
      if (models.length > 0) {
        openList("");
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.isComposing) {
        return;
      }
      if (list.hidden) {
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && models.length > 0) {
          event.preventDefault();
          openList("");
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (options.length === 0) {
          return;
        }
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + options.length) % options.length);
        return;
      }
      if (event.key === "Enter") {
        const model = matches[activeIndex];
        if (model) {
          event.preventDefault();
          choose(model.id);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeList();
        return;
      }
      if (event.key === "Tab") {
        closeList();
      }
    });

    const picker: ModelListControl = {
      setModels: (next) => {
        models = next;
        if (input.value.trim() === "" && next[0]) {
          input.value = next[0].id;
          onChange(next[0].id);
        }
        openList("");
      },
    };

    const button = element("button", "inline-btn", loadLabel);
    button.type = "button";
    const status = element("div", "inline-status");
    status.hidden = true;

    button.addEventListener("click", async () => {
      const idleLabel = button.textContent ?? loadLabel;
      button.textContent = t("settings.loading");
      button.disabled = true;
      status.hidden = true;
      try {
        await onLoad(status, picker);
      } finally {
        button.textContent = idleLabel;
        button.disabled = false;
      }
    });

    row.append(input, button);
    const field = addField(parent, labelText, row);
    field.appendChild(list);
    parent.appendChild(status);
    return { input, status };
  };

  const buildSttTab = (): HTMLElement => {
    const panel = element("div", "tab-panel");
    const provider = draft?.stt.provider ?? "groq";
    const isCustom = provider === "custom";
    const recognition = section(t("settings.stt.section"), t("settings.stt.sectionHint"));

    addSelect(
      recognition,
      t("settings.stt.provider"),
      STT_OPTIONS.map((option) => ({ value: option.value, label: t(option.key) })),
      provider,
      (value) => {
        if (!draft) return;
        draft.stt = applySttPreset(draft.stt, value);
        renderContent();
      },
    );

    if (isCustom) {
      addTextInput(
        recognition,
        t("settings.stt.endpoint"),
        draft?.stt.customEndpoint ?? "",
        (value) => {
          if (draft) draft.stt.customEndpoint = value;
        },
        {
          type: "url",
          placeholder: "https://api.openai.com/v1/audio/transcriptions",
        },
      );
    } else {
      recognition.appendChild(
        element(
          "div",
          "hint",
          t("settings.stt.groqEndpoint", { endpoint: STT_PRESETS.groq.endpoint }),
        ),
      );
    }

    addPasswordField(
      recognition,
      t("settings.stt.apiKey"),
      draft?.stt.apiKey ?? "",
      (value) => {
        if (draft) draft.stt.apiKey = value;
      },
      isCustom ? t("settings.stt.customKeyHint") : undefined,
    );

    const setModel = (value: string): void => {
      if (!draft) return;
      if (isCustom) {
        draft.stt.customModel = value;
      } else {
        draft.stt.groqModel = value;
      }
    };
    addModelInput(
      recognition,
      t("settings.stt.model"),
      isCustom ? (draft?.stt.customModel ?? "") : (draft?.stt.groqModel ?? ""),
      setModel,
      t("settings.stt.loadModels"),
      async (status, picker) => {
        if (!draft) {
          return;
        }
        const controller = startTest();
        try {
          const models = await listSttModels(draft, controller.signal);
          picker.setModels(models);
          setInlineStatus(status, t("settings.stt.modelsLoaded", { count: models.length }), "ok");
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
        }
      },
      isCustom ? "" : STT_PRESETS.groq.model,
    );

    addTextInput(
      recognition,
      t("settings.stt.language"),
      draft?.stt.language ?? "",
      (value) => {
        if (draft) draft.stt.language = value;
      },
      { placeholder: t("settings.stt.languagePlaceholder") },
    );

    addTextArea(
      recognition,
      t("settings.stt.prompt"),
      draft?.stt.prompt ?? "",
      (value) => {
        if (draft) draft.stt.prompt = value;
      },
      t("settings.stt.promptHint"),
      3,
    );

    addNumberInput(
      recognition,
      t("settings.stt.temperature"),
      draft?.stt.temperature ?? 0,
      (value) => {
        if (draft) draft.stt.temperature = value;
      },
      { min: 0, max: 1, step: 0.1, hint: t("settings.stt.temperatureHint") },
    );

    const testStatus = element("div", "inline-status");
    testStatus.hidden = true;
    const testButton = element("button", "secondary-btn", t("settings.stt.test"));
    testButton.type = "button";
    testButton.addEventListener("click", async () => {
      if (!draft) return;
      const controller = startTest();
      setBusy(testButton, true, t("settings.loading"));
      setInlineStatus(testStatus, t("settings.stt.testing"), "info");
      try {
        const models = await listSttModels(draft, controller.signal);
        setInlineStatus(testStatus, t("settings.stt.testOk", { count: models.length }), "ok");
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        if (error instanceof ModelsUnsupportedError) {
          setInlineStatus(testStatus, t("settings.stt.testUnsupported"), "warn");
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
    const cleanup = section(t("settings.llm.section"), t("settings.llm.sectionHint"));

    addCheckbox(cleanup, t("settings.llm.enable"), draft?.llm.enabled ?? true, (checked) => {
      if (draft) draft.llm.enabled = checked;
    });

    addSelect(
      cleanup,
      t("settings.llm.provider"),
      LLM_OPTIONS.map((option) => ({ value: option.value, label: t(option.key) })),
      draft?.llm.provider ?? "ollama-cloud",
      (value) => {
        if (!draft) return;
        draft.llm = applyLlmPreset(draft.llm, value);
        renderContent();
      },
    );

    addTextInput(
      cleanup,
      t("settings.llm.baseUrl"),
      draft?.llm.baseUrl ?? "",
      (value) => {
        if (draft) draft.llm.baseUrl = value;
      },
      { type: "url", placeholder: "https://ollama.com" },
    );

    addPasswordField(cleanup, t("settings.llm.apiKey"), draft?.llm.apiKey ?? "", (value) => {
      if (draft) draft.llm.apiKey = value;
    });

    addModelInput(
      cleanup,
      t("settings.llm.model"),
      draft?.llm.model ?? "",
      (value) => {
        if (draft) draft.llm.model = value;
      },
      t("settings.llm.loadModels"),
      async (status, picker) => {
        if (!draft) {
          return;
        }
        const controller = startTest();
        try {
          const models = await listLlmModels(draft, controller.signal);
          picker.setModels(models);
          setInlineStatus(status, t("settings.llm.modelsLoaded", { count: models.length }), "ok");
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
        }
      },
    );

    addCheckbox(
      cleanup,
      t("settings.llm.reasoning"),
      draft?.llm.reasoning ?? false,
      (checked) => {
        if (draft) draft.llm.reasoning = checked;
      },
      t("settings.llm.reasoningHint"),
    );

    const testStatus = element("div", "inline-status");
    testStatus.hidden = true;
    const testButton = element("button", "secondary-btn", t("settings.llm.test"));
    testButton.type = "button";
    testButton.addEventListener("click", async () => {
      if (!draft) return;
      const controller = startTest();
      setBusy(testButton, true, t("settings.loading"));
      setInlineStatus(testStatus, t("settings.llm.testing"), "info");
      try {
        const models = await listLlmModels(draft, controller.signal);
        if (!draft.llm.enabled) {
          setInlineStatus(
            testStatus,
            t("settings.llm.disabledWithModels", { count: models.length }),
            "warn",
          );
          return;
        }
        const result = await cleanupText(sampleText(), draft, { signal: controller.signal });
        if (result.fallback) {
          setInlineStatus(
            testStatus,
            t("settings.llm.fallbackWithModels", {
              count: models.length,
              reason: reasonLabel(result.reason),
            }),
            "warn",
          );
        } else {
          setInlineStatus(
            testStatus,
            t("settings.llm.testOk", { text: truncate(result.text, 240) }),
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
    const promptSection = section(t("settings.prompt.section"), t("settings.prompt.hint"));
    const defaults = defaultCleanupPrompt(resolveLocale(draft?.ui.language ?? "auto"));
    const textarea = element("textarea", "textarea prompt-textarea");
    textarea.id = uid("cleanup-prompt");
    textarea.rows = 10;
    textarea.spellcheck = true;
    const initial = draft?.llm.prompt.trim() === "" ? defaults : draft?.llm.prompt;
    textarea.value = initial ?? defaults;
    promptTextarea = textarea;
    const label = element("label", "field-label", t("settings.prompt.label"));
    label.htmlFor = textarea.id;
    const counter = element(
      "div",
      "hint",
      t("settings.prompt.counter", { count: textarea.value.length }),
    );
    const field = element("div", "field");
    field.append(label, textarea, counter);
    textarea.addEventListener("input", () => {
      if (draft) draft.llm.prompt = textarea.value;
      counter.textContent = t("settings.prompt.counter", { count: textarea.value.length });
    });

    const tools = element("div", "tools-row");
    const reset = element("button", "secondary-btn", t("settings.prompt.reset"));
    reset.type = "button";
    let resetArmed = false;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    reset.addEventListener("click", () => {
      if (!resetArmed) {
        resetArmed = true;
        reset.textContent = t("settings.prompt.resetConfirm");
        resetTimer = setTimeout(() => {
          resetArmed = false;
          resetTimer = null;
          reset.textContent = t("settings.prompt.reset");
        }, 3000);
        return;
      }
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      resetArmed = false;
      reset.textContent = t("settings.prompt.reset");
      textarea.value = defaults;
      if (draft) draft.llm.prompt = defaults;
      counter.textContent = t("settings.prompt.counter", { count: textarea.value.length });
      setStatus(t("settings.prompt.resetDone"), "warn");
    });

    const testButton = element("button", "secondary-btn", t("settings.prompt.test"));
    testButton.type = "button";
    const testStatus = element("div", "inline-status");
    testStatus.hidden = true;
    const resultEl = element("div", "prompt-result");
    resultEl.hidden = true;

    testButton.addEventListener("click", async () => {
      if (!draft) return;
      if (!draft.llm.enabled) {
        setInlineStatus(testStatus, t("settings.prompt.disabled"), "warn");
        return;
      }
      if (promptTextarea?.isConnected) {
        draft.llm.prompt = promptTextarea.value;
      }
      const controller = startTest();
      setBusy(testButton, true, t("settings.prompt.testing"));
      setInlineStatus(testStatus, t("settings.prompt.sending"), "info");
      resultEl.hidden = true;
      const sample = deps.getLastRawText?.()?.trim() || sampleText();
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
            t("settings.prompt.fallback", { reason: reasonLabel(result.reason) }),
            "warn",
          );
        } else {
          setInlineStatus(testStatus, t("settings.prompt.done"), "ok");
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

    const interfaceSection = section(
      t("settings.behavior.interfaceSection"),
      t("settings.behavior.languageHint"),
    );
    addSelect<LocalePreference>(
      interfaceSection,
      t("settings.behavior.language"),
      [
        { value: "auto", label: t("settings.behavior.language.auto") },
        { value: "ru", label: t("settings.behavior.language.ru") },
        { value: "en", label: t("settings.behavior.language.en") },
      ],
      draft?.ui.language ?? "auto",
      (value) => {
        if (draft) draft.ui.language = value;
      },
    );
    panel.appendChild(interfaceSection);

    const submitSection = section(
      t("settings.behavior.autoSubmitSection"),
      t("settings.behavior.autoSubmitSectionHint"),
    );
    addCheckbox(
      submitSection,
      t("settings.behavior.autoSubmit"),
      draft?.behavior.autoSubmit ?? true,
      (checked) => {
        if (draft) draft.behavior.autoSubmit = checked;
      },
    );
    addCheckbox(
      submitSection,
      t("settings.behavior.autoSubmitQuestion"),
      draft?.behavior.autoSubmitQuestion ?? false,
      (checked) => {
        if (draft) draft.behavior.autoSubmitQuestion = checked;
      },
      t("settings.behavior.autoSubmitQuestionHint"),
    );
    panel.appendChild(submitSection);

    const failureSection = section(t("settings.behavior.failureSection"));
    addCheckbox(
      failureSection,
      t("settings.behavior.fallbackToRaw"),
      draft?.behavior.fallbackToRaw ?? true,
      (checked) => {
        if (draft) draft.behavior.fallbackToRaw = checked;
      },
      t("settings.behavior.fallbackToRawHint"),
    );
    addCheckbox(
      failureSection,
      t("settings.behavior.saveFailedAudio"),
      draft?.behavior.saveFailedAudio ?? true,
      (checked) => {
        if (draft) draft.behavior.saveFailedAudio = checked;
      },
      t("settings.behavior.saveFailedAudioHint"),
    );
    panel.appendChild(failureSection);

    const recordingSection = section(t("settings.behavior.recordingSection"));
    addNumberInput(
      recordingSection,
      t("settings.behavior.maxRecording"),
      draft?.behavior.maxRecordingSeconds ?? 120,
      (value) => {
        if (draft) draft.behavior.maxRecordingSeconds = value;
      },
      { min: 5, max: 600, step: 5 },
    );
    addNumberInput(
      recordingSection,
      t("settings.behavior.maxAttempts"),
      draft?.retry.maxAttempts ?? 3,
      (value) => {
        if (draft) draft.retry.maxAttempts = Math.round(value);
      },
      {
        min: 1,
        max: 5,
        step: 1,
        hint: t("settings.behavior.maxAttemptsHint"),
      },
    );
    panel.appendChild(recordingSection);
    return panel;
  };

  const buildDiagnosticsTab = (): HTMLElement => {
    const panel = element("div", "tab-panel");
    const info = section(t("settings.diag.infoSection"));
    const versionCard = element("div", "diag-card");
    const pageStatus = getSelectorStatus();
    versionCard.append(
      diagRow(t("settings.diag.version"), scriptVersion()),
      diagRow(t("settings.diag.host"), window.location.host || "—"),
      diagRow(
        t("settings.diag.page"),
        pageStatus.composerDock || pageStatus.composerForm || pageStatus.composerEditor
          ? t("settings.diag.pageYes")
          : t("settings.diag.pageNo"),
      ),
    );
    info.appendChild(versionCard);

    const selectorsSection = section(
      t("settings.diag.selectorsSection"),
      t("settings.diag.selectorsHint"),
    );
    const selectorsCard = element("div", "diag-card");
    const renderSelectors = (): void => {
      selectorsCard.replaceChildren();
      const status = getSelectorStatus();
      const labels: Record<keyof typeof status, MessageKey> = {
        composerDock: "settings.diag.selector.composerDock",
        composerForm: "settings.diag.selector.composerForm",
        composerEditor: "settings.diag.selector.composerEditor",
        composerActions: "settings.diag.selector.composerActions",
        composerActionsResolved: "settings.diag.selector.composerActionsResolved",
        composerSubmit: "settings.diag.selector.composerSubmit",
        composerMic: "settings.diag.selector.composerMic",
        composerMicVisible: "settings.diag.selector.composerMicVisible",
        questionDock: "settings.diag.selector.questionDock",
        questionInput: "settings.diag.selector.questionInput",
        questionInputCurrent: "settings.diag.selector.questionInputCurrent",
        questionInputLegacy: "settings.diag.selector.questionInputLegacy",
        questionHeaderActions: "settings.diag.selector.questionHeaderActions",
        questionCustomOption: "settings.diag.selector.questionCustomOption",
        questionFooter: "settings.diag.selector.questionFooter",
        questionMic: "settings.diag.selector.questionMic",
        questionMicVisible: "settings.diag.selector.questionMicVisible",
      };
      for (const key of Object.keys(labels) as Array<keyof typeof status>) {
        selectorsCard.appendChild(
          diagRow(
            t(labels[key]),
            status[key] ? t("settings.diag.present") : t("settings.diag.missing"),
            status[key],
          ),
        );
      }
    };
    renderSelectors();
    const refreshSelectors = element("button", "secondary-btn", t("settings.diag.refresh"));
    refreshSelectors.type = "button";
    refreshSelectors.addEventListener("click", () => {
      renderSelectors();
      setStatus(t("settings.diag.checked"), "info");
    });
    selectorsSection.append(selectorsCard, refreshSelectors);
    info.appendChild(selectorsSection);
    panel.appendChild(info);

    const storageSection = section(t("settings.diag.storageSection"));
    const storageCard = element("div", "diag-card", t("common.loading"));
    storageSection.appendChild(storageCard);
    panel.appendChild(storageSection);

    const failuresSection = section(t("settings.diag.failuresSection"));
    const failuresCard = element("div", "diag-card", t("common.loading"));
    failuresSection.appendChild(failuresCard);
    panel.appendChild(failuresSection);

    void (async () => {
      try {
        const estimate = await estimateStorage();
        if (!storageCard.isConnected) {
          return;
        }
        storageCard.replaceChildren(
          diagRow(
            t("settings.diag.available"),
            estimate.available ? t("common.yes") : t("common.no"),
            estimate.available,
          ),
          diagRow(t("settings.diag.used"), formatBytes(estimate.usage)),
          diagRow(t("settings.diag.quota"), formatBytes(estimate.quota)),
          diagRow(
            t("settings.diag.persisted"),
            estimate.persisted === undefined
              ? t("common.dash")
              : estimate.persisted
                ? t("common.yes")
                : t("common.no"),
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
          failuresCard.appendChild(element("div", "hint", t("settings.diag.noFailures")));
          return;
        }
        const latest = records[0];
        if (!latest) {
          return;
        }
        failuresCard.append(
          diagRow(t("settings.diag.records"), String(records.length)),
          diagRow(t("settings.diag.lastStage"), t(STAGE_KEY[latest.stage])),
          diagRow(
            t("settings.diag.time"),
            new Date(latest.createdAt).toLocaleString(getLocale() === "ru" ? "ru-RU" : "en-US", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
          ),
        );
        const error = element(
          "div",
          "diag-error",
          truncate(latest.error || t("settings.diag.noDescription"), 320),
        );
        failuresCard.appendChild(error);

        const clearButton = element("button", "secondary-btn", t("settings.diag.clear"));
        clearButton.type = "button";
        clearButton.addEventListener("click", async () => {
          setBusy(clearButton, true, t("settings.diag.clearing"));
          try {
            if (deps.onClearFailures) {
              await deps.onClearFailures();
            } else {
              await clearFailures();
            }
            setStatus(t("settings.diag.cleared"), "ok");
            if (activeTab === "diagnostics") {
              renderContent();
            }
          } catch (clearError) {
            setStatus(
              t("settings.diag.clearFailed", { message: errorMessage(clearError) }),
              "error",
            );
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
): HTMLElement {
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
  return field;
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
  hint?: string,
): HTMLInputElement {
  const row = element("div", "password-row");
  const input = element("input", "input");
  input.id = `ocvd-input-${++idCounter}`;
  input.type = "password";
  input.value = value;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("input", () => onChange(input.value));

  const toggle = element("button", "inline-btn", t("common.show"));
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? t("common.hide") : t("common.show");
  });
  row.append(input, toggle);
  addField(parent, labelText, row, hint);
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
  hint?: string,
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
  addField(parent, labelText, select, hint);
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
    return t("settings.megabytes", { value: Math.round(mb) });
  }
  return t("settings.megabytes", { value: mb.toFixed(1) });
}

function reasonLabel(reason: string | undefined): string {
  switch (reason) {
    case "empty":
      return t("settings.reason.emptyText");
    case "empty-prompt":
      return t("settings.reason.emptyPrompt");
    case "empty-result":
      return t("settings.reason.emptyResponse");
    case "refusal":
      return t("settings.reason.refusal");
    case "too-long":
      return t("settings.reason.tooLong");
    default:
      return t("settings.reason.unknown");
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
