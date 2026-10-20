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

function addQuestion(options: { withForm?: boolean; withFooter?: boolean } = {}): {
  dock: HTMLElement;
  textarea: HTMLTextAreaElement;
  form: HTMLFormElement | null;
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

  if (options.withForm === false) {
    dock.appendChild(textarea);
    if (footer) {
      dock.appendChild(footer);
    }
  } else {
    form.appendChild(textarea);
    if (footer) {
      form.appendChild(footer);
    }
    dock.appendChild(form);
  }
  document.body.appendChild(dock);
  return { dock, textarea, form: options.withForm === false ? null : form, footer };
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
      questionDock: false,
      questionInput: false,
      questionFooter: false,
    });
    expect(findComposerEditor()).toBe(editor);
    expect(findComposerActions()).not.toBeNull();
    expect(findComposerDock()).not.toBeNull();
  });

  it("detects question prompts", () => {
    expect(isQuestionPromptOpen()).toBe(false);
    addQuestion();
    expect(isQuestionPromptOpen()).toBe(true);
    expect(findQuestionInput()).not.toBeNull();
    expect(findQuestionFooter()).not.toBeNull();
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
    const { textarea } = addQuestion();
    expect(resolveTarget("question")).toBe("question");
    expect(resolveTarget("composer")).toBe("question");
    textarea.remove();
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
  it("inserts at the caret and fires input", () => {
    const { textarea } = addQuestion();
    textarea.value = "abc";
    textarea.selectionStart = 1;
    textarea.selectionEnd = 1;
    const inputs: string[] = [];
    textarea.addEventListener("input", () => inputs.push(textarea.value));

    expect(insertText("X", "question")).toBe(true);
    expect(textarea.value).toBe("aXbc");
    expect(textarea.selectionStart).toBe(2);
    expect(inputs).toEqual(["aXbc"]);
  });

  it("replaces the whole textarea", () => {
    const { textarea } = addQuestion();
    textarea.value = "old";
    expect(replaceText("new", "question")).toBe(true);
    expect(textarea.value).toBe("new");
    expect(textarea.selectionStart).toBe(3);
  });

  it("returns false without a question textarea", () => {
    expect(insertText("x", "question")).toBe(false);
    expect(replaceText("x", "question")).toBe(false);
    expect(submitQuestion()).toBe(false);
  });
});

describe("question submission", () => {
  it("treats a prevented Enter as handled", () => {
    const { textarea } = addQuestion();
    textarea.addEventListener("keydown", (event) => event.preventDefault());
    expect(submitQuestion()).toBe(true);
  });

  it("submits the form with requestSubmit", () => {
    const { textarea, form } = addQuestion();
    const requestSubmit = vi.fn();
    if (form) {
      form.requestSubmit = requestSubmit;
    }
    expect(submitPrompt("question")).toBe(true);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(textarea).toBe(document.activeElement);
  });

  it("clicks a footer button when no form is available", () => {
    const { textarea } = addQuestion({ withForm: false, withFooter: true });
    const footer = findQuestionFooter();
    const button = document.createElement("button");
    button.textContent = "Ответить";
    footer?.appendChild(button);
    const click = vi.fn();
    button.addEventListener("click", click);
    expect(submitQuestion()).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(textarea).toBe(document.activeElement);
  });

  it("prefers a submit button in the footer", () => {
    addQuestion({ withForm: false });
    const footer = findQuestionFooter();
    const submit = document.createElement("button");
    submit.type = "submit";
    footer?.appendChild(submit);
    const click = vi.fn();
    submit.addEventListener("click", click);
    expect(submitQuestion()).toBe(true);
    expect(click).toHaveBeenCalled();
  });

  it("returns false when the footer has no usable button", () => {
    addQuestion({ withForm: false });
    expect(submitQuestion()).toBe(false);
  });

  it("ignores disabled buttons", () => {
    addQuestion({ withForm: false });
    const footer = findQuestionFooter();
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
