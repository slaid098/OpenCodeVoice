import { formatTime } from "./audio.js";
import {
  SELECTORS,
  findComposerActions,
  findComposerDock,
  findQuestionFooter,
  findQuestionInput,
} from "./insert.js";
import type { RecoveryActions, ToastOptions } from "./pipeline.js";
import type { DictationPhase, FailedDictation, InsertTarget } from "./types.js";

export interface UiOptions {
  onToggle: (target: InsertTarget) => void;
  onCancel: () => void;
  onOpenSettings: () => void;
}

export interface Ui {
  start(): void;
  destroy(): void;
  refresh(): void;
  setState(state: DictationPhase, elapsedSeconds?: number): void;
  toast(message: string, options?: ToastOptions): void;
  showRecovery(record: FailedDictation, actions: RecoveryActions): void;
  hideRecovery(): void;
  openSettings(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_ID = "ocvd-page-style";

const PHASE_LABEL: Record<Exclude<DictationPhase, "idle">, string> = {
  recording: "Запись",
  stt: "Распознаю речь…",
  llm: "Чищу текст…",
  insert: "Вставляю текст…",
  submit: "Отправляю…",
};

const STAGE_LABEL: Record<FailedDictation["stage"], string> = {
  stt: "Распознавание",
  llm: "Очистка",
  insert: "Вставка",
  submit: "Отправка",
};

const RETRY_LABEL: Record<FailedDictation["stage"], string> = {
  stt: "Повторить STT",
  llm: "Повторить очистку",
  insert: "Повторить вставку",
  submit: "Отправить снова",
};

export function createUi(options: UiOptions): Ui {
  let phase: DictationPhase = "idle";
  let elapsedSeconds = 0;
  let started = false;
  let observer: MutationObserver | null = null;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let statusEl: HTMLElement | null = null;
  let statusIconEl: HTMLElement | null = null;
  let statusTextEl: HTMLElement | null = null;
  let toastEl: HTMLElement | null = null;
  let recoveryEl: HTMLElement | null = null;

  const ensureStyle = (): void => {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
button.ocvd-btn {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  margin: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  flex: 0 0 auto;
  vertical-align: middle;
}
button.ocvd-btn:hover { background: rgba(127, 127, 127, 0.14); }
button.ocvd-btn:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
button.ocvd-btn[disabled] { opacity: 0.55; cursor: default; background: transparent; }
button.ocvd-btn.ocvd-btn--recording {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.16);
}
button.ocvd-btn.ocvd-btn--recording:hover { background: rgba(239, 68, 68, 0.24); }
button.ocvd-btn svg { width: 20px; height: 20px; display: block; }
.ocvd-spinner {
  width: 18px;
  height: 18px;
  box-sizing: border-box;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ocvd-spin-page 0.8s linear infinite;
}
.ocvd-fallback-actions {
  position: absolute;
  right: 56px;
  bottom: 8px;
  z-index: 5;
  display: inline-flex;
  gap: 2px;
  align-items: center;
}
.ocvd-question-fallback {
  display: flex;
  justify-content: flex-end;
  padding: 4px 6px;
}
@media (pointer: coarse) {
  button.ocvd-btn { width: 48px; height: 48px; min-width: 48px; min-height: 48px; }
}
@keyframes ocvd-spin-page { to { transform: rotate(360deg); } }
`;
    document.documentElement.appendChild(style);
  };

  const ensureHost = (): void => {
    if (host?.isConnected && shadow) {
      return;
    }
    host = document.createElement("div");
    host.dataset.ocvdUi = "overlay";
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;pointer-events:none;display:block;";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
:host { all: initial; }
* { box-sizing: border-box; }
.ocvd-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.35;
  color: #f9fafb;
  -webkit-tap-highlight-color: transparent;
}
.ocvd-bottom {
  position: absolute;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 88px);
  transform: translateX(-50%);
  width: min(560px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.ocvd-status, .ocvd-toast, .ocvd-recovery {
  pointer-events: auto;
  background: rgba(17, 24, 39, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
  padding: 10px 12px;
}
.ocvd-status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
}
.ocvd-status[hidden], .ocvd-toast[hidden], .ocvd-recovery[hidden] { display: none; }
.ocvd-status-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex: 0 0 auto; }
.ocvd-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.2);
  animation: ocvd-pulse 1.2s ease-in-out infinite;
}
.ocvd-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ocvd-spin 0.8s linear infinite;
}
.ocvd-status-text { flex: 1 1 auto; font-weight: 500; font-variant-numeric: tabular-nums; }
.ocvd-cancel, .ocvd-btn {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
}
.ocvd-cancel:hover, .ocvd-btn:hover { background: rgba(255, 255, 255, 0.17); }
.ocvd-cancel:focus-visible, .ocvd-btn:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
.ocvd-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  border-color: rgba(96, 165, 250, 0.4);
}
.ocvd-toast.ocvd-error { border-color: rgba(248, 113, 113, 0.55); }
.ocvd-toast-text { flex: 1 1 auto; overflow-wrap: anywhere; }
.ocvd-toast .ocvd-btn { flex: 0 0 auto; background: rgba(96, 165, 250, 0.22); }
.ocvd-toast .ocvd-btn:hover { background: rgba(96, 165, 250, 0.32); }
.ocvd-close {
  all: unset;
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 22px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  flex: 0 0 auto;
}
.ocvd-close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.ocvd-recovery {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  left: 50%;
  transform: translateX(-50%);
  width: min(560px, calc(100vw - 24px));
  border-color: rgba(251, 191, 36, 0.5);
}
.ocvd-recovery-title {
  font-size: 13px;
  font-weight: 600;
  color: #fbbf24;
  margin-bottom: 4px;
  display: flex;
  gap: 8px;
  align-items: baseline;
  justify-content: space-between;
}
.ocvd-recovery-time { font-weight: 400; color: rgba(255, 255, 255, 0.55); font-size: 12px; }
.ocvd-recovery-text {
  margin: 0 0 8px;
  color: rgba(255, 255, 255, 0.85);
  overflow-wrap: anywhere;
  max-height: 72px;
  overflow: auto;
}
.ocvd-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.ocvd-actions .ocvd-btn { min-height: 44px; padding: 0 12px; font-size: 13px; }
.ocvd-btn--primary { background: rgba(96, 165, 250, 0.26); }
.ocvd-btn--primary:hover { background: rgba(96, 165, 250, 0.36); }
.ocvd-btn--danger { background: rgba(239, 68, 68, 0.18); color: #fecaca; }
.ocvd-btn--danger:hover { background: rgba(239, 68, 68, 0.28); }
@keyframes ocvd-spin { to { transform: rotate(360deg); } }
@keyframes ocvd-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
@media (prefers-color-scheme: light) {
  .ocvd-layer { color: #111827; }
  .ocvd-status, .ocvd-toast, .ocvd-recovery { background: rgba(255, 255, 255, 0.98); border-color: rgba(0, 0, 0, 0.14); }
  .ocvd-recovery-text { color: rgba(17, 24, 39, 0.85); }
  .ocvd-recovery-time { color: rgba(17, 24, 39, 0.55); }
  .ocvd-cancel, .ocvd-btn { background: rgba(17, 24, 39, 0.08); }
  .ocvd-cancel:hover, .ocvd-btn:hover { background: rgba(17, 24, 39, 0.14); }
  .ocvd-close { color: rgba(17, 24, 39, 0.6); }
  .ocvd-close:hover { background: rgba(17, 24, 39, 0.08); color: #111827; }
  .ocvd-btn--danger { color: #991b1b; }
}
`;

    const layer = document.createElement("div");
    layer.className = "ocvd-layer";

    const bottom = document.createElement("div");
    bottom.className = "ocvd-bottom";

    statusEl = document.createElement("div");
    statusEl.className = "ocvd-status";
    statusEl.hidden = true;
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");

    statusIconEl = document.createElement("span");
    statusIconEl.className = "ocvd-status-icon";
    statusTextEl = document.createElement("span");
    statusTextEl.className = "ocvd-status-text";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ocvd-cancel";
    cancelButton.textContent = "Отмена";
    cancelButton.addEventListener("click", () => options.onCancel());
    statusEl.append(statusIconEl, statusTextEl, cancelButton);

    toastEl = document.createElement("div");
    toastEl.className = "ocvd-toast";
    toastEl.hidden = true;

    recoveryEl = document.createElement("div");
    recoveryEl.className = "ocvd-recovery";
    recoveryEl.hidden = true;
    recoveryEl.setAttribute("role", "alert");

    bottom.append(statusEl, toastEl);
    layer.append(bottom, recoveryEl);
    shadow.append(style, layer);
    document.documentElement.appendChild(host);
  };

  const createIcon = (children: SVGElement[]): SVGSVGElement => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const child of children) {
      svg.appendChild(child);
    }
    return svg;
  };

  const svgPath = (d: string): SVGPathElement => {
    const node = document.createElementNS(SVG_NS, "path");
    node.setAttribute("d", d);
    return node;
  };

  const micIcon = (): SVGSVGElement =>
    createIcon([
      svgPath("M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"),
      svgPath("M19 10v2a7 7 0 0 1-14 0v-2"),
      svgPath("M12 19v3"),
    ]);

  const stopIcon = (): SVGSVGElement => {
    const svg = createIcon([]);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "6");
    rect.setAttribute("y", "6");
    rect.setAttribute("width", "12");
    rect.setAttribute("height", "12");
    rect.setAttribute("rx", "2");
    rect.setAttribute("fill", "currentColor");
    rect.setAttribute("stroke", "none");
    svg.appendChild(rect);
    return svg;
  };

  const gearIcon = (): SVGSVGElement => {
    const circle = (cx: string, cy: string): SVGCircleElement => {
      const node = document.createElementNS(SVG_NS, "circle");
      node.setAttribute("cx", cx);
      node.setAttribute("cy", cy);
      node.setAttribute("r", "3");
      return node;
    };
    return createIcon([
      svgPath("M20 7h-9"),
      svgPath("M14 17H5"),
      circle("17", "17"),
      circle("7", "7"),
    ]);
  };

  const spinner = (): HTMLElement => {
    const node = document.createElement("span");
    node.className = "ocvd-spinner";
    return node;
  };

  const micLabel = (): string => {
    if (phase === "recording") {
      return "Остановить запись";
    }
    if (phase === "idle") {
      return "Начать голосовую диктовку";
    }
    return "Идёт обработка записи";
  };

  const renderMicButton = (button: HTMLButtonElement): void => {
    if (button.dataset.ocvdState === phase && button.firstChild) {
      return;
    }
    button.replaceChildren();
    button.disabled = phase !== "idle" && phase !== "recording";
    button.dataset.ocvdState = phase;
    button.classList.toggle("ocvd-btn--recording", phase === "recording");
    button.setAttribute("aria-label", micLabel());
    button.setAttribute("title", micLabel());
    if (phase === "recording") {
      button.appendChild(stopIcon());
    } else if (phase === "idle") {
      button.appendChild(micIcon());
    } else {
      button.appendChild(spinner());
    }
  };

  const renderMicButtons = (): void => {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      'button[data-ocvd$="-mic"]',
    )) {
      renderMicButton(button);
    }
  };

  const renderStatus = (): void => {
    if (!statusEl || !statusIconEl || !statusTextEl) {
      return;
    }
    if (phase === "idle") {
      statusEl.hidden = true;
      return;
    }
    statusEl.hidden = false;
    statusIconEl.replaceChildren();
    if (phase === "recording") {
      const dot = document.createElement("span");
      dot.className = "ocvd-dot";
      statusIconEl.appendChild(dot);
      statusTextEl.textContent = `${PHASE_LABEL.recording} ${formatTime(elapsedSeconds)}`;
    } else {
      statusIconEl.appendChild(spinner());
      statusTextEl.textContent = PHASE_LABEL[phase];
    }
  };

  const hideToast = (): void => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastEl) {
      toastEl.hidden = true;
      toastEl.replaceChildren();
    }
  };

  const showToast = (message: string, toastOptions: ToastOptions = {}): void => {
    ensureHost();
    if (!toastEl) {
      return;
    }
    hideToast();
    toastEl.hidden = false;
    toastEl.className = toastOptions.error ? "ocvd-toast ocvd-error" : "ocvd-toast";
    toastEl.setAttribute("role", toastOptions.error ? "alert" : "status");

    const text = document.createElement("span");
    text.className = "ocvd-toast-text";
    text.textContent = message;
    toastEl.appendChild(text);

    if (toastOptions.actionLabel && toastOptions.action) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "ocvd-btn";
      action.textContent = toastOptions.actionLabel;
      action.addEventListener("click", () => {
        hideToast();
        toastOptions.action?.();
      });
      toastEl.appendChild(action);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ocvd-close";
    close.setAttribute("aria-label", "Закрыть уведомление");
    close.textContent = "×";
    close.addEventListener("click", hideToast);
    toastEl.appendChild(close);

    const duration =
      toastOptions.durationMs ??
      (toastOptions.action ? 12_000 : toastOptions.error ? 8_000 : 4_000);
    if (duration > 0) {
      toastTimer = setTimeout(() => {
        toastTimer = null;
        hideToast();
      }, duration);
    }
  };

  const showRecovery = (record: FailedDictation, actions: RecoveryActions): void => {
    ensureHost();
    if (!recoveryEl) {
      return;
    }
    recoveryEl.hidden = false;
    recoveryEl.replaceChildren();

    const title = document.createElement("div");
    title.className = "ocvd-recovery-title";
    const titleText = document.createElement("span");
    titleText.textContent = `Незавершённая диктовка · ${STAGE_LABEL[record.stage]}`;
    const time = document.createElement("span");
    time.className = "ocvd-recovery-time";
    time.textContent = new Date(record.createdAt).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    title.append(titleText, time);

    const message = document.createElement("p");
    message.className = "ocvd-recovery-text";
    message.textContent = record.error || "Последняя операция не завершилась.";
    if (message.textContent.length > 220) {
      message.textContent = `${message.textContent.slice(0, 219)}…`;
    }

    const row = document.createElement("div");
    row.className = "ocvd-actions";

    const addButton = (
      label: string,
      handler: () => void,
      variant?: "primary" | "danger",
    ): void => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = variant ? `ocvd-btn ocvd-btn--${variant}` : "ocvd-btn";
      button.textContent = label;
      button.addEventListener("click", () => {
        if (recoveryEl) {
          recoveryEl.hidden = true;
        }
        handler();
      });
      row.appendChild(button);
    };

    addButton(RETRY_LABEL[record.stage], actions.onRetry, "primary");
    if (actions.onSubmitRaw) {
      addButton("Отправить как есть", actions.onSubmitRaw);
    }
    if (actions.onInsertRaw) {
      addButton("Вставить сырой текст", actions.onInsertRaw);
    }
    addButton("Настройки", actions.onSettings);
    addButton("Удалить", actions.onDelete, "danger");

    recoveryEl.append(title, message, row);
  };

  const hideRecovery = (): void => {
    if (recoveryEl) {
      recoveryEl.hidden = true;
      recoveryEl.replaceChildren();
    }
  };

  const makeMicButton = (target: InsertTarget): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ocvd-btn ocvd-mic";
    button.dataset.ocvd = `${target}-mic`;
    button.setAttribute("aria-label", micLabel());
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onToggle(target);
    });
    renderMicButton(button);
    return button;
  };

  const makeGearButton = (): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ocvd-btn ocvd-gear";
    button.dataset.ocvd = "composer-settings";
    button.setAttribute("aria-label", "Настройки голосового ввода");
    button.setAttribute("title", "Настройки голосового ввода");
    button.appendChild(gearIcon());
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onOpenSettings();
    });
    return button;
  };

  const removeNode = (node: Element | null): void => {
    node?.remove();
  };

  const dedupe = (container: Element, selector: string): HTMLButtonElement | null => {
    const nodes = [...container.querySelectorAll<HTMLButtonElement>(selector)];
    for (const extra of nodes.slice(1)) {
      extra.remove();
    }
    return nodes[0] ?? null;
  };

  const injectComposer = (): void => {
    const actions = findComposerActions();
    const existingMic = document.querySelector<HTMLButtonElement>(
      'button[data-ocvd="composer-mic"]',
    );
    const existingGear = document.querySelector<HTMLButtonElement>(
      'button[data-ocvd="composer-settings"]',
    );
    const fallback = document.querySelector<HTMLElement>('[data-ocvd="composer-fallback"]');

    if (actions) {
      removeNode(fallback);
      if (existingMic && !actions.contains(existingMic)) {
        existingMic.remove();
      }
      if (existingGear && !actions.contains(existingGear)) {
        existingGear.remove();
      }

      const mic = dedupe(actions, 'button[data-ocvd="composer-mic"]') ?? makeMicButton("composer");
      const gear = dedupe(actions, 'button[data-ocvd="composer-settings"]') ?? makeGearButton();

      const submit = actions.querySelector<HTMLElement>(SELECTORS.submit);
      const anchor = submit && submit !== mic && submit !== gear ? submit : null;
      if (mic.parentElement !== actions || mic.nextElementSibling !== anchor) {
        actions.insertBefore(mic, anchor);
      }
      if (gear.parentElement !== actions || gear.nextElementSibling !== mic) {
        actions.insertBefore(gear, mic);
      }
      return;
    }

    const dock = findComposerDock();
    if (!dock) {
      return;
    }
    if (fallback?.isConnected) {
      return;
    }
    if (existingMic) {
      existingMic.remove();
    }
    if (existingGear) {
      existingGear.remove();
    }
    if (window.getComputedStyle(dock).position === "static") {
      dock.style.position = "relative";
    }
    const container = document.createElement("div");
    container.className = "ocvd-fallback-actions";
    container.dataset.ocvd = "composer-fallback";
    container.append(makeGearButton(), makeMicButton("composer"));
    dock.appendChild(container);
  };

  const injectQuestion = (): void => {
    const footer = findQuestionFooter();
    const existingMic = document.querySelector<HTMLButtonElement>(
      'button[data-ocvd="question-mic"]',
    );
    const fallback = document.querySelector<HTMLElement>('[data-ocvd="question-fallback"]');

    if (footer) {
      removeNode(fallback);
      if (existingMic && !footer.contains(existingMic)) {
        existingMic.remove();
      }
      const mic = dedupe(footer, 'button[data-ocvd="question-mic"]') ?? makeMicButton("question");
      const buttons = [...footer.querySelectorAll<HTMLButtonElement>("button")].filter(
        (button) => button !== mic && !button.disabled,
      );
      const anchor = buttons[buttons.length - 1] ?? null;
      if (mic.parentElement !== footer || mic.nextElementSibling !== anchor) {
        footer.insertBefore(mic, anchor);
      }
      return;
    }

    const textarea = findQuestionInput();
    const containerParent = textarea?.closest(SELECTORS.questionForm) ?? textarea?.closest("form");
    if (!containerParent) {
      return;
    }
    if (fallback?.isConnected) {
      return;
    }
    if (existingMic) {
      existingMic.remove();
    }
    const container = document.createElement("div");
    container.className = "ocvd-question-fallback";
    container.dataset.ocvd = "question-fallback";
    container.appendChild(makeMicButton("question"));
    containerParent.appendChild(container);
  };

  const inject = (): void => {
    if (!document.documentElement) {
      return;
    }
    ensureStyle();
    ensureHost();
    injectComposer();
    injectQuestion();
    renderMicButtons();
    renderStatus();
  };

  const scheduleInject = (): void => {
    if (scheduled) {
      return;
    }
    scheduled = setTimeout(() => {
      scheduled = null;
      inject();
    }, 60);
  };

  const isOurs = (node: Node): boolean => {
    if (!(node instanceof Element)) {
      return false;
    }
    return (
      node.matches("[data-ocvd]") ||
      node.closest("[data-ocvd]") !== null ||
      node.matches("[data-ocvd-ui]")
    );
  };

  const handleMutations = (mutations: MutationRecord[]): void => {
    for (const mutation of mutations) {
      if (isOurs(mutation.target)) {
        continue;
      }
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      if (changed.length === 0 || changed.some((node) => !isOurs(node))) {
        scheduleInject();
        return;
      }
    }
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      scheduleInject();
    }
  };

  const start = (): void => {
    if (started) {
      return;
    }
    started = true;
    inject();
    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("pageshow", scheduleInject);
    window.addEventListener("popstate", scheduleInject);
    document.addEventListener("visibilitychange", onVisibilityChange);
  };

  const setState = (next: DictationPhase, seconds = 0): void => {
    phase = next;
    elapsedSeconds = seconds;
    renderMicButtons();
    renderStatus();
  };

  const destroy = (): void => {
    observer?.disconnect();
    observer = null;
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    hideToast();
    window.removeEventListener("pageshow", scheduleInject);
    window.removeEventListener("popstate", scheduleInject);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    for (const node of document.querySelectorAll(
      '[data-ocvd="composer-mic"], [data-ocvd="question-mic"], [data-ocvd="composer-settings"], [data-ocvd="composer-fallback"], [data-ocvd="question-fallback"]',
    )) {
      node.remove();
    }
    host?.remove();
    host = null;
    shadow = null;
    statusEl = null;
    statusIconEl = null;
    statusTextEl = null;
    toastEl = null;
    recoveryEl = null;
    document.getElementById(STYLE_ID)?.remove();
    started = false;
  };

  return {
    start,
    destroy,
    refresh: inject,
    setState,
    toast: showToast,
    showRecovery,
    hideRecovery,
    openSettings: options.onOpenSettings,
  };
}
