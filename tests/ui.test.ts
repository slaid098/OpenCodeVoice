import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n.js";
import type { RecoveryActions } from "../src/pipeline.js";
import type { FailedDictation } from "../src/types.js";
import { type Ui, createUi } from "../src/ui.js";

const created: Ui[] = [];

function makeUi(overrides: Partial<Parameters<typeof createUi>[0]> = {}): {
  ui: Ui;
  onToggle: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  onStop: ReturnType<typeof vi.fn>;
  onOpenSettings: ReturnType<typeof vi.fn>;
} {
  const onToggle = vi.fn();
  const onCancel = vi.fn();
  const onStop = vi.fn();
  const onOpenSettings = vi.fn();
  const ui = createUi({ onToggle, onCancel, onStop, onOpenSettings, ...overrides });
  created.push(ui);
  return { ui, onToggle, onCancel, onStop, onOpenSettings };
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

interface QuestionFixture {
  dock: HTMLElement;
  option: HTMLElement;
  field: HTMLInputElement | HTMLTextAreaElement;
  footer: HTMLElement | null;
  header: HTMLElement | null;
}

function addQuestion(
  options: { legacy?: boolean; withFooter?: boolean; withHeader?: boolean } = {},
): QuestionFixture {
  const dock = document.createElement("div");
  dock.setAttribute("data-component", "session-question-dock");
  const optionsList = document.createElement("div");
  optionsList.setAttribute("data-slot", "question-options");

  let option: HTMLElement;
  let field: HTMLInputElement | HTMLTextAreaElement;
  if (options.legacy) {
    const form = document.createElement("form");
    form.setAttribute("data-slot", "question-option");
    form.setAttribute("data-custom", "true");
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-slot", "question-custom-input");
    form.appendChild(textarea);
    option = form;
    field = textarea;
  } else {
    const div = document.createElement("div");
    div.setAttribute("data-slot", "question-option");
    div.setAttribute("data-custom", "true");
    const toggle = document.createElement("button");
    toggle.setAttribute("data-slot", "question-custom-toggle");
    const input = document.createElement("input");
    input.setAttribute("data-slot", "text-input-v2-input");
    div.append(toggle, input);
    option = div;
    field = input;
  }
  optionsList.appendChild(option);
  dock.appendChild(optionsList);

  let footer: HTMLElement | null = null;
  if (options.withFooter !== false) {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-slot", "question-footer");
    const dismiss = document.createElement("button");
    dismiss.textContent = "Dismiss";
    footer = document.createElement("div");
    footer.setAttribute("data-slot", "question-footer-actions");
    wrap.append(dismiss, footer);
    dock.appendChild(wrap);
  }

  let header: HTMLElement | null = null;
  if (options.withHeader) {
    const top = document.createElement("div");
    top.setAttribute("data-slot", "question-header-top");
    header = document.createElement("div");
    header.setAttribute("data-slot", "question-header-actions");
    const collapse = document.createElement("button");
    collapse.textContent = "Collapse";
    header.appendChild(collapse);
    top.appendChild(header);
    dock.insertBefore(top, optionsList);
  }

  document.body.appendChild(dock);
  return { dock, option, field, footer, header };
}

function addSessionPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.setAttribute("data-slot", "session-chat-panel");
  document.body.appendChild(panel);
  return panel;
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

  it("keeps the mic and gear available when the actions row is hidden", () => {
    const { ui, onToggle } = makeUi();
    const { dock, actions: slot } = addComposer();
    Object.defineProperty(slot, "getClientRects", { value: () => [], configurable: true });
    ui.start();

    expect(slot?.querySelector('[data-ocvd="composer-mic"]')).toBeNull();
    const fallback = document.querySelector<HTMLElement>('[data-ocvd="composer-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.parentElement).toBe(dock);
    expect(fallback?.querySelector('[data-ocvd="composer-settings"]')).not.toBeNull();
    const mic = fallback?.querySelector<HTMLButtonElement>('[data-ocvd="composer-mic"]');
    expect(mic).not.toBeNull();
    mic?.click();
    expect(onToggle).toHaveBeenCalledWith("composer");
    expect(document.querySelectorAll('[data-ocvd="composer-mic"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-ocvd="composer-settings"]')).toHaveLength(1);
  });

  it("returns the buttons to the actions row when it becomes visible again", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    Object.defineProperty(slot, "getClientRects", { value: () => [], configurable: true });
    ui.start();
    expect(document.querySelector('[data-ocvd="composer-fallback"]')).not.toBeNull();

    Reflect.deleteProperty(slot as HTMLElement, "getClientRects");
    ui.refresh();

    expect(document.querySelector('[data-ocvd="composer-fallback"]')).toBeNull();
    expect(slot?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
    expect(slot?.querySelector('[data-ocvd="composer-settings"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-ocvd="composer-mic"]')).toHaveLength(1);
  });

  it("does not float a composer fallback while a question is open", () => {
    const { ui } = makeUi();
    const { dock, editor, actions: slot } = addComposer();
    for (const node of [dock, editor, slot]) {
      if (node) {
        Object.defineProperty(node, "getClientRects", { value: () => [], configurable: true });
      }
    }
    addQuestion({ withHeader: true });
    ui.start();

    expect(document.querySelector('[data-ocvd="composer-fallback"]')).toBeNull();
    expect(document.querySelector('button[data-ocvd="composer-mic"]')).toBeNull();
    expect(document.querySelector('button[data-ocvd="question-mic"]')).not.toBeNull();
  });

  it("uses a fixed fallback when the whole composer dock is hidden", () => {
    const { ui } = makeUi();
    addSessionPanel();
    const { dock, editor, actions: slot } = addComposer();
    for (const node of [dock, editor, slot]) {
      if (node) {
        Object.defineProperty(node, "getClientRects", { value: () => [], configurable: true });
      }
    }
    ui.start();

    const fallback = document.querySelector<HTMLElement>('[data-ocvd="composer-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.parentElement).toBe(document.documentElement);
    expect(fallback?.classList.contains("ocvd-floating-actions--fixed")).toBe(true);
    expect(fallback?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
  });

  it("does not float a composer fallback on the home page with a stale hidden composer", () => {
    const { ui } = makeUi();
    const { dock, editor, actions: slot } = addComposer();
    for (const node of [dock, editor, slot]) {
      if (node) {
        Object.defineProperty(node, "getClientRects", { value: () => [], configurable: true });
      }
    }
    const home = document.createElement("div");
    home.setAttribute("data-slot", "home-panel");
    document.body.appendChild(home);
    ui.start();

    expect(document.querySelector('[data-ocvd="composer-fallback"]')).toBeNull();
    expect(document.querySelector('button[data-ocvd="composer-mic"]')).toBeNull();
    expect(document.querySelector('button[data-ocvd="composer-settings"]')).toBeNull();
  });

  it("hides the composer mic while the mobile tabs drawer is open", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    const drawer = document.createElement("div");
    drawer.setAttribute("data-slot", "mobile-drawer-content");
    document.body.appendChild(drawer);

    ui.start();
    expect(document.querySelector('button[data-ocvd="composer-mic"]')).toBeNull();
    expect(document.querySelector('button[data-ocvd="composer-settings"]')).toBeNull();

    drawer.setAttribute("data-closed", "");
    ui.refresh();
    expect(slot?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
  });

  it("hides the composer mic while an OpenCode dialog is open", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    const dialog = document.createElement("div");
    dialog.setAttribute("data-component", "dialog-overlay");
    document.body.appendChild(dialog);

    ui.start();
    expect(document.querySelector('button[data-ocvd="composer-mic"]')).toBeNull();

    dialog.remove();
    ui.refresh();
    expect(slot?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
  });

  it("ignores a stale hidden composer when a visible one exists", () => {
    const { ui } = makeUi();
    const stale = addComposer();
    Object.defineProperty(stale.dock, "getClientRects", { value: () => [], configurable: true });
    const visible = addComposer();
    ui.start();

    expect(stale.actions?.querySelector('[data-ocvd="composer-mic"]')).toBeNull();
    expect(visible.actions?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
    expect(visible.actions?.querySelector('[data-ocvd="composer-settings"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-ocvd="composer-mic"]')).toHaveLength(1);
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

  it("restores the mic after OpenCode removes only our button", async () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    slot?.querySelector('[data-ocvd="composer-mic"]')?.remove();
    await vi.waitFor(() => {
      expect(slot?.querySelector('[data-ocvd="composer-mic"]')).not.toBeNull();
    });
  });

  it("updates labels after the interface language changes", () => {
    const { ui } = makeUi();
    const { actions: slot } = addComposer();
    ui.start();
    const mic = slot?.querySelector<HTMLButtonElement>('[data-ocvd="composer-mic"]');
    expect(mic?.getAttribute("aria-label")).toBe("Начать голосовую диктовку");
    setLocale("en");
    ui.refresh();
    expect(mic?.getAttribute("aria-label")).toBe("Start voice dictation");
    expect(mic?.getAttribute("title")).toBe("Start voice dictation");
  });

  it("ships phone-only CSS that shrinks the model title instead of the variant", () => {
    const { ui } = makeUi();
    ui.start();
    const css = document.getElementById("ocvd-page-style")?.textContent ?? "";
    expect(css).toContain("@media (max-width: 767px) and (pointer: coarse) and (hover: none)");
    expect(css).not.toContain("@media (max-width: 767px) {");
    expect(css).toContain('[data-action="composer-model"]');
    expect(css).toContain("flex: 1 1 0");
    expect(css).not.toContain("position: sticky");
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

  it("prefers the always-visible header over the footer", () => {
    const { ui } = makeUi();
    const { header, footer } = addQuestion({ withHeader: true });
    ui.start();

    const mic = header?.querySelector<HTMLButtonElement>('[data-ocvd="question-mic"]');
    expect(mic).not.toBeNull();
    expect(footer?.querySelector('[data-ocvd="question-mic"]')).toBeNull();
    expect(document.querySelectorAll('[data-ocvd="question-mic"]').length).toBe(1);
  });

  it("ignores a stale hidden question dock", () => {
    const { ui } = makeUi();
    const hidden = addQuestion({ withHeader: true });
    Object.defineProperty(hidden.dock, "getClientRects", { value: () => [] });
    const visible = addQuestion({ withHeader: true });
    ui.start();

    expect(hidden.dock.querySelector('[data-ocvd="question-mic"]')).toBeNull();
    expect(visible.header?.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-ocvd="question-mic"]').length).toBe(1);
  });

  it("moves the mic to the header when a header appears", () => {
    const { ui } = makeUi();
    const { dock, footer } = addQuestion();
    ui.start();
    expect(footer?.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();

    const top = document.createElement("div");
    top.setAttribute("data-slot", "question-header-top");
    const header = document.createElement("div");
    header.setAttribute("data-slot", "question-header-actions");
    const collapse = document.createElement("button");
    collapse.textContent = "Collapse";
    header.appendChild(collapse);
    top.appendChild(header);
    dock.insertBefore(top, dock.firstChild);
    ui.refresh();

    expect(footer?.querySelector('[data-ocvd="question-mic"]')).toBeNull();
    expect(header.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-ocvd="question-mic"]').length).toBe(1);
  });

  it("renders a fallback inside the custom option when the footer is missing", () => {
    const { ui } = makeUi();
    const { option, field } = addQuestion({ withFooter: false });
    ui.start();
    const fallback = option.querySelector<HTMLElement>('[data-ocvd="question-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();
    expect(fallback?.previousElementSibling).toBe(field);
  });

  it("falls back to the header when there is no footer", () => {
    const { ui } = makeUi();
    const { header, field } = addQuestion({ withFooter: false, withHeader: true });
    const collapse = header?.querySelector("button") ?? null;
    ui.start();
    const mic = header?.querySelector<HTMLButtonElement>('[data-ocvd="question-mic"]');
    expect(mic).not.toBeNull();
    // The mic goes before the last foreign button, same as in the footer.
    expect([...(header?.children ?? [])]).toEqual([mic, collapse]);
    expect(field.closest("[data-ocvd]")).toBeNull();
  });

  it("removes the fallback when the footer appears", () => {
    const { ui } = makeUi();
    const { dock, option } = addQuestion({ withFooter: false });
    ui.start();
    const footer = document.createElement("div");
    footer.setAttribute("data-slot", "question-footer-actions");
    dock.appendChild(footer);
    ui.refresh();
    expect(option.querySelector('[data-ocvd="question-fallback"]')).toBeNull();
    expect(footer.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();
  });

  it("supports the legacy question form", () => {
    const { ui } = makeUi();
    const { option } = addQuestion({ legacy: true, withFooter: false });
    ui.start();
    const fallback = option.querySelector<HTMLElement>('[data-ocvd="question-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();
  });

  it("restores the mic after OpenCode removes it from the footer", async () => {
    const { ui } = makeUi();
    const { footer } = addQuestion();
    ui.start();
    const mic = footer?.querySelector<HTMLButtonElement>('[data-ocvd="question-mic"]');
    expect(mic).not.toBeNull();
    mic?.remove();
    await vi.waitFor(() => {
      expect(footer?.querySelector('[data-ocvd="question-mic"]')).not.toBeNull();
    });
  });
});

describe("dictation status", () => {
  it("shows recording time and stop/cancel", () => {
    const { ui, onCancel, onStop } = makeUi();
    addComposer();
    ui.start();
    ui.setState("recording", 65);
    expect(queryOverlay<HTMLElement>(".ocvd-status")?.hidden).toBe(false);
    expect(queryOverlay<HTMLElement>(".ocvd-status-text")?.textContent).toBe("01:05");
    expect(queryOverlay<HTMLElement>(".ocvd-dot")).not.toBeNull();
    const stop = queryOverlay<HTMLButtonElement>(".ocvd-stop");
    expect(stop?.hidden).toBe(false);
    expect(stop?.getAttribute("aria-label")).toBe("Остановить запись");
    stop?.click();
    expect(onStop).toHaveBeenCalledTimes(1);
    queryOverlay<HTMLButtonElement>(".ocvd-cancel")?.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("hides the stop button outside recording", () => {
    const { ui } = makeUi();
    addComposer();
    ui.start();
    ui.setState("stt");
    expect(queryOverlay<HTMLButtonElement>(".ocvd-stop")?.hidden).toBe(true);
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
    expect(mic?.querySelector("rect")).toBeNull();
    expect(mic?.querySelectorAll("path")).toHaveLength(3);
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
    buttonByText("Вставить текст")?.click();
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
