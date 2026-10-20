import type { InsertTarget, SelectorStatus } from "./types.js";

const QUESTION_INPUT_CURRENT =
  '[data-slot="question-option"][data-custom="true"] [data-slot="text-input-v2-input"]';
const QUESTION_INPUT_LEGACY = 'textarea[data-slot="question-custom-input"]';

export const SELECTORS = {
  composerDock: '[data-component="session-composer-dock"]',
  composerForm: 'form[data-component="composer"]',
  editor: '[data-component="composer-editor"][role="textbox"][aria-multiline="true"]',
  composerActions: '[data-slot="composer-actions"]',
  submit: '[data-action="composer-submit"]',
  questionDock: '[data-component="session-question-dock"]',
  questionForm: 'form[data-slot="question-option"][data-custom="true"]',
  questionFooter: '[data-slot="question-footer-actions"]',
  questionHeaderActions: '[data-slot="question-header-actions"]',
  questionCustomOption: '[data-slot="question-option"][data-custom="true"]',
  questionInputCurrent: QUESTION_INPUT_CURRENT,
  questionInputLegacy: QUESTION_INPUT_LEGACY,
  questionInput: `${QUESTION_INPUT_CURRENT}, ${QUESTION_INPUT_LEGACY}`,
} as const;

export type QuestionInput = HTMLInputElement | HTMLTextAreaElement;

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
  const composerMic = document.querySelector('[data-ocvd="composer-mic"]');
  const questionMic = document.querySelector('[data-ocvd="question-mic"]');
  return {
    composerDock: document.querySelector(SELECTORS.composerDock) !== null,
    composerForm: document.querySelector(SELECTORS.composerForm) !== null,
    composerEditor: document.querySelector(SELECTORS.editor) !== null,
    composerActions: document.querySelector(SELECTORS.composerActions) !== null,
    composerActionsResolved: findComposerActions() !== null,
    composerSubmit: document.querySelector(SELECTORS.submit) !== null,
    composerMic: composerMic !== null,
    composerMicVisible: isVisibleNode(composerMic),
    questionDock: document.querySelector(SELECTORS.questionDock) !== null,
    questionInput: document.querySelector(SELECTORS.questionInput) !== null,
    questionInputCurrent: document.querySelector(SELECTORS.questionInputCurrent) !== null,
    questionInputLegacy: document.querySelector(SELECTORS.questionInputLegacy) !== null,
    questionHeaderActions: document.querySelector(SELECTORS.questionHeaderActions) !== null,
    questionCustomOption: document.querySelector(SELECTORS.questionCustomOption) !== null,
    questionFooter: document.querySelector(SELECTORS.questionFooter) !== null,
    questionMic: questionMic !== null,
    questionMicVisible: isVisibleNode(questionMic),
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
  const dockEditor = dock
    ? (dock.querySelector<HTMLElement>(SELECTORS.editor) ??
      dock.querySelector<HTMLElement>(LEGACY_SELECTORS.editor))
    : null;
  if (dockEditor && dockEditor.getClientRects().length > 0) {
    return dockEditor;
  }

  // OpenCode can keep a hidden composer from a previous render, and Firefox
  // Android may not render a dock at all. Prefer the last visible editor over
  // the first stale one.
  const editors = [
    ...document.querySelectorAll<HTMLElement>(SELECTORS.editor),
    ...document.querySelectorAll<HTMLElement>(LEGACY_SELECTORS.editor),
  ];
  const visible = editors.filter((editor) => editor.getClientRects().length > 0);
  if (visible.length > 0) {
    return visible[visible.length - 1] ?? null;
  }
  return dockEditor ?? editors[editors.length - 1] ?? null;
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
  // Resolve through the selected editor first: the dock may be hidden while a
  // visible composer lives outside it (or vice versa).
  const editor = findComposerEditor();
  const form = findComposerForm(editor);
  if (form) {
    const actions = form.querySelector<HTMLElement>(SELECTORS.composerActions);
    if (actions) {
      return actions;
    }
    const submit = form.querySelector<HTMLElement>(SELECTORS.submit);
    const row = submit ? actionRow(submit, form, editor) : null;
    if (row) {
      return row;
    }
  }

  const dock = findComposerDock();
  const scoped = dock?.querySelector<HTMLElement>(SELECTORS.composerActions);
  if (scoped) {
    return scoped;
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

function findComposerSubmit(editor: HTMLElement): HTMLButtonElement | null {
  const form = findComposerForm(editor);
  const dock = editor.closest<HTMLElement>(SELECTORS.composerDock) ?? findComposerDock();
  return (
    dock?.querySelector<HTMLButtonElement>(SELECTORS.submit) ??
    form?.querySelector<HTMLButtonElement>(SELECTORS.submit) ??
    document.querySelector<HTMLButtonElement>(SELECTORS.submit) ??
    document.querySelector<HTMLButtonElement>(LEGACY_SELECTORS.submit)
  );
}

/** True when the composer has a submit button that cannot send right now. */
export function isComposerSubmitBusy(): boolean {
  const editor = findComposerEditor();
  if (!editor) {
    return false;
  }
  const button = findComposerSubmit(editor);
  return button !== null && isButtonDisabled(button);
}

function isButtonDisabled(button: HTMLButtonElement): boolean {
  return button.disabled || button.getAttribute("aria-disabled") === "true";
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

/**
 * OpenCode can keep a hidden question dock from a previous render in the DOM.
 * Always resolve the last visible dock, the same way findComposerDock() does.
 */
function findQuestionDock(): HTMLElement | null {
  const docks = [...document.querySelectorAll<HTMLElement>(SELECTORS.questionDock)];
  return docks.length > 0 ? lastVisible(docks) : null;
}

function findInQuestionDock<T extends Element>(selector: string): T | null {
  const dock = findQuestionDock();
  return dock ? dock.querySelector<T>(selector) : document.querySelector<T>(selector);
}

export function findQuestionInput(): QuestionInput | null {
  return findInQuestionDock<QuestionInput>(SELECTORS.questionInput);
}

export function findQuestionFooter(): HTMLElement | null {
  return findInQuestionDock<HTMLElement>(SELECTORS.questionFooter);
}

export function findQuestionHeaderActions(): HTMLElement | null {
  return findInQuestionDock<HTMLElement>(SELECTORS.questionHeaderActions);
}

export function findQuestionCustomOption(): HTMLElement | null {
  return findInQuestionDock<HTMLElement>(SELECTORS.questionCustomOption);
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

interface DraftSnapshot {
  target: InsertTarget;
  text: string;
}

let draftSnapshot: DraftSnapshot | null = null;

function readDraftText(target: InsertTarget): string | null {
  if (target === "question") {
    const field = findQuestionInput();
    return field ? field.value : null;
  }
  const editor = findComposerEditor();
  return editor ? (editor.textContent ?? "") : null;
}

export function rememberDraft(target: InsertTarget = "composer"): void {
  const text = readDraftText(target);
  draftSnapshot = text === null ? null : { target, text };
}

export function isDraftChanged(target: InsertTarget = "composer"): boolean {
  if (!draftSnapshot || draftSnapshot.target !== target) {
    return false;
  }
  const text = readDraftText(target);
  return text !== null && text !== draftSnapshot.text;
}

export function insertText(text: string, target: InsertTarget = "composer"): boolean {
  const resolved = resolveTarget(target);
  if (resolved === "question") {
    return insertIntoQuestionField(text);
  }
  return insertIntoContenteditable(text);
}

export function replaceText(text: string, target: InsertTarget = "composer"): boolean {
  const resolved = resolveTarget(target);
  if (resolved === "question") {
    return replaceIntoQuestionField(text);
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
  const button = findComposerSubmit(editor);
  // A disabled submit means OpenCode will not accept the message right now
  // (the agent is still working, the session is blocked, or uploads are
  // pending). Dispatching Enter anyway can be swallowed by the editor, so
  // report the failure instead of pretending the message was sent.
  if (button && isButtonDisabled(button)) {
    return false;
  }
  editor.focus();
  const event = createEnterEvent();
  const notCanceled = editor.dispatchEvent(event);
  if (!notCanceled) {
    return true;
  }
  if (button) {
    button.click();
    return true;
  }
  return false;
}

export function submitQuestion(): boolean {
  const footer = findQuestionFooter();
  if (footer) {
    const button = findLastEnabledButton(footer);
    if (!button) {
      return false;
    }
    button.click();
    return true;
  }

  const field = findQuestionInput();
  if (!field) {
    return false;
  }
  field.focus();
  const event = createEnterEvent();
  const notCanceled = field.dispatchEvent(event);
  if (!notCanceled) {
    return true;
  }

  const form = field.closest<HTMLFormElement>(SELECTORS.questionForm) ?? field.closest("form");
  if (form) {
    form.requestSubmit();
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

function insertIntoQuestionField(text: string): boolean {
  const field = findQuestionInput();
  if (!field) {
    return false;
  }

  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  const newValue = field.value.substring(0, start) + text + field.value.substring(end);

  setFieldValue(field, newValue);
  setCaret(field, start + text.length);
  dispatchInput(field, text);
  field.focus();
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

function replaceIntoQuestionField(text: string): boolean {
  const field = findQuestionInput();
  if (!field) {
    return false;
  }
  setFieldValue(field, text);
  setCaret(field, text.length);
  dispatchInput(field, text);
  field.focus();
  return true;
}

function setFieldValue(field: QuestionInput, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(field, value);
  } else {
    field.value = value;
  }
}

function setCaret(field: QuestionInput, position: number): void {
  try {
    field.setSelectionRange(position, position);
  } catch {
    field.selectionStart = position;
    field.selectionEnd = position;
  }
}

function dispatchInput(field: QuestionInput, text: string): void {
  field.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
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

function findLastEnabledButton(container: HTMLElement): HTMLButtonElement | null {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => !button.hasAttribute("data-ocvd"),
  );
  const last = buttons[buttons.length - 1] ?? null;
  if (!last || last.disabled || last.getAttribute("aria-disabled") === "true") {
    return null;
  }
  return last;
}

function isVisibleNode(element: Element | null): boolean {
  return element instanceof HTMLElement && element.getClientRects().length > 0;
}

function lastVisible(elements: HTMLElement[]): HTMLElement {
  const visible = elements.filter((element) => element.getClientRects().length > 0);
  return visible[visible.length - 1] ?? elements[elements.length - 1];
}
