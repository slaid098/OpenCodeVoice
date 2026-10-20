import { afterEach, describe, expect, it, vi } from "vitest";
import { setupKeyboardShortcut } from "../src/keyboard.js";

let cleanup: (() => void) | null = null;

function press(
  key: string,
  modifiers: {
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    repeat?: boolean;
    isComposing?: boolean;
  } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    cancelable: true,
    bubbles: true,
    ...modifiers,
  });
  document.dispatchEvent(event);
  return event;
}

function addSettingsPanel(): void {
  const panel = document.createElement("div");
  panel.dataset.ocvdUi = "settings";
  document.body.appendChild(panel);
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("setupKeyboardShortcut", () => {
  it("toggles on Ctrl+Space", () => {
    const onToggle = vi.fn();
    cleanup = setupKeyboardShortcut(onToggle);
    press(" ", { ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not toggle without Ctrl", () => {
    const onToggle = vi.fn();
    cleanup = setupKeyboardShortcut(onToggle);
    press(" ");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("does not toggle with extra modifiers", () => {
    const onToggle = vi.fn();
    cleanup = setupKeyboardShortcut(onToggle);
    press(" ", { ctrlKey: true, shiftKey: true });
    press(" ", { ctrlKey: true, altKey: true });
    press(" ", { ctrlKey: true, metaKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("does not toggle on Ctrl+other key", () => {
    const onToggle = vi.fn();
    cleanup = setupKeyboardShortcut(onToggle);
    press("a", { ctrlKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("ignores key repeats and composition", () => {
    const onToggle = vi.fn();
    cleanup = setupKeyboardShortcut(onToggle);
    press(" ", { ctrlKey: true, repeat: true });
    press(" ", { ctrlKey: true, isComposing: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("prevents the default action on a match", () => {
    cleanup = setupKeyboardShortcut(() => {});
    const event = press(" ", { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
  });

  it("supports a custom combo", () => {
    const onToggle = vi.fn();
    cleanup = setupKeyboardShortcut(onToggle, "alt+enter");
    press("Enter", { altKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);

    press("Enter", { altKey: true, shiftKey: true });
    press("Enter");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("supports meta and shift combos", () => {
    const onMeta = vi.fn();
    const disposeMeta = setupKeyboardShortcut(onMeta, "meta+k");
    press("k", { metaKey: true });
    expect(onMeta).toHaveBeenCalledTimes(1);
    disposeMeta();

    const onShift = vi.fn();
    const disposeShift = setupKeyboardShortcut(onShift, "shift+tab");
    press("Tab", { shiftKey: true });
    expect(onShift).toHaveBeenCalledTimes(1);
    disposeShift();
  });

  it("runs the escape handler", () => {
    const onEscape = vi.fn();
    cleanup = setupKeyboardShortcut(() => {}, "ctrl+space", onEscape);
    const event = press("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    press("esc");
    expect(onEscape).toHaveBeenCalledTimes(2);
  });

  it("does not run escape with modifiers", () => {
    const onEscape = vi.fn();
    cleanup = setupKeyboardShortcut(() => {}, "ctrl+space", onEscape);
    press("Escape", { ctrlKey: true });
    press("Escape", { shiftKey: true });
    press("Escape", { altKey: true });
    press("Escape", { metaKey: true });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("does not run escape while the settings panel is open", () => {
    const onEscape = vi.fn();
    cleanup = setupKeyboardShortcut(() => {}, "ctrl+space", onEscape);
    addSettingsPanel();
    press("Escape");
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("works without an escape handler", () => {
    const onToggle = vi.fn();
    cleanup = setupKeyboardShortcut(onToggle);
    expect(() => press("Escape")).not.toThrow();
    press(" ", { ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on dispose", () => {
    const onToggle = vi.fn();
    const dispose = setupKeyboardShortcut(onToggle);
    dispose();
    press(" ", { ctrlKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps multiple shortcuts independent", () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = setupKeyboardShortcut(first, "ctrl+space");
    const disposeSecond = setupKeyboardShortcut(second, "ctrl+enter");
    press(" ", { ctrlKey: true });
    press("Enter", { ctrlKey: true });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    disposeFirst();
    disposeSecond();
  });
});
