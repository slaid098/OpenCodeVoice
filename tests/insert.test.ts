import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_SELECTORS,
  SELECTORS,
  findComposerActions,
  findComposerDock,
  findComposerEditor,
  findQuestionFooter,
  findQuestionInput,
  getSelectorStatus,
  insertText,
  isOpencodePage,
  isQuestionPromptOpen,
  replaceText,
  resolveTarget,
  submitComposer,
  submitPrompt,
  submitQuestion,
} from "../src/insert.js";

function addComposer(options: { withActions?: boolean; withSubmit?: boolean } = {}): {
  dock: HTMLElement;
  editor: HTMLElement;
  actions: HTMLElement | null;
  submit: HTMLButtonElement | null;
} {
  const dock = document.createElement("div");
  dock.setAttribute("data-component", "session-composer-dock");
  const editor = document.createElement("div");
  editor.setAttribute("data-component", "composer-editor");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("contenteditable", "true");
  dock.appendChild(editor);

  let actions: HTMLElement | null = null;
  if (options.withActions !== false) {
    actions = document.createElement("div");
    actions.setAttribute("data-slot", "composer-actions");
    dock.appendChild(actions);
  }

  let submit: HTMLButtonElement | null = null;
  if (options.withSubmit !== false) {
    submit = document.createElement("button");
    submit.setAttribute("data-action", "composer-submit");
    submit.type = "button";
    (actions ?? dock).appendChild(submit);
  }

  document.body.appendChild(dock);
  return { dock, editor, actions, submit };
}

interface QuestionFixture {
  dock: HTMLElement;
  /** The field the dictation should be inserted into. */
  field: HTMLInputElement | HTMLTextAreaElement;
  form: HTMLFormElement | null;
  footer: HTMLElement | null;
}

function addQuestion(
  options: { legacy?: boolean; withFooter?: boolean; withHeader?: boolean } = {},
): QuestionFixture {
  const dock = document.createElement("div");
  dock.setAttribute("data-component", "session-question-dock");
  const optionsList = document.createElement("div");
  optionsList.setAttribute("data-slot", "question-options");

  let field: HTMLInputElement | HTMLTextAreaElement;
  let form: HTMLFormElement | null = null;

  if (options.legacy) {
    form = document.createElement("form");
    form.setAttribute("data-slot", "question-option");
    form.setAttribute("data-custom", "true");
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-slot", "question-custom-input");
    form.appendChild(textarea);
    optionsList.appendChild(form);
    field = textarea;
  } else {
    const option = document.createElement("div");
    option.setAttribute("data-slot", "question-option");
    option.setAttribute("data-custom", "true");
    const toggle = document.createElement("button");
    toggle.setAttribute("data-slot", "question-custom-toggle");
    const input = document.createElement("input");
    input.setAttribute("data-slot", "text-input-v2-input");
    option.append(toggle, input);
    optionsList.appendChild(option);
    field = input;
  }
  dock.appendChild(optionsList);

  let footer: HTMLElement | null = null;
  if (options.withFooter !== false) {
    const footerWrap = document.createElement("div");
    footerWrap.setAttribute("data-slot", "question-footer");
    const dismiss = document.createElement("button");
    dismiss.textContent = "Dismiss";
    footer = document.createElement("div");
    footer.setAttribute("data-slot", "question-footer-actions");
    footerWrap.append(dismiss, footer);
    dock.appendChild(footerWrap);
  }

  if (options.withHeader) {
    const headerTop = document.createElement("div");
    headerTop.setAttribute("data-slot", "question-header-top");
    const header = document.createElement("div");
    header.setAttribute("data-slot", "question-header-actions");
    const collapse = document.createElement("button");
    collapse.textContent = "Collapse";
    header.appendChild(collapse);
    headerTop.appendChild(header);
    dock.insertBefore(headerTop, optionsList);
  }

  document.body.appendChild(dock);
  return { dock, field, form, footer };
}

function stubExecCommand(impl: () => boolean): void {
  Object.defineProperty(document, "execCommand", {
    value: vi.fn(impl),
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
});

describe("DOM detection", () => {
  it("detects OpenCode pages and selector status", () => {
    expect(isOpencodePage()).toBe(false);
    const { editor } = addComposer();
    expect(isOpencodePage()).toBe(true);
    expect(getSelectorStatus()).toEqual({
      composerDock: true,
      composerForm: false,
      composerEditor: true,
      composerActions: true,
      composerActionsResolved: true,
      composerSubmit: true,
      composerMic: false,
      composerMicVisible: false,
      questionDock: false,
      questionInput: false,
      questionInputCurrent: false,
      questionInputLegacy: false,
      questionHeaderActions: false,
      questionCustomOption: false,
      questionFooter: false,
      questionMic: false,
      questionMicVisible: false,
    });
    expect(findComposerEditor()).toBe(editor);
    expect(findComposerActions()).not.toBeNull();
    expect(findComposerDock()).not.toBeNull();
  });

  it("detects question prompts in the current DOM", () => {
    expect(isQuestionPromptOpen()).toBe(false);
    const { field, footer } = addQuestion();
    expect(isQuestionPromptOpen()).toBe(true);
    expect(findQuestionInput()).toBe(field);
    expect(findQuestionFooter()).toBe(footer);
    const status = getSelectorStatus();
    expect(status).toMatchObject({
      questionDock: true,
      questionInput: true,
      questionInputCurrent: true,
      questionInputLegacy: false,
      questionCustomOption: true,
      questionFooter: true,
    });
  });

  it("detects legacy question prompts", () => {
    const { field } = addQuestion({ legacy: true, withFooter: false });
    expect(isQuestionPromptOpen()).toBe(true);
    expect(findQuestionInput()).toBe(field);
    expect(getSelectorStatus()).toMatchObject({
      questionInput: true,
      questionInputCurrent: false,
      questionInputLegacy: true,
      questionFooter: false,
    });
  });

  it("finds actions through the composer form when the dock is missing", () => {
    const form = document.createElement("form");
    form.setAttribute("data-component", "composer");
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "composer-editor");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.setAttribute("contenteditable", "true");
    const actions = document.createElement("div");
    actions.setAttribute("data-slot", "composer-actions");
    const submit = document.createElement("button");
    submit.setAttribute("data-action", "composer-submit");
    actions.appendChild(submit);
    form.append(editor, actions);
    document.body.appendChild(form);

    expect(findComposerDock()).toBeNull();
    expect(findComposerEditor()).toBe(editor);
    expect(findComposerActions()).toBe(actions);
    expect(getSelectorStatus()).toMatchObject({
      composerDock: false,
      composerForm: true,
      composerEditor: true,
      composerActions: true,
      composerActionsResolved: true,
    });
  });

  it("falls back to the submit row when the actions slot is missing", () => {
    const form = document.createElement("form");
    form.setAttribute("data-component", "composer");
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "composer-editor");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    const row = document.createElement("div");
    const submit = document.createElement("button");
    submit.setAttribute("data-action", "composer-submit");
    row.appendChild(submit);
    form.append(editor, row);
    document.body.appendChild(form);

    expect(findComposerActions()).toBe(row);
    expect(getSelectorStatus()).toMatchObject({
      composerActions: false,
      composerActionsResolved: true,
    });
  });

  it("uses a global submit row when there is no dock or form", () => {
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "composer-editor");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    const row = document.createElement("div");
    const submit = document.createElement("button");
    submit.setAttribute("data-action", "composer-submit");
    row.appendChild(submit);
    document.body.append(editor, row);

    expect(findComposerActions()).toBe(row);
  });

  it("ignores question actions in the global fallback", () => {
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "composer-editor");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    document.body.appendChild(editor);
    const questionDock = document.createElement("div");
    questionDock.setAttribute("data-component", "session-question-dock");
    const questionActions = document.createElement("div");
    questionActions.setAttribute("data-slot", "composer-actions");
    questionDock.appendChild(questionActions);
    document.body.appendChild(questionDock);

    expect(findComposerActions()).toBeNull();
  });

  it("finds the last of several composer docks", () => {
    const first = addComposer();
    const second = addComposer();
    expect(findComposerDock()).toBe(second.dock);
    expect(first.dock).not.toBe(second.dock);
  });

  it("supports legacy composer selectors", () => {
    const dock = document.createElement("div");
    dock.setAttribute("data-component", "session-prompt-dock");
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "prompt-input");
    dock.appendChild(editor);
    document.body.appendChild(dock);
    expect(isOpencodePage()).toBe(true);
    expect(findComposerDock()).toBe(dock);
    expect(findComposerEditor()).toBe(editor);
  });

  it("ignores legacy docks that contain a question prompt", () => {
    const dock = document.createElement("div");
    dock.setAttribute("data-component", "session-prompt-dock");
    const questionDock = document.createElement("div");
    questionDock.setAttribute("data-component", "session-question-dock");
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "prompt-input");
    dock.append(questionDock, editor);
    document.body.appendChild(dock);
    expect(findComposerDock()).toBeNull();
  });

  it("resolves the preferred target", () => {
    expect(resolveTarget("composer")).toBe("composer");
    const { field } = addQuestion();
    expect(resolveTarget("question")).toBe("question");
    expect(resolveTarget("composer")).toBe("question");
    field.remove();
    const { editor } = addComposer();
    expect(resolveTarget("question")).toBe("composer");
    expect(resolveTarget("composer")).toBe("composer");
    editor.closest(SELECTORS.composerDock)?.remove();
    expect(resolveTarget("question")).toBe("question");
  });
});

describe("composer insertion", () => {
  it("inserts through execCommand", () => {
    const { editor } = addComposer();
    stubExecCommand(() => {
      editor.textContent = "hello";
      return true;
    });
    expect(insertText("hello")).toBe(true);
    expect(editor.textContent).toBe("hello");
  });

  it("falls back to a text node when execCommand fails", () => {
    const { editor } = addComposer();
    editor.textContent = "start";
    stubExecCommand(() => false);
    expect(insertText(" world")).toBe(true);
    expect(editor.textContent).toBe("start world");
  });

  it("honours a canceled beforeinput event", () => {
    const { editor } = addComposer();
    editor.textContent = "start";
    stubExecCommand(() => false);
    editor.addEventListener("beforeinput", (event) => event.preventDefault());
    expect(insertText("world")).toBe(true);
    expect(editor.textContent).toBe("start");
  });

  it("returns false when there is no editor", () => {
    expect(insertText("x")).toBe(false);
    expect(replaceText("x")).toBe(false);
    expect(submitComposer()).toBe(false);
  });

  it("replaces content through execCommand", () => {
    addComposer();
    stubExecCommand(() => true);
    expect(replaceText("new text")).toBe(true);
  });

  it("replaces content through the fallback", () => {
    const { editor } = addComposer();
    editor.textContent = "old text";
    stubExecCommand(() => false);
    expect(replaceText("new text")).toBe(true);
    expect(editor.textContent).toBe("new text");
  });

  it("dispatches an input event after fallback insertion", () => {
    const { editor } = addComposer();
    const inputs: InputEvent[] = [];
    editor.addEventListener("input", (event) => inputs.push(event as InputEvent));
    stubExecCommand(() => false);
    insertText("abc");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.inputType).toBe("insertText");
    expect(inputs[0]?.data).toBe("abc");
  });
});

describe("composer submission", () => {
  it("treats a prevented Enter as handled", () => {
    const { editor } = addComposer();
    editor.addEventListener("keydown", (event) => event.preventDefault());
    expect(submitComposer()).toBe(true);
  });

  it("clicks the submit button when Enter is not handled", () => {
    const { submit } = addComposer();
    const click = vi.fn();
    submit?.addEventListener("click", click);
    expect(submitComposer()).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("falls back to a legacy submit button", () => {
    const dock = document.createElement("div");
    dock.setAttribute("data-component", "session-prompt-dock");
    const editor = document.createElement("div");
    editor.setAttribute("data-component", "prompt-input");
    editor.setAttribute("role", "textbox");
    dock.appendChild(editor);
    const button = document.createElement("button");
    button.setAttribute("data-action", "prompt-submit");
    dock.appendChild(button);
    document.body.appendChild(dock);
    const click = vi.fn();
    button.addEventListener("click", click);
    expect(submitComposer()).toBe(true);
    expect(click).toHaveBeenCalled();
  });

  it("returns false when the submit button is unavailable or disabled", () => {
    const { submit } = addComposer();
    if (submit) {
      submit.disabled = true;
    }
    expect(submitComposer()).toBe(false);

    submit?.remove();
    expect(submitComposer()).toBe(false);
  });

  it("dispatches Enter with the expected properties", () => {
    const { editor } = addComposer({ withSubmit: false });
    let observed: KeyboardEvent | null = null;
    editor.addEventListener("keydown", (event) => {
      observed = event as KeyboardEvent;
      event.preventDefault();
    });
    submitComposer();
    expect(observed).not.toBeNull();
    if (!observed) {
      return;
    }
    const event = observed as KeyboardEvent;
    expect(event.key).toBe("Enter");
    expect(event.code).toBe("Enter");
    expect(event.keyCode).toBe(13);
    expect(event.which).toBe(13);
    expect(event.shiftKey).toBe(false);
    expect(event.isComposing).toBe(false);
  });
});

describe("question insertion", () => {
  it("inserts at the caret of the current text input and fires input", () => {
    const { field } = addQuestion();
    field.value = "abc";
    field.setSelectionRange(1, 1);
    const inputs: string[] = [];
    field.addEventListener("input", () => inputs.push(field.value));

    expect(insertText("X", "question")).toBe(true);
    expect(field.value).toBe("aXbc");
    expect(field.selectionStart).toBe(2);
    expect(inputs).toEqual(["aXbc"]);
  });

  it("replaces the whole current text input", () => {
    const { field } = addQuestion();
    field.value = "old";
    expect(replaceText("new", "question")).toBe(true);
    expect(field.value).toBe("new");
    expect(field.selectionStart).toBe(3);
  });

  it("inserts into the legacy textarea", () => {
    const { field } = addQuestion({ legacy: true });
    field.value = "abc";
    field.setSelectionRange(1, 1);
    expect(insertText("X", "question")).toBe(true);
    expect(field.value).toBe("aXbc");
    expect(field.selectionStart).toBe(2);
  });

  it("replaces the whole legacy textarea", () => {
    const { field } = addQuestion({ legacy: true });
    field.value = "old";
    expect(replaceText("new", "question")).toBe(true);
    expect(field.value).toBe("new");
    expect(field.selectionStart).toBe(3);
  });

  it("returns false without a question field", () => {
    expect(insertText("x", "question")).toBe(false);
    expect(replaceText("x", "question")).toBe(false);
    expect(submitQuestion()).toBe(false);
  });
});

describe("question submission", () => {
  it("clicks the last enabled footer button in the current DOM", () => {
    const { footer } = addQuestion();
    const back = document.createElement("button");
    back.textContent = "Back";
    const next = document.createElement("button");
    next.textContent = "Next";
    footer?.append(back, next);
    const backClick = vi.fn();
    const nextClick = vi.fn();
    back.addEventListener("click", backClick);
    next.addEventListener("click", nextClick);
    expect(submitPrompt("question")).toBe(true);
    expect(backClick).not.toHaveBeenCalled();
    expect(nextClick).toHaveBeenCalledTimes(1);
  });

  it("ignores our dictation button when picking the footer action", () => {
    const { footer } = addQuestion();
    const next = document.createElement("button");
    next.textContent = "Next";
    const mic = document.createElement("button");
    mic.setAttribute("data-ocvd", "question-mic");
    footer?.append(next, mic);
    const nextClick = vi.fn();
    next.addEventListener("click", nextClick);
    expect(submitQuestion()).toBe(true);
    expect(nextClick).toHaveBeenCalledTimes(1);
  });

  it("treats a prevented Enter as handled in the legacy DOM", () => {
    const { field } = addQuestion({ legacy: true, withFooter: false });
    field.addEventListener("keydown", (event) => event.preventDefault());
    expect(submitQuestion()).toBe(true);
  });

  it("submits the legacy form with requestSubmit", () => {
    const { field, form } = addQuestion({ legacy: true, withFooter: false });
    const requestSubmit = vi.fn();
    if (form) {
      form.requestSubmit = requestSubmit;
    }
    expect(submitPrompt("question")).toBe(true);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(field).toBe(document.activeElement);
  });

  it("clicks a footer button when there is no form", () => {
    const { footer } = addQuestion();
    const button = document.createElement("button");
    button.textContent = "Ответить";
    footer?.appendChild(button);
    const click = vi.fn();
    button.addEventListener("click", click);
    expect(submitQuestion()).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("prefers the last footer button", () => {
    const { footer } = addQuestion();
    const first = document.createElement("button");
    const submit = document.createElement("button");
    submit.type = "submit";
    footer?.append(first, submit);
    const firstClick = vi.fn();
    const click = vi.fn();
    first.addEventListener("click", firstClick);
    submit.addEventListener("click", click);
    expect(submitQuestion()).toBe(true);
    expect(firstClick).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });

  it("returns false when the footer has no usable button", () => {
    addQuestion();
    expect(submitQuestion()).toBe(false);
  });

  it("ignores disabled buttons", () => {
    const { footer } = addQuestion();
    const button = document.createElement("button");
    button.disabled = true;
    footer?.appendChild(button);
    expect(submitQuestion()).toBe(false);
  });
});

describe("selectors constants", () => {
  it("keeps legacy selector compatibility", () => {
    expect(LEGACY_SELECTORS.docks).toHaveLength(3);
    expect(LEGACY_SELECTORS.editor).toContain("prompt-input-v2");
  });
});
