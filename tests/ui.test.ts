import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecoveryActions } from "../src/pipeline.js";
import type { FailedDictation } from "../src/types.js";
import { type Ui, createUi } from "../src/ui.js";

const created: Ui[] = [];

function makeUi(overrides: Partial<Parameters<typeof createUi>[0]> = {}): {
  ui: Ui;
  onToggle: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  onOpenSettings: ReturnType<typeof vi.fn>;
} {
  const onToggle = vi.fn();
  const onCancel = vi.fn();
  const onOpenSettings = vi.fn();
  const ui = createUi({ onToggle, onCancel, onOpenSettings, ...overrides });
  created.push(ui);
  return { ui, onToggle, onCancel, onOpenSettings };
}

function addComposer(options: { withActions?: boolean } = {}): {
  dock: HTMLElement;
  editor: HTMLElement;
  actions: HTMLElement | null;
  submit: HTMLButtonElement;
} {
  const dock = document.createElement("div");
  dock.setAttribute("data-component", "session-composer-dock");
  const editor = document.createElement("div");
  editor.setAttribute("data-component", "composer-editor");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("contenteditable", "true");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.setAttribute("data-action", "composer-submit");

  let actions: HTMLElement | null = null;
  if (options.withActions === false) {
    dock.append(editor, submit);
  } else {
    actions = document.createElement("div");
    actions.setAttribute("data-slot", "composer-actions");
    actions.appendChild(submit);
    dock.append(editor, actions);
  }
  document.body.appendChild(dock);
  return { dock, editor, actions, submit };
}

function addQuestion(options: { withFooter?: boolean } = {}): {
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  footer: HTMLElement | null;
} {
  const dock = document.createElement("div");
  dock.setAttribute("data-component", "session-question-dock");
  const form = document.createElement("form");
  form.setAttribute("data-slot", "question-option");
  form.setAttribute("data-custom", "true");
  const textarea = document.createElement("textarea");
  textarea.setAttribute("data-slot", "question-custom-input");

  let footer: HTMLElement | null = null;
  if (options.withFooter !== false) {
    footer = document.createElement("div");
    footer.setAttribute("data-slot", "question-footer-actions");
  }

  form.appendChild(textarea);
  if (footer) {
    form.appendChild(footer);
  }
  dock.appendChild(form);
  document.body.appendChild(dock);
  return { form, textarea, footer };
}

function overlay(): ShadowRoot | null {
  return document.querySelector<HTMLElement>('[data-ocvd-ui="overlay"]')?.shadowRoot ?? null;
}

function queryOverlay<T extends Element>(selector: string): T | null {
  return overlay()?.querySelector<T>(selector) ?? null;
}

function buttonByText(text: string): HTMLButtonElement | null {
  const buttons = overlay()?.querySelectorAll<HTMLButtonElement>("button") ?? [];
  return [...buttons].find((button) => button.textContent === text) ?? null;
}

function record(overrides: Partial<FailedDictation> = {}): FailedDictation {
  return {
    id: "failure-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    target: "composer",
    stage: "stt",
    error: "STT недоступен",
    attempts: 1,
    ...overrides,
  };
}

function actions(overrides: Partial<RecoveryActions> = {}): RecoveryActions {
  return {
    onRetry: vi.fn(),
    onDelete: vi.fn(),
    onSettings: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  for (const ui of created.splice(0)) {
    ui.destroy();
  }
  vi.useRealTimers();
});

describe("composer injection", () => {
  it("injects gear, mic and keeps the submit button last", () => {
    const { ui } = makeUi();
    const { actions: slot, submit } = addComposer();
    ui.start();

    const gear = slot?.querySelector<HTMLButtonElement>('[data-ocvd="composer-settings"]');
    const mic = slot?.querySelector<HTMLButtonElement>('[data-ocvd="composer-mic"]');
    expect(gear).not.toBeNull();
    expect(mic).not.toBeNull();
    expect([...(slot?.children ?? [])]).toEqual([gear, mic, submit]);
    expect(gear?.getAttribute("aria-label")).toBe("Настройки голосового ввода");
    expect(mic?.getAttribute("aria-label")).toBe("Начать голосовую диктовку");
  });

  it("does not duplicate buttons on repeated refresh", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    ui.refresh();
    ui.refresh();
    expect(slot?.querySelectorAll('[data-ocvd="composer-mic"]')).toHaveLength(1);
    expect(slot?.querySelectorAll('[data-ocvd="composer-settings"]')).toHaveLength(1);
  });

  it("removes duplicate buttons", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    const mic = slot?.querySelector<HTMLButtonElement>('[data-ocvd="composer-mic"]');
    const duplicate = mic?.cloneNode(true) as HTMLButtonElement;
    slot?.appendChild(duplicate);
    ui.refresh();
    expect(slot?.querySelectorAll('[data-ocvd="composer-mic"]')).toHaveLength(1);
  });

  it("calls onToggle when the mic is clicked without submitting", () => {
    const { ui, onToggle } = makeUi();
    const { actions: slot, dock } = addComposer();
    const submit = vi.fn((event: Event) => event.preventDefault());
    dock.addEventListener("submit", submit);
    ui.start();
    slot?.querySelector<HTMLButtonElement>('[data-ocvd="composer-mic"]')?.click();
    expect(onToggle).toHaveBeenCalledWith("composer");
    expect(submit).not.toHaveBeenCalled();
  });

  it("calls onOpenSettings from the gear button", () => {
    const { ui, onOpenSettings } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    slot?.querySelector<HTMLButtonElement>('[data-ocvd="composer-settings"]')?.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("injects into the submit row when the dock is missing", () => {
    const { ui, onToggle } = makeUi();
    const form = document.createElement("form");
    form.setAttribute("data-component", "composer");
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "composer-editor");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.setAttribute("contenteditable", "true");
    const row = document.createElement("div");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.setAttribute("data-action", "composer-submit");
    row.appendChild(submit);
    form.append(editor, row);
    document.body.appendChild(form);

    ui.start();

    const gear = row.querySelector<HTMLButtonElement>('[data-ocvd="composer-settings"]');
    const mic = row.querySelector<HTMLButtonElement>('[data-ocvd="composer-mic"]');
    expect(gear).not.toBeNull();
    expect(mic).not.toBeNull();
    expect([...row.children]).toEqual([gear, mic, submit]);
    mic?.click();
    expect(onToggle).toHaveBeenCalledWith("composer");
  });

  it("renders a floating fallback when the dock, actions and submit are missing", () => {
    const { ui } = makeUi();
    const form = document.createElement("form");
    form.setAttribute("data-component", "composer");
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "composer-editor");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    form.appendChild(editor);
    document.body.appendChild(form);

    ui.start();

    const fallback = document.querySelector<HTMLElement>('[data-ocvd="composer-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.classList.contains("ocvd-floating-actions")).toBe(true);
    expect(fallback?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
    expect(fallback?.querySelector('[data-ocvd="composer-settings"]')).not.toBeNull();
  });

  it("moves the mic from the floating fallback into a later submit row", () => {
    const { ui } = makeUi();
    const form = document.createElement("form");
    form.setAttribute("data-component", "composer");
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "composer-editor");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    form.appendChild(editor);
    document.body.appendChild(form);
    ui.start();

    const row = document.createElement("div");
    const submit = document.createElement("button");
    submit.setAttribute("data-action", "composer-submit");
    row.appendChild(submit);
    form.appendChild(row);
    ui.refresh();

    expect(document.querySelector('[data-ocvd="composer-fallback"]')).toBeNull();
    expect(row.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
  });

  it("renders a fallback container when composer actions are missing", () => {
    const { ui } = makeUi();
    const { dock } = addComposer({ withActions: false });
    ui.start();
    const fallback = dock.querySelector<HTMLElement>('[data-ocvd="composer-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
    expect(fallback?.querySelector('[data-ocvd="composer-settings"]')).not.toBeNull();
  });

  it("re-injects after OpenCode re-renders the toolbar", async () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    slot?.replaceChildren();
    await vi.waitFor(() => {
      expect(slot?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
    });
    expect(slot?.querySelector('[data-ocvd="composer-settings"]')).not.toBeNull();
  });

  it("does not touch a page without a composer", () => {
    const { ui } = makeUi();
    ui.start();
    expect(document.querySelector('[data-ocvd="composer-mic"]')).toBeNull();
    expect(document.getElementById("ocvd-page-style")).not.toBeNull();
  });

  it("stops injection after destroy", async () => {
    const { ui } = makeUi();
    const { dock, actions: slot } = addComposer();
    ui.start();
    ui.destroy();
    expect(dock.querySelector('[data-ocvd="composer-mic"]')).toBeNull();
    slot?.replaceChildren();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(dock.querySelector('[data-ocvd="composer-mic"]')).toBeNull();
    expect(document.getElementById("ocvd-page-style")).toBeNull();
  });

  it("is idempotent when start is called twice", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    ui.start();
    expect(slot?.querySelectorAll('[data-ocvd="composer-mic"]')).toHaveLength(1);
  });
});

describe("question injection", () => {
  it("injects the mic into the footer", () => {
    const { ui, onToggle } = makeUi();
    const { footer } = addQuestion();
    const answer = document.createElement("button");
    answer.textContent = "Ответить";
    footer?.appendChild(answer);
    ui.start();

    const mic = footer?.querySelector<HTMLButtonElement>('[data-ocvd="question-mic"]');
    expect(mic).not.toBeNull();
    expect([...(footer?.children ?? [])]).toEqual([mic, answer]);
    mic?.click();
    expect(onToggle).toHaveBeenCalledWith("question");
  });

  it("renders a fallback inside the question form", () => {
    const { ui } = makeUi();
    const { form } = addQuestion({ withFooter: false });
    ui.start();
    const fallback = form.querySelector<HTMLElement>('[data-ocvd="question-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();
  });

  it("removes the fallback when the footer appears", () => {
    const { ui } = makeUi();
    const { form } = addQuestion({ withFooter: false });
    ui.start();
    const footer = document.createElement("div");
    footer.setAttribute("data-slot", "question-footer-actions");
    form.appendChild(footer);
    ui.refresh();
    expect(form.querySelector('[data-ocvd="question-fallback"]')).toBeNull();
    expect(footer.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();
  });
});

describe("dictation status", () => {
  it("shows recording time and cancel", () => {
    const { ui, onCancel } = makeUi();
    addComposer();
    ui.start();
    ui.setState("recording", 65);
    expect(queryOverlay<HTMLElement>(".ocvd-status")?.hidden).toBe(false);
    expect(queryOverlay<HTMLElement>(".ocvd-status-text")?.textContent).toBe("Запись 01:05");
    expect(queryOverlay<HTMLElement>(".ocvd-dot")).not.toBeNull();
    queryOverlay<HTMLButtonElement>(".ocvd-cancel")?.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["stt", "Распознаю речь…"],
    ["llm", "Чищу текст…"],
    ["insert", "Вставляю текст…"],
    ["submit", "Отправляю…"],
  ] as const)("shows a spinner for %s", (phase, label) => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    ui.setState(phase);
    expect(queryOverlay<HTMLElement>(".ocvd-status-text")?.textContent).toBe(label);
    expect(queryOverlay<HTMLElement>(".ocvd-spinner")).not.toBeNull();
    const mic = slot?.querySelector<HTMLButtonElement>('[data-ocvd="composer-mic"]');
    expect(mic?.disabled).toBe(true);
    expect(mic?.getAttribute("aria-label")).toBe("Идёт обработка записи");
    expect(mic?.querySelector(".ocvd-spinner")).not.toBeNull();
  });

  it("updates the mic button for recording", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    ui.setState("recording", 3);
    const mic = slot?.querySelector<HTMLButtonElement>('[data-ocvd="composer-mic"]');
    expect(mic?.disabled).toBe(false);
    expect(mic?.classList.contains("ocvd-btn--recording")).toBe(true);
    expect(mic?.getAttribute("aria-label")).toBe("Остановить запись");
    expect(mic?.querySelector("rect")).not.toBeNull();
  });

  it("hides the status when idle", () => {
    const { ui } = makeUi();
    addComposer();
    ui.start();
    ui.setState("llm");
    ui.setState("idle");
    expect(queryOverlay<HTMLElement>(".ocvd-status")?.hidden).toBe(true);
  });

  it("updates every injected mic button", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    addQuestion();
    ui.start();
    ui.setState("recording", 1);
    const mics = document.querySelectorAll('[data-ocvd$="-mic"]');
    expect(mics).toHaveLength(2);
    for (const mic of mics) {
      expect(mic.getAttribute("aria-label")).toBe("Остановить запись");
    }
    expect(slot).not.toBeNull();
  });
});

describe("toasts", () => {
  it("shows a plain toast", () => {
    const { ui } = makeUi();
    ui.toast("Привет");
    const toast = queryOverlay<HTMLElement>(".ocvd-toast");
    expect(toast?.hidden).toBe(false);
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.textContent).toContain("Привет");
  });

  it("shows an error toast with an action", () => {
    const { ui } = makeUi();
    const action = vi.fn();
    ui.toast("Ошибка", { error: true, actionLabel: "Повторить", action });
    const toast = queryOverlay<HTMLElement>(".ocvd-toast");
    expect(toast?.className).toContain("ocvd-error");
    expect(toast?.getAttribute("role")).toBe("alert");
    const button = buttonByText("Повторить");
    expect(button).not.toBeNull();
    button?.click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(toast?.hidden).toBe(true);
  });

  it("closes a toast with the close button", () => {
    const { ui } = makeUi();
    ui.toast("Закрыть меня");
    queryOverlay<HTMLButtonElement>(".ocvd-close")?.click();
    expect(queryOverlay<HTMLElement>(".ocvd-toast")?.hidden).toBe(true);
  });

  it("hides a toast after its duration", () => {
    vi.useFakeTimers();
    const { ui } = makeUi();
    ui.toast("Скоро исчезнет", { durationMs: 1000 });
    expect(queryOverlay<HTMLElement>(".ocvd-toast")?.hidden).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(queryOverlay<HTMLElement>(".ocvd-toast")?.hidden).toBe(true);
  });

  it("replaces the previous toast", () => {
    const { ui } = makeUi();
    ui.toast("Первый");
    ui.toast("Второй");
    const toast = queryOverlay<HTMLElement>(".ocvd-toast");
    expect(toast?.textContent).toContain("Второй");
    expect(toast?.textContent).not.toContain("Первый");
  });
});

describe("recovery banner", () => {
  it("shows stage-specific actions", () => {
    const { ui } = makeUi();
    const callbacks = actions({
      onInsertRaw: vi.fn(),
      onSubmitRaw: vi.fn(),
    });
    ui.showRecovery(record({ stage: "llm", error: "LLM упал" }), callbacks);
    const banner = queryOverlay<HTMLElement>(".ocvd-recovery");
    expect(banner?.hidden).toBe(false);
    expect(banner?.getAttribute("role")).toBe("alert");
    expect(banner?.textContent).toContain("Незавершённая диктовка · Очистка");
    expect(banner?.textContent).toContain("LLM упал");

    buttonByText("Повторить очистку")?.click();
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
    buttonByText("Отправить как есть")?.click();
    expect(callbacks.onSubmitRaw).toHaveBeenCalledTimes(1);
    buttonByText("Вставить сырой текст")?.click();
    expect(callbacks.onInsertRaw).toHaveBeenCalledTimes(1);
    buttonByText("Настройки")?.click();
    expect(callbacks.onSettings).toHaveBeenCalledTimes(1);
    buttonByText("Удалить")?.click();
    expect(callbacks.onDelete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["stt", "Повторить STT"],
    ["llm", "Повторить очистку"],
    ["insert", "Повторить вставку"],
    ["submit", "Отправить снова"],
  ] as const)("labels the retry button for %s", (stage, label) => {
    const { ui } = makeUi();
    ui.showRecovery(record({ stage }), actions());
    expect(buttonByText(label)).not.toBeNull();
  });

  it("uses a fallback error message and truncates long text", () => {
    const { ui } = makeUi();
    ui.showRecovery(record({ error: "" }), actions());
    expect(queryOverlay<HTMLElement>(".ocvd-recovery-text")?.textContent).toBe(
      "Последняя операция не завершилась.",
    );

    ui.showRecovery(record({ error: "x".repeat(300) }), actions());
    const text = queryOverlay<HTMLElement>(".ocvd-recovery-text")?.textContent ?? "";
    expect(text).toHaveLength(220);
    expect(text.endsWith("…")).toBe(true);
  });

  it("hides the banner when an action is pressed", () => {
    const { ui } = makeUi();
    ui.showRecovery(record(), actions());
    buttonByText("Повторить STT")?.click();
    expect(queryOverlay<HTMLElement>(".ocvd-recovery")?.hidden).toBe(true);
  });

  it("hides and clears the banner programmatically", () => {
    const { ui } = makeUi();
    ui.showRecovery(record(), actions());
    ui.hideRecovery();
    const banner = queryOverlay<HTMLElement>(".ocvd-recovery");
    expect(banner?.hidden).toBe(true);
    expect(banner?.childElementCount).toBe(0);
  });

  it("delegates openSettings", () => {
    const { ui, onOpenSettings } = makeUi();
    ui.openSettings();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
