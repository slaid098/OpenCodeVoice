const KEY_ALIASES: Record<string, string> = {
  space: " ",
  enter: "enter",
  tab: "tab",
  esc: "escape",
  escape: "escape",
};

function normalizeKey(key: string): string {
  return KEY_ALIASES[key.toLowerCase()] ?? key.toLowerCase();
}

export function setupKeyboardShortcut(
  onToggle: () => void,
  combo = "ctrl+space",
  onEscape?: () => void,
): () => void {
  const parts = combo.toLowerCase().split("+");
  const key = normalizeKey(parts[parts.length - 1] ?? "");
  const needsCtrl = parts.includes("ctrl");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.includes("alt");
  const needsMeta = parts.includes("meta");

  const handler = (event: KeyboardEvent) => {
    if (event.repeat || event.isComposing) {
      return;
    }

    const pressed = normalizeKey(event.key);
    if (
      pressed === key &&
      event.ctrlKey === needsCtrl &&
      event.shiftKey === needsShift &&
      event.altKey === needsAlt &&
      event.metaKey === needsMeta
    ) {
      event.preventDefault();
      onToggle();
      return;
    }

    if (
      pressed === "escape" &&
      onEscape &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      document.querySelector('[data-ocvd-ui="settings"]') === null
    ) {
      event.preventDefault();
      onEscape();
    }
  };

  document.addEventListener("keydown", handler, true);

  return () => {
    document.removeEventListener("keydown", handler, true);
  };
}
