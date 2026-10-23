import { formatTime } from "./audio.js";
import { getLocale, type MessageKey, t } from "./i18n.js";
import {
  findComposerActions,
  findComposerDock,
  findComposerEditor,
  findComposerForm,
  findQuestionCustomOption,
  findQuestionFooter,
  findQuestionHeaderActions,
  findQuestionInput,
  SELECTORS,
} from "./insert.js";
import type { RecoveryActions, ToastOptions } from "./pipeline.js";
import type { DictationPhase, FailedDictation, InsertTarget } from "./types.js";

export interface UiOptions {
  onToggle: (target: InsertTarget) => void;
  onStop: () => void;
  onCancel: () => void;
  onOpenSettings: () => void;
}

export interface Ui {
  start(): void;
  destroy(): void;
  refresh(): void;
  setState(state: DictationPhase, elapsedSeconds?: number): void;
  toast(message: string, options?: ToastOptions): void;
  hideToast(): void;
  showRecovery(record: FailedDictation, actions: RecoveryActions): void;
  hideRecovery(): void;
  openSettings(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_ID = "ocvd-page-style";

const PHASE_KEY: Record<Exclude<DictationPhase, "idle">, MessageKey> = {
  recording: "ui.phase.recording",
  stt: "ui.phase.stt",
  llm: "ui.phase.llm",
  insert: "ui.phase.insert",
  submit: "ui.phase.submit",
};

const STAGE_KEY: Record<FailedDictation["stage"], MessageKey> = {
  stt: "ui.stage.stt",
  llm: "ui.stage.llm",
  insert: "ui.stage.insert",
  submit: "ui.stage.submit",
};

const RETRY_KEY: Record<FailedDictation["stage"], MessageKey> = {
  stt: "ui.retry.stt",
  llm: "ui.retry.llm",
  insert: "ui.retry.insert",
  submit: "ui.retry.submit",
};

/** Retry a layout that could not fit our buttons after this pause. */
const ROW_RETRY_MS = 15_000;

/** Keep composer controls out of a session switch until the new one settles. */
const SESSION_SETTLE_MS = 1_000;

/** OpenCode modal layers that cover the session and make the composer unusable. */
const OVERLAY_SELECTORS = [
  '[data-component="dialog-overlay"]',
  '[data-slot="mobile-drawer-content"]',
];

/** The session screen stays in the DOM when OpenCode hides the composer. */
const SESSION_SURFACE_SELECTORS = ['[data-slot="session-chat-panel"]'];

export function createUi(options: UiOptions): Ui {
  let phase: DictationPhase = "idle";
  let elapsedSeconds = 0;
  let started = false;
  let observer: MutationObserver | null = null;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let blockedActions: { node: HTMLElement; key: string; until: number } | null = null;
  let currentPath = "";
  let sessionChangedAt = 0;

  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let statusEl: HTMLElement | null = null;
  let statusIconEl: HTMLElement | null = null;
  let statusTextEl: HTMLElement | null = null;
  let stopButton: HTMLButtonElement | null = null;
  let cancelButton: HTMLButtonElement | null = null;
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
  position: relative;
}
button.ocvd-btn:hover { background: rgba(127, 127, 127, 0.14); }
button.ocvd-btn:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
button.ocvd-btn[disabled] { opacity: 0.55; cursor: default; background: transparent; }
button.ocvd-btn.ocvd-btn--recording { color: #ef4444; }
button.ocvd-btn.ocvd-btn--recording:hover { background: rgba(239, 68, 68, 0.14); }
button.ocvd-btn.ocvd-btn--recording::after {
  content: "";
  position: absolute;
  top: 7px;
  right: 7px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25);
  animation: ocvd-mic-pulse 1.2s ease-in-out infinite;
}
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
  z-index: 2147482999;
  display: inline-flex;
  gap: 2px;
  align-items: center;
  pointer-events: auto;
}
.ocvd-floating-actions {
  position: absolute;
  right: 8px;
  bottom: calc(100% + 8px);
  z-index: 2147482999;
  display: inline-flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.92);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}
.ocvd-floating-actions--fixed {
  position: fixed;
  right: 12px;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 150px);
}
@media (prefers-color-scheme: light) {
  .ocvd-floating-actions {
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  }
}
.ocvd-question-fallback {
  display: flex;
  justify-content: flex-end;
  padding: 4px 6px;
}
@media (pointer: coarse) {
  button.ocvd-btn { width: 48px; height: 48px; min-width: 48px; min-height: 48px; }
}
/* Phone-only: a desktop keeps its native composer controls at every window width. */
@media (max-width: 767px) and (pointer: coarse) and (hover: none) {
  form[data-component="composer"] [data-slot="composer-controls"] > div {
    width: 100%;
    min-width: 0;
  }
  form[data-component="composer"] [data-slot="composer-controls"] > div > * {
    flex: 0 0 auto;
  }
  form[data-component="composer"] [data-slot="composer-controls"] > div > *:has([data-action="composer-model"]) {
    flex: 1 1 0;
    min-width: 0;
  }
  form[data-component="composer"] [data-slot="composer-controls"] > div > [data-action="composer-model"] {
    flex: 1 1 0;
    min-width: 0;
  }
  form[data-component="composer"] [data-slot="composer-controls"] [data-action="composer-model"] {
    width: 100%;
    max-width: none;
    min-width: 0;
  }
  form[data-component="composer"] [data-slot="composer-controls"] [data-action="composer-model"] .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
@keyframes ocvd-spin-page { to { transform: rotate(360deg); } }
@keyframes ocvd-mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
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
  align-items: center;
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
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  min-height: 36px;
  padding: 3px 5px 3px 12px;
  border-radius: 999px;
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
.ocvd-status-text {
  flex: 0 1 auto;
  min-width: 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ocvd-stop, .ocvd-cancel {
  all: unset;
  box-sizing: border-box;
  width: 30px;
  height: 30px;
  min-width: 30px;
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: inherit;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  flex: 0 0 auto;
}
.ocvd-stop { color: #ef4444; background: rgba(239, 68, 68, 0.16); }
.ocvd-stop:hover { background: rgba(239, 68, 68, 0.26); }
.ocvd-stop[hidden] { display: none; }
.ocvd-stop svg { width: 16px; height: 16px; display: block; }
.ocvd-cancel { color: rgba(255, 255, 255, 0.72); font-size: 20px; line-height: 1; }
.ocvd-cancel:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.ocvd-stop:focus-visible, .ocvd-cancel:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.ocvd-btn {
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
.ocvd-btn:hover { background: rgba(255, 255, 255, 0.17); }
.ocvd-btn:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
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
  .ocvd-btn { background: rgba(17, 24, 39, 0.08); }
  .ocvd-btn:hover { background: rgba(17, 24, 39, 0.14); }
  .ocvd-stop { background: rgba(239, 68, 68, 0.14); }
  .ocvd-stop:hover { background: rgba(239, 68, 68, 0.22); }
  .ocvd-cancel { color: rgba(17, 24, 39, 0.6); }
  .ocvd-cancel:hover { background: rgba(17, 24, 39, 0.08); color: #111827; }
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

    stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.className = "ocvd-stop";
    stopButton.appendChild(stopIcon());
    stopButton.addEventListener("click", () => options.onStop());

    cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ocvd-cancel";
    cancelButton.textContent = "×";
    cancelButton.addEventListener("click", () => options.onCancel());

    statusEl.append(statusIconEl, statusTextEl, stopButton, cancelButton);

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
      return t("ui.mic.stop");
    }
    if (phase === "idle") {
      return t("ui.mic.start");
    }
    return t("ui.mic.busy");
  };

  const renderMicButton = (button: HTMLButtonElement): void => {
    const label = micLabel();
    if (
      button.dataset.ocvdState === phase &&
      button.dataset.ocvdLabel === label &&
      button.firstChild
    ) {
      return;
    }
    button.replaceChildren();
    button.disabled = phase !== "idle" && phase !== "recording";
    button.dataset.ocvdState = phase;
    button.dataset.ocvdLabel = label;
    button.classList.toggle("ocvd-btn--recording", phase === "recording");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    if (phase === "recording" || phase === "idle") {
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
      statusEl.removeAttribute("aria-label");
      return;
    }
    statusEl.hidden = false;
    statusIconEl.replaceChildren();
    if (phase === "recording") {
      const dot = document.createElement("span");
      dot.className = "ocvd-dot";
      statusIconEl.appendChild(dot);
      const time = formatTime(elapsedSeconds);
      statusTextEl.textContent = time;
      statusEl.setAttribute("aria-label", `${t(PHASE_KEY.recording)} ${time}`);
    } else {
      statusIconEl.appendChild(spinner());
      statusTextEl.textContent = t(PHASE_KEY[phase]);
      statusEl.removeAttribute("aria-label");
    }

    if (stopButton) {
      stopButton.hidden = phase !== "recording";
      const stopLabel = t("ui.mic.stop");
      stopButton.setAttribute("aria-label", stopLabel);
      stopButton.title = stopLabel;
    }
    if (cancelButton) {
      const cancelLabel = t("common.cancel");
      cancelButton.setAttribute("aria-label", cancelLabel);
      cancelButton.title = cancelLabel;
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
    close.setAttribute("aria-label", t("ui.toast.close"));
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
    titleText.textContent = t("ui.recovery.title", { stage: t(STAGE_KEY[record.stage]) });
    const time = document.createElement("span");
    time.className = "ocvd-recovery-time";
    time.textContent = new Date(record.createdAt).toLocaleTimeString(
      getLocale() === "ru" ? "ru-RU" : "en-US",
      {
        hour: "2-digit",
        minute: "2-digit",
      },
    );
    title.append(titleText, time);

    const message = document.createElement("p");
    message.className = "ocvd-recovery-text";
    message.textContent = record.error || t("ui.recovery.fallbackError");
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

    addButton(t(RETRY_KEY[record.stage]), actions.onRetry, "primary");
    if (actions.onSubmitRaw) {
      addButton(t("ui.recovery.submitRaw"), actions.onSubmitRaw);
    }
    if (actions.onInsertRaw) {
      addButton(t("ui.recovery.insertRaw"), actions.onInsertRaw);
    }
    addButton(t("common.settings"), actions.onSettings);
    addButton(t("ui.recovery.delete"), actions.onDelete, "danger");

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
    button.setAttribute("aria-label", t("ui.settingsLabel"));
    button.setAttribute("title", t("ui.settingsLabel"));
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

  const isVisibleNode = (node: Element | null): boolean =>
    node instanceof HTMLElement && node.getClientRects().length > 0;

  /**
   * True when the element is laid out and not hidden with `visibility`.
   * Dialogs and the mobile drawer keep force-mounted nodes in the DOM, so
   * getClientRects() alone is not enough for them.
   */
  const isRenderedNode = (node: Element | null): boolean => {
    if (!(node instanceof HTMLElement) || node.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const isClosedNode = (node: Element): boolean =>
    node.matches("[data-closed]") || node.closest("[data-closed]") !== null;

  /**
   * A force-mounted drawer can stay `visibility: visible` after closing and
   * only move off-screen. It must not keep the composer mic removed forever.
   */
  const overlapsViewport = (node: HTMLElement): boolean => {
    if (node.getClientRects().length === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    if (width === 0 || height === 0 || (rect.width === 0 && rect.height === 0)) {
      return true;
    }
    return rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height;
  };

  /** True while an OpenCode dialog or mobile drawer covers the session. */
  const hasBlockingOverlay = (): boolean =>
    OVERLAY_SELECTORS.some((selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].some(
        (node) => isRenderedNode(node) && !isClosedNode(node) && overlapsViewport(node),
      ),
    );

  /**
   * The session screen stays rendered while OpenCode replaces the composer
   * with a request dock, so it distinguishes a real session from the home
   * page where stale hidden composers can remain in the DOM.
   */
  const hasVisibleSessionSurface = (): boolean =>
    SESSION_SURFACE_SELECTORS.some((selector) =>
      [...document.querySelectorAll(selector)].some(isRenderedNode),
    );

  const removeComposerUi = (): void => {
    for (const node of document.querySelectorAll(
      '[data-ocvd="composer-fallback"], button[data-ocvd="composer-mic"], button[data-ocvd="composer-settings"]',
    )) {
      node.remove();
    }
    blockedActions = null;
  };

  const dedupe = (container: Element, selector: string): HTMLButtonElement | null => {
    const nodes = [...container.querySelectorAll<HTMLButtonElement>(selector)];
    for (const extra of nodes.slice(1)) {
      extra.remove();
    }
    return nodes[0] ?? null;
  };

  /** Keep one button for the whole page and drop any duplicates. */
  const takeButton = (selector: string, create: () => HTMLButtonElement): HTMLButtonElement => {
    const nodes = [...document.querySelectorAll<HTMLButtonElement>(selector)];
    const button = nodes[0] ?? create();
    for (const extra of nodes.slice(1)) {
      extra.remove();
    }
    return button;
  };

  const isOnScreen = (node: HTMLElement): boolean => {
    if (node.getClientRects().length === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    if (width === 0 || height === 0 || (rect.width === 0 && rect.height === 0)) {
      return true;
    }
    return (
      rect.left >= -1 && rect.top >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1
    );
  };

  /**
   * True when the element receives a click at its centre. OpenCode overlays
   * the composer while the agent works, and Firefox does not clip absolutely
   * positioned nodes the same way; a hidden-but-present button must not count
   * as available.
   */
  const isHittable = (node: HTMLElement): boolean => {
    if (node.getClientRects().length === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return true;
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return false;
    }
    let hit: Element | null = null;
    try {
      hit = document.elementFromPoint(x, y);
    } catch {
      return true;
    }
    if (!hit) {
      return true;
    }
    return hit === node || node.contains(hit);
  };

  const composerKey = (actions: HTMLElement, form: HTMLElement | null): string => {
    const keyOf = (node: Element | null): string => {
      if (!(node instanceof HTMLElement) || node.getClientRects().length === 0) {
        return "-";
      }
      const rect = node.getBoundingClientRect();
      return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
    };
    return `${window.innerWidth}x${window.innerHeight}|${keyOf(form)}|${keyOf(actions)}`;
  };

  const showComposerFallback = (dock: HTMLElement | null, form: HTMLElement | null): void => {
    // Firefox Android may render the composer without a dock. Prefer the dock,
    // then the visible form, so a temporary fallback stays attached to the
    // composer instead of floating over the conversation. A rendered composer
    // can be temporarily covered during a session transition; anchoring to it
    // is still better than a fixed panel over the chat.
    const anchor =
      [dock, form].find(
        (node): node is HTMLElement => node !== null && isRenderedNode(node) && isOnScreen(node),
      ) ?? null;

    let container = document.querySelector<HTMLElement>('[data-ocvd="composer-fallback"]');
    if (!container) {
      container = document.createElement("div");
      container.dataset.ocvd = "composer-fallback";
    }
    container.className = anchor
      ? "ocvd-fallback-actions"
      : "ocvd-floating-actions ocvd-floating-actions--fixed";

    if (anchor) {
      if (container.parentElement !== anchor) {
        anchor.appendChild(container);
      }
      if (window.getComputedStyle(anchor).position === "static") {
        anchor.style.position = "relative";
      }
    } else if (container.parentElement !== document.documentElement) {
      document.documentElement.appendChild(container);
    }

    const mic = takeButton('button[data-ocvd="composer-mic"]', () => makeMicButton("composer"));
    const gear = takeButton('button[data-ocvd="composer-settings"]', makeGearButton);
    if (gear.parentElement !== container || gear.nextElementSibling !== mic) {
      container.append(gear, mic);
    }
    for (const extra of document.querySelectorAll<HTMLElement>('[data-ocvd="composer-fallback"]')) {
      if (extra !== container) {
        extra.remove();
      }
    }
  };

  const injectComposer = (): void => {
    if (sessionChangedAt > 0 && Date.now() - sessionChangedAt < SESSION_SETTLE_MS) {
      removeComposerUi();
      return;
    }
    const actions = findComposerActions();
    const editor = findComposerEditor();
    const form = findComposerForm(editor);
    const dock = findComposerDock();
    const fallback = document.querySelector<HTMLElement>('[data-ocvd="composer-fallback"]');

    if (hasBlockingOverlay()) {
      removeComposerUi();
      return;
    }

    const hasComposerNodes = Boolean(actions || editor || form || dock);
    const hasVisibleComposer =
      isRenderedNode(actions) ||
      isRenderedNode(editor) ||
      isRenderedNode(form) ||
      isRenderedNode(dock);

    // Hidden stale composers from an inactive session must not float a mic on
    // the home/session-selection screen. On a real session, keep the fallback
    // available while OpenCode temporarily hides the composer.
    if (!hasComposerNodes || (!hasVisibleComposer && !hasVisibleSessionSurface())) {
      removeComposerUi();
      return;
    }

    const blocked =
      actions !== null &&
      blockedActions?.node === actions &&
      blockedActions.key === composerKey(actions, form) &&
      blockedActions.until > Date.now();

    if (
      actions &&
      !blocked &&
      isVisibleNode(actions) &&
      isOnScreen(actions) &&
      isHittable(actions)
    ) {
      const mic = takeButton('button[data-ocvd="composer-mic"]', () => makeMicButton("composer"));
      const gear = takeButton('button[data-ocvd="composer-settings"]', makeGearButton);

      const submit = actions.querySelector<HTMLElement>(SELECTORS.submit);
      const anchor = submit && submit !== mic && submit !== gear ? submit : null;
      if (mic.parentElement !== actions || mic.nextElementSibling !== anchor) {
        actions.insertBefore(mic, anchor);
      }
      if (gear.parentElement !== actions || gear.nextElementSibling !== mic) {
        actions.insertBefore(gear, mic);
      }
      fallback?.remove();

      if (isVisibleNode(actions) && isOnScreen(actions) && isHittable(mic) && isHittable(gear)) {
        blockedActions = null;
        return;
      }
    }

    // While a question is open, its dock owns the visible controls: a
    // composer fallback would duplicate the question mic. The row buttons,
    // if any, stay where they are and return when the question closes.
    const questionOpen = [
      ...document.querySelectorAll<HTMLElement>(
        `${SELECTORS.questionDock}, ${SELECTORS.questionInput}`,
      ),
    ].some(isVisibleNode);
    if (questionOpen) {
      fallback?.remove();
      blockedActions = null;
      return;
    }

    showComposerFallback(dock, form);

    // Remember the layout only when the row itself is on screen but our
    // buttons do not fit there. A row hidden by a transient overlay must be
    // retried on the next heartbeat so the buttons return to it.
    blockedActions =
      actions && isVisibleNode(actions) && isOnScreen(actions) && isHittable(actions)
        ? { node: actions, key: composerKey(actions, form), until: Date.now() + ROW_RETRY_MS }
        : null;
  };

  const placeBesideField = (container: HTMLElement, wrapper: HTMLElement): void => {
    const field =
      container.querySelector<HTMLInputElement | HTMLTextAreaElement>(SELECTORS.questionInput) ??
      null;
    if (field) {
      let anchor: Node | null = field;
      while (anchor && anchor.parentElement !== container) {
        anchor = anchor.parentElement;
      }
      const anchorElement = anchor instanceof Element ? anchor : null;
      if (wrapper.parentElement !== container || wrapper.previousElementSibling !== anchorElement) {
        container.insertBefore(wrapper, anchor?.nextSibling ?? null);
      }
      return;
    }
    if (wrapper.parentElement !== container) {
      container.appendChild(wrapper);
    }
  };

  const injectQuestion = (): void => {
    const existingMic = document.querySelector<HTMLButtonElement>(
      'button[data-ocvd="question-mic"]',
    );
    const fallback = document.querySelector<HTMLElement>('[data-ocvd="question-fallback"]');

    // The footer sits under the options and is often clipped by the bottom
    // edge of the window. Prefer the header, which is always on screen, and
    // fall back to the footer only for DOM variants without header actions.
    const header = findQuestionHeaderActions();
    const footer = findQuestionFooter();
    const bar = [header, footer].find((candidate) => isVisibleNode(candidate)) ?? header ?? footer;

    if (bar) {
      if (isVisibleNode(existingMic) && !isVisibleNode(bar)) {
        return;
      }
      removeNode(fallback);
      if (existingMic && !bar.contains(existingMic)) {
        existingMic.remove();
      }
      const mic = dedupe(bar, 'button[data-ocvd="question-mic"]') ?? makeMicButton("question");
      const buttons = [...bar.querySelectorAll<HTMLButtonElement>("button")].filter(
        (button) => !button.hasAttribute("data-ocvd"),
      );
      const anchor = buttons[buttons.length - 1] ?? null;
      if (mic.parentElement !== bar || mic.nextElementSibling !== anchor) {
        bar.insertBefore(mic, anchor);
      }
      return;
    }

    const option = findQuestionCustomOption();
    const input = option ? null : findQuestionInput();
    const legacyForm = input
      ? (input.closest<HTMLElement>(SELECTORS.questionForm) ?? input.closest<HTMLElement>("form"))
      : null;
    const container = option ?? legacyForm;

    if (!container) {
      removeNode(fallback);
      existingMic?.remove();
      return;
    }

    if (isVisibleNode(existingMic) && !isVisibleNode(container)) {
      return;
    }

    if (fallback?.isConnected && fallback.parentElement === container) {
      if (!fallback.querySelector('button[data-ocvd="question-mic"]')) {
        fallback.appendChild(makeMicButton("question"));
      }
      placeBesideField(container, fallback);
      const extra = container.querySelectorAll('[data-ocvd="question-fallback"]');
      for (const node of [...extra].slice(1)) {
        node.remove();
      }
      return;
    }

    removeNode(fallback);
    if (existingMic && !container.contains(existingMic)) {
      existingMic.remove();
    }
    const wrapper = document.createElement("div");
    wrapper.className = "ocvd-question-fallback";
    wrapper.dataset.ocvd = "question-fallback";
    wrapper.appendChild(makeMicButton("question"));
    placeBesideField(container, wrapper);
  };

  const inject = (): void => {
    if (!document.documentElement) {
      return;
    }
    const path = window.location.pathname + window.location.search;
    if (currentPath !== "" && path !== currentPath) {
      sessionChangedAt = Date.now();
      removeComposerUi();
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(() => {
        settleTimer = null;
        scheduleInject();
      }, SESSION_SETTLE_MS);
    }
    currentPath = path;
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
      if (mutation.type === "attributes") {
        scheduleInject();
        return;
      }
      for (const node of mutation.addedNodes) {
        if (!isOurs(node)) {
          scheduleInject();
          return;
        }
      }
      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }
        const containedOurs = isOurs(node) || node.querySelector("[data-ocvd]") !== null;
        if (containedOurs && !node.isConnected) {
          scheduleInject();
          return;
        }
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
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-closed", "data-closing", "data-open"],
    });
    heartbeat = setInterval(() => {
      if (document.visibilityState === "visible") {
        inject();
      }
    }, 1000);
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
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    hideToast();
    window.removeEventListener("pageshow", scheduleInject);
    window.removeEventListener("popstate", scheduleInject);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    currentPath = "";
    sessionChangedAt = 0;
    settleTimer = null;
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
    stopButton = null;
    cancelButton = null;
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
    hideToast,
    showRecovery,
    hideRecovery,
    openSettings: options.onOpenSettings,
  };
}
