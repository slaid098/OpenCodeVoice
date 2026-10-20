import type { InsertTarget, SelectorStatus } from "./types.js";

export const SELECTORS = {
  composerDock: '[data-component="session-composer-dock"]',
  composerForm: 'form[data-component="composer"]',
  editor: '[data-component="composer-editor"][role="textbox"][aria-multiline="true"]',
  composerActions: '[data-slot="composer-actions"]',
  submit: '[data-action="composer-submit"]',
  questionDock: '[data-component="session-question-dock"]',
  questionForm: 'form[data-slot="question-option"][data-custom="true"]',
  questionInput: 'textarea[data-slot="question-custom-input"]',
  questionFooter: '[data-slot="question-footer-actions"]',
} as const;

export const LEGACY_SELECTORS = {
  editor: '[data-component="prompt-input"], [data-component="prompt-input-v2"]',
  submit: '[data-action="prompt-submit"]',
  docks: [
    '[data-component="session-prompt-dock"]',
    '[data-component="session-new-composer"]',
    '[data-component="session-composer"]',
  ],
} as const;

const PAGE_DETECT_SELECTORS = [
  SELECTORS.composerDock,
  SELECTORS.composerForm,
  SELECTORS.editor,
  SELECTORS.questionDock,
  SELECTORS.questionInput,
  ...LEGACY_SELECTORS.docks,
  LEGACY_SELECTORS.editor,
];

export function isOpencodePage(): boolean {
  return PAGE_DETECT_SELECTORS.some((selector) => document.querySelector(selector) !== null);
}

export function isQuestionPromptOpen(): boolean {
  return (
    document.querySelector(SELECTORS.questionInput) !== null ||
    document.querySelector(SELECTORS.questionDock) !== null
  );
}

export function getSelectorStatus(): SelectorStatus {
  return {
    composerDock: document.querySelector(SELECTORS.composerDock) !== null,
    composerForm: document.querySelector(SELECTORS.composerForm) !== null,
    composerEditor: document.querySelector(SELECTORS.editor) !== null,
    composerActions: document.querySelector(SELECTORS.composerActions) !== null,
    composerActionsResolved: findComposerActions() !== null,
    composerSubmit: document.querySelector(SELECTORS.submit) !== null,
    questionDock: document.querySelector(SELECTORS.questionDock) !== null,
    questionInput: document.querySelector(SELECTORS.questionInput) !== null,
    questionFooter: document.querySelector(SELECTORS.questionFooter) !== null,
  };
}

export function findComposerDock(): HTMLElement | null {
  const docks = [...document.querySelectorAll<HTMLElement>(SELECTORS.composerDock)].filter(
    (dock) => dock.querySelector(SELECTORS.editor) !== null,
  );
  if (docks.length > 0) {
    return lastVisible(docks);
  }
  for (const selector of LEGACY_SELECTORS.docks) {
    const candidates = [...document.querySelectorAll<HTMLElement>(selector)];
    const valid = candidates.filter((el) => {
      if (el.querySelector(SELECTORS.questionDock) !== null) {
        return false;
      }
      return el.querySelector(LEGACY_SELECTORS.editor) !== null;
    });
    if (valid.length > 0) {
      return lastVisible(valid);
    }
  }
  return null;
}

export function findComposerEditor(): HTMLElement | null {
  const dock = findComposerDock();
  if (dock) {
    const editor =
      dock.querySelector<HTMLElement>(SELECTORS.editor) ??
      dock.querySelector<HTMLElement>(LEGACY_SELECTORS.editor);
    if (editor) {
      return editor;
    }
  }
  return (
    document.querySelector<HTMLElement>(SELECTORS.editor) ??
    document.querySelector<HTMLElement>(LEGACY_SELECTORS.editor)
  );
}

export function findComposerForm(
  editor: HTMLElement | null = findComposerEditor(),
): HTMLFormElement | null {
  if (!editor) {
    return null;
  }
  return (
    editor.closest<HTMLFormElement>(SELECTORS.composerForm) ??
    editor.closest<HTMLFormElement>("form")
  );
}

export function findComposerActions(): HTMLElement | null {
  const dock = findComposerDock();
  const scoped = dock?.querySelector<HTMLElement>(SELECTORS.composerActions);
  if (scoped) {
    return scoped;
  }

  const editor = findComposerEditor();
  const form = findComposerForm(editor);
  if (form) {
    const actions = form.querySelector<HTMLElement>(SELECTORS.composerActions);
    if (actions) {
      return actions;
    }
    const submit = form.querySelector<HTMLElement>(SELECTORS.submit);
    const row = submit ? actionRow(submit, form, dock ?? editor) : null;
    if (row) {
      return row;
    }
  }

  const globalActions = [
    ...document.querySelectorAll<HTMLElement>(SELECTORS.composerActions),
  ].filter(
    (element) =>
      element.getClientRects().length > 0 && element.closest(SELECTORS.questionDock) === null,
  );
  if (globalActions.length > 0) {
    return globalActions[globalActions.length - 1] ?? null;
  }

  const globalSubmit = document.querySelector<HTMLElement>(SELECTORS.submit);
  return globalSubmit ? actionRow(globalSubmit, form, dock ?? editor) : null;
}

function actionRow(
  submit: HTMLElement,
  form: HTMLElement | null,
  editorOrDock: HTMLElement | null,
): HTMLElement | null {
  const parent = submit.parentElement;
  if (!parent || parent === form || parent === editorOrDock) {
    return null;
  }
  return parent;
}

export function findQuestionInput(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(SELECTORS.questionInput);
}

export function findQuestionFooter(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTORS.questionFooter);
}

export function resolveTarget(preferred: InsertTarget): InsertTarget {
  const question = findQuestionInput();
  if (preferred === "question" && question) {
    return "question";
  }
  if (findComposerEditor()) {
    return "composer";
  }
  if (question) {
    return "question";
  }
  return preferred;
}

export function insertText(text: string, target: InsertTarget = "composer"): boolean {
  const resolved = resolveTarget(target);
  if (resolved === "question") {
    return insertIntoTextarea(text);
  }
  return insertIntoContenteditable(text);
}

export function replaceText(text: string, target: InsertTarget = "composer"): boolean {
  const resolved = resolveTarget(target);
  if (resolved === "question") {
    return replaceIntoTextarea(text);
  }
  return replaceContentEditable(text);
}

export function submitPrompt(target: InsertTarget = "composer"): boolean {
  return target === "question" ? submitQuestion() : submitComposer();
}

export function submitComposer(): boolean {
  const editor = findComposerEditor();
  if (!editor) {
    return false;
  }
  editor.focus();
  const event = createEnterEvent();
  const notCanceled = editor.dispatchEvent(event);
  if (!notCanceled) {
    return true;
  }
  const container = editor.closest<HTMLElement>(SELECTORS.composerDock) ?? findComposerForm(editor);
  const button =
    container?.querySelector<HTMLButtonElement>(SELECTORS.submit) ??
    document.querySelector<HTMLButtonElement>(SELECTORS.submit) ??
    document.querySelector<HTMLButtonElement>(LEGACY_SELECTORS.submit);
  if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
    button.click();
    return true;
  }
  return false;
}

export function submitQuestion(): boolean {
  const textarea = findQuestionInput();
  if (!textarea) {
    return false;
  }
  textarea.focus();
  const event = createEnterEvent();
  const notCanceled = textarea.dispatchEvent(event);
  if (!notCanceled) {
    return true;
  }

  const form =
    textarea.closest<HTMLFormElement>(SELECTORS.questionForm) ?? textarea.closest("form");
  if (form) {
    form.requestSubmit();
    return true;
  }

  const footer = findQuestionFooter();
  const button = footer ? findSubmitButton(footer) : null;
  if (button) {
    button.click();
    return true;
  }
  return false;
}

function insertIntoContenteditable(text: string): boolean {
  const editor = findComposerEditor();
  if (!editor) {
    return false;
  }

  editor.focus();
  placeCaretAtEnd(editor);

  const before = editor.textContent ?? "";
  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }

  const after = editor.textContent ?? "";
  if (inserted || after !== before) {
    return true;
  }

  return insertTextFallback(editor, text);
}

function insertTextFallback(editor: HTMLElement, text: string): boolean {
  const beforeInput = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text,
  });
  if (!editor.dispatchEvent(beforeInput)) {
    return true;
  }

  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range && editor.contains(range.commonAncestorContainer)) {
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else {
    editor.appendChild(document.createTextNode(text));
  }

  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
  return true;
}

function insertIntoTextarea(text: string): boolean {
  const textarea = findQuestionInput();
  if (!textarea) {
    return false;
  }

  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const newValue = textarea.value.substring(0, start) + text + textarea.value.substring(end);

  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) {
    setter.call(textarea, newValue);
  } else {
    textarea.value = newValue;
  }

  const caret = start + text.length;
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
  textarea.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
  textarea.focus();
  return true;
}

function replaceContentEditable(text: string): boolean {
  const editor = findComposerEditor();
  if (!editor) {
    return false;
  }
  editor.focus();
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }
  selection.selectAllChildren(editor);

  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }
  if (inserted) {
    selection.collapseToEnd();
    return true;
  }

  const beforeInput = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text,
  });
  if (!editor.dispatchEvent(beforeInput)) {
    return true;
  }
  editor.textContent = text;
  selection.selectAllChildren(editor);
  selection.collapseToEnd();
  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
  return true;
}

function replaceIntoTextarea(text: string): boolean {
  const textarea = findQuestionInput();
  if (!textarea) {
    return false;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) {
    setter.call(textarea, text);
  } else {
    textarea.value = text;
  }
  textarea.selectionStart = text.length;
  textarea.selectionEnd = text.length;
  textarea.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
  textarea.focus();
  return true;
}

function placeCaretAtEnd(editor: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  if (selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
    selection.collapseToEnd();
    return;
  }
  selection.selectAllChildren(editor);
  selection.collapseToEnd();
}

function createEnterEvent(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
    shiftKey: false,
  });
  Object.defineProperty(event, "keyCode", { get: () => 13 });
  Object.defineProperty(event, "which", { get: () => 13 });
  Object.defineProperty(event, "isComposing", { get: () => false });
  return event;
}

function findSubmitButton(container: HTMLElement): HTMLButtonElement | null {
  const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit && !submit.disabled) {
    return submit;
  }
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => !button.disabled && button.getAttribute("aria-disabled") !== "true",
  );
  const labeled = buttons.find((button) =>
    /отправ|submit|send|answer|ответ/i.test(button.textContent ?? ""),
  );
  return labeled ?? buttons[buttons.length - 1] ?? null;
}

function lastVisible(elements: HTMLElement[]): HTMLElement {
  const visible = elements.filter((element) => element.getClientRects().length > 0);
  return visible[visible.length - 1] ?? elements[elements.length - 1];
}
