import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CLEANUP_PROMPT_RU, createDefaultConfig } from "../src/config.js";
import { type SettingsPanel, createSettingsPanel } from "../src/settings-panel.js";
import { clearFailures, saveFailure } from "../src/storage.js";
import type { AppConfig, FailedDictation } from "../src/types.js";
import { __getRequests, __setXmlhttpResponder } from "./__mocks__/$/index.js";

interface PanelDeps {
  getConfig: () => AppConfig;
  saveConfig: ReturnType<typeof vi.fn>;
  onSaved: ReturnType<typeof vi.fn>;
  onClearFailures?: ReturnType<typeof vi.fn>;
  getLastRawText: () => string | null;
}

const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
const panels: SettingsPanel[] = [];

function validConfig(overrides: (config: AppConfig) => void = () => {}): AppConfig {
  const config = createDefaultConfig();
  config.ui.language = "ru";
  config.stt.apiKey = "stt-key";
  config.llm.apiKey = "llm-key";
  config.retry.maxAttempts = 1;
  overrides(config);
  return config;
}

function makeDeps(config = validConfig()): PanelDeps {
  let current = config;
  const saveConfig = vi.fn((next: AppConfig) => {
    current = next;
  });
  return {
    getConfig: () => current,
    saveConfig,
    onSaved: vi.fn(),
    getLastRawText: () => null,
  };
}

function openPanel(deps: PanelDeps = makeDeps()): { panel: SettingsPanel; deps: PanelDeps } {
  const panel = createSettingsPanel(deps);
  panels.push(panel);
  panel.open();
  return { panel, deps };
}

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-ocvd-ui="settings"]');
}

function root(): ShadowRoot {
  const shadow = host()?.shadowRoot;
  if (!shadow) {
    throw new Error("settings panel is not open");
  }
  return shadow;
}

function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

function buttons(): HTMLButtonElement[] {
  return [...root().querySelectorAll<HTMLButtonElement>("button")];
}

function clickButton(label: string): void {
  const button = buttons().find((candidate) => candidate.textContent === label);
  must(button, `button "${label}" not found`).click();
}

function button(label: string): HTMLButtonElement {
  return must(
    buttons().find((candidate) => candidate.textContent === label),
    `button "${label}" not found`,
  );
}

function openTab(id: "stt" | "llm" | "behavior" | "diagnostics"): void {
  const tab = root().querySelector<HTMLButtonElement>(`.tab[data-tab="${id}"]`);
  must(tab, `tab ${id} not found`).click();
}

function field(labelText: string): HTMLElement {
  for (const row of root().querySelectorAll<HTMLElement>(".field")) {
    if (row.querySelector(".field-label")?.textContent === labelText) {
      return must(
        row.querySelector<HTMLElement>("input, textarea, select"),
        `control for "${labelText}" not found`,
      );
    }
  }
  throw new Error(`field "${labelText}" not found`);
}

function setValue(control: HTMLElement, value: string): void {
  if (control instanceof HTMLSelectElement) {
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  throw new Error("unsupported control");
}

function input(labelText: string): HTMLInputElement {
  const control = field(labelText);
  if (!(control instanceof HTMLInputElement)) {
    throw new Error(`"${labelText}" is not an input`);
  }
  return control;
}

function textarea(labelText: string): HTMLTextAreaElement {
  const control = field(labelText);
  if (!(control instanceof HTMLTextAreaElement)) {
    throw new Error(`"${labelText}" is not a textarea`);
  }
  return control;
}

function checkbox(title: string): HTMLInputElement {
  for (const row of root().querySelectorAll<HTMLElement>(".check-row")) {
    if (row.querySelector(".check-title")?.textContent === title) {
      return must(row.querySelector<HTMLInputElement>("input"), `checkbox "${title}"`);
    }
  }
  throw new Error(`checkbox "${title}" not found`);
}

function toggle(title: string, checked?: boolean): void {
  const control = checkbox(title);
  control.checked = checked ?? !control.checked;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function footerStatus(): string {
  return root().querySelector<HTMLElement>(".footer-status")?.textContent ?? "";
}

function visibleInlineText(): string {
  return [...root().querySelectorAll<HTMLElement>(".inline-status")]
    .filter((node) => !node.hidden)
    .map((node) => node.textContent ?? "")
    .join(" | ");
}

function json(payload: unknown, status = 200): { status: number; responseText: string } {
  return { status, responseText: JSON.stringify(payload) };
}

function addComposer(): void {
  const dock = document.createElement("div");
  dock.setAttribute("data-component", "session-composer-dock");
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
  dock.append(editor, actions);
  document.body.appendChild(dock);
}

function failure(overrides: Partial<FailedDictation> = {}): FailedDictation {
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

beforeEach(async () => {
  await clearFailures();
});

afterEach(() => {
  for (const panel of panels.splice(0)) {
    panel.destroy();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalStorage) {
    Object.defineProperty(navigator, "storage", originalStorage);
  } else {
    Reflect.deleteProperty(navigator, "storage");
  }
});

describe("opening and closing", () => {
  it("opens a modal bottom sheet on the STT tab", () => {
    const { panel } = openPanel();
    expect(panel.isOpen()).toBe(true);
    const sheet = must(root().querySelector<HTMLElement>(".sheet"), "sheet");
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(root().querySelector(".title")?.textContent).toBe("Голосовой ввод");
    expect(root().querySelector(".subtitle")?.textContent).toBe("OpenCode 2 · v0.9.3");
    expect(root().querySelector('.tab[data-tab="stt"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(field("Провайдер")).toBeInstanceOf(HTMLSelectElement);
    expect(root().activeElement?.getAttribute("aria-label")).toBe("Закрыть настройки");
  });

  it("closes with the close button and restores focus", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const panel = createSettingsPanel(makeDeps());
    panels.push(panel);
    panel.open();
    clickButton("×");
    expect(panel.isOpen()).toBe(false);
    expect(host()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape but ignores composition", () => {
    const { panel } = openPanel();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true }));
    expect(panel.isOpen()).toBe(true);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(panel.isOpen()).toBe(false);
  });

  it("closes on a backdrop click but not on a sheet click", () => {
    const { panel } = openPanel();
    must(root().querySelector<HTMLElement>(".sheet"), "sheet").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(panel.isOpen()).toBe(true);
    must(root().querySelector<HTMLElement>(".backdrop"), "backdrop").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(panel.isOpen()).toBe(false);
  });

  it("replaces the panel when opened twice", () => {
    const { panel } = openPanel();
    const first = host();
    panel.open();
    expect(host()).not.toBe(first);
    expect(document.querySelectorAll('[data-ocvd-ui="settings"]')).toHaveLength(1);
    expect(panel.isOpen()).toBe(true);
  });

  it("destroy closes the panel", () => {
    const { panel } = openPanel();
    panel.destroy();
    expect(panel.isOpen()).toBe(false);
    expect(host()).toBeNull();
  });
});

describe("tabs and draft", () => {
  it("switches between all tabs", () => {
    openPanel();
    openTab("llm");
    expect(root().querySelector('.tab[data-tab="llm"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(textarea("Системная инструкция").value).toBe(DEFAULT_CLEANUP_PROMPT_RU);

    openTab("behavior");
    expect(checkbox("Отправлять сообщения в composer").checked).toBe(true);
    expect(checkbox("Отправлять ответы на вопросы OpenCode").checked).toBe(false);

    openTab("diagnostics");
    expect(root().textContent).toContain("Селекторы OpenCode 2");
    expect(root().textContent).toContain("Хранилище IndexedDB");
  });

  it("resets the content scroll when switching tabs", () => {
    openPanel();
    const content = must(root().querySelector<HTMLElement>(".content"), "content");
    content.scrollTop = 180;
    openTab("llm");
    expect(content.scrollTop).toBe(0);
  });

  it("keeps a stable sheet height and adapts to narrow screens", () => {
    openPanel();
    const css = root().querySelector("style")?.textContent ?? "";
    expect(css).toContain("height: 92dvh");
    expect(css).toContain("height: min(86dvh, 760px)");
    expect(css).not.toContain("max-height: 86dvh");
    expect(css).toContain("@media (max-width: 520px)");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain(".footer-status { flex: 1 1 100%; }");
    expect(css).toContain(".primary-btn { flex: 1 1 100%; min-width: 0; }");
    expect(css).toContain(".select option");
    expect(css).toContain("background: var(--bg);");
    expect(css).toContain("color: var(--fg);");
  });

  it("keeps draft changes when switching tabs", () => {
    openPanel();
    setValue(field("Язык"), "ru");
    openTab("llm");
    openTab("stt");
    expect(input("Язык").value).toBe("ru");
  });

  it("preserves the prompt draft when switching tabs", () => {
    openPanel();
    openTab("llm");
    setValue(textarea("Системная инструкция"), "Мой промпт");
    openTab("behavior");
    openTab("llm");
    expect(textarea("Системная инструкция").value).toBe("Мой промпт");
  });
});

describe("STT tab", () => {
  it("shows only the provider choice and the built-in Groq endpoint", () => {
    openPanel();
    const provider = field("Провайдер");
    expect(provider).toBeInstanceOf(HTMLSelectElement);
    const labels = [...(provider as HTMLSelectElement).options].map((option) => option.textContent);
    expect(labels).toEqual(["Whisper (Groq)", "Custom URL"]);
    expect(root().textContent).toContain(
      "Встроенный Whisper (Groq): https://api.groq.com/openai/v1/audio/transcriptions",
    );
    expect(() => input("Endpoint")).toThrow(/not found/);
    expect(input("Модель").value).toBe("whisper-large-v3-turbo");
  });

  it("switches to Custom URL and keeps the custom values across presets", () => {
    openPanel();
    setValue(field("Провайдер"), "custom");
    expect(input("Endpoint").value).toBe("");
    const endpoint = input("Endpoint");
    const model = input("Модель");
    setValue(endpoint, "https://proxy.example.com/transcribe");
    setValue(model, "my-model");

    setValue(field("Провайдер"), "groq");
    expect(input("Модель").value).toBe("whisper-large-v3-turbo");
    expect(() => input("Endpoint")).toThrow(/not found/);

    setValue(field("Провайдер"), "custom");
    expect(input("Endpoint").value).toBe("https://proxy.example.com/transcribe");
    expect(input("Модель").value).toBe("my-model");
  });

  it("toggles API key visibility", () => {
    openPanel();
    const key = input("API-ключ");
    expect(key.type).toBe("password");
    clickButton("Показать");
    expect(key.type).toBe("text");
    clickButton("Скрыть");
    expect(key.type).toBe("password");
  });

  it("trims values, saves and closes", () => {
    vi.useFakeTimers();
    const { panel, deps } = openPanel();
    setValue(field("Провайдер"), "custom");
    setValue(input("Endpoint"), "  https://proxy.example.com/transcribe  ");
    setValue(input("API-ключ"), "  secret  ");
    setValue(input("Модель"), "  my-model  ");
    setValue(input("Язык"), "  ru  ");
    setValue(input("Temperature"), "0.5");

    clickButton("Сохранить");
    expect(footerStatus()).toBe("Сохранено.");
    expect(deps.saveConfig).toHaveBeenCalledTimes(1);
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
    const saved = deps.saveConfig.mock.calls[0]?.[0] as AppConfig;
    expect(saved.stt.provider).toBe("custom");
    expect(saved.stt.customEndpoint).toBe("https://proxy.example.com/transcribe");
    expect(saved.stt.apiKey).toBe("secret");
    expect(saved.stt.customModel).toBe("my-model");
    expect(saved.stt.language).toBe("ru");
    expect(saved.stt.temperature).toBe(0.5);

    vi.advanceTimersByTime(450);
    expect(panel.isOpen()).toBe(false);
  });

  it("trims and saves the Groq model", () => {
    const { deps } = openPanel();
    setValue(input("Модель"), "  whisper-large-v3  ");
    setValue(input("API-ключ"), "  secret  ");
    clickButton("Сохранить");
    const saved = deps.saveConfig.mock.calls[0]?.[0] as AppConfig;
    expect(saved.stt.provider).toBe("groq");
    expect(saved.stt.groqModel).toBe("whisper-large-v3");
    expect(saved.stt.apiKey).toBe("secret");
  });

  it("shows validation errors and keeps the panel open", () => {
    const { panel, deps } = openPanel();
    setValue(field("Провайдер"), "custom");
    setValue(input("Endpoint"), "not a url");
    setValue(input("Модель"), "");
    clickButton("Сохранить");
    expect(deps.saveConfig).not.toHaveBeenCalled();
    expect(footerStatus()).toContain("STT endpoint");
    expect(footerStatus()).toContain("Укажите модель STT");
    expect(panel.isOpen()).toBe(true);
  });

  it("keeps a blank Groq key as a validation error", () => {
    const { deps } = openPanel();
    setValue(input("API-ключ"), "");
    clickButton("Сохранить");
    expect(deps.saveConfig).not.toHaveBeenCalled();
    expect(footerStatus()).toContain("Укажите API-ключ STT");
  });

  it("reports save failures", () => {
    const deps = makeDeps();
    deps.saveConfig.mockImplementation(() => {
      throw new Error("disk full");
    });
    openPanel(deps);
    clickButton("Сохранить");
    expect(footerStatus()).toBe("Не удалось сохранить: disk full");
    expect(deps.onSaved).not.toHaveBeenCalled();
  });

  it("loads STT models into the datalist and fills an empty model", async () => {
    __setXmlhttpResponder(() =>
      json({
        data: [
          { id: "whisper-large-v3" },
          { id: "whisper-large-v3-turbo" },
          { id: "custom-model" },
        ],
      }),
    );
    openPanel(
      makeDeps(
        validConfig((config) => {
          config.stt.groqModel = "";
        }),
      ),
    );
    clickButton("Загрузить модели");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("Модели загружены: 3.");
    });
    expect(input("Модель").value).toBe("whisper-large-v3-turbo");
    const options = [...root().querySelectorAll<HTMLOptionElement>("datalist option")].map(
      (option) => option.value,
    );
    expect(options).toEqual(["whisper-large-v3-turbo", "whisper-large-v3", "custom-model"]);
    expect(button("Загрузить модели").disabled).toBe(false);
  });

  it("keeps an existing model when loading models", async () => {
    __setXmlhttpResponder(() => json({ data: [{ id: "whisper-large-v3" }] }));
    openPanel();
    clickButton("Загрузить модели");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("Модели загружены: 1.");
    });
    expect(input("Модель").value).toBe("whisper-large-v3-turbo");
  });

  it("warns when the STT provider has no model list", async () => {
    __setXmlhttpResponder(() => ({ status: 404, responseText: "not found" }));
    openPanel();
    clickButton("Загрузить модели");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("не отдаёт список моделей");
    });
  });

  it("shows model loading errors", async () => {
    __setXmlhttpResponder(() => ({ status: 401, responseText: "nope" }));
    openPanel();
    clickButton("Загрузить модели");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("Неверный API-ключ");
    });
  });

  it("tests the STT connection", async () => {
    __setXmlhttpResponder(() => json({ data: [{ id: "whisper-large-v3-turbo" }] }));
    openPanel();
    clickButton("Проверить подключение");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toBe("Подключение работает. Доступно моделей: 1.");
    });
    expect(button("Проверить подключение").disabled).toBe(false);
  });

  it("treats an unsupported model list as a working endpoint", async () => {
    __setXmlhttpResponder(() => ({ status: 405, responseText: "no" }));
    openPanel();
    clickButton("Проверить подключение");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("Endpoint доступен");
    });
  });

  it("reports STT connection errors", async () => {
    __setXmlhttpResponder(() => ({ status: 500, responseText: "down" }));
    openPanel();
    clickButton("Проверить подключение");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("Ошибка загрузки моделей (500)");
    });
  });
});

describe("LLM tab and cleanup prompt", () => {
  it("applies LLM presets", () => {
    openPanel();
    openTab("llm");
    setValue(field("Провайдер"), "ollama-local");
    expect(input("Base URL").value).toBe("http://127.0.0.1:11434");
    expect(input("Модель").value).toBe("deepseek-v4.1-flash");

    setValue(field("Провайдер"), "custom-openai");
    expect(input("Base URL").value).toBe("https://api.openai.com");
    expect(input("Модель").value).toBe("gpt-4o-mini");

    setValue(field("Провайдер"), "ollama-cloud");
    expect(input("Base URL").value).toBe("https://ollama.com");
    expect(input("Модель").value).toBe("deepseek-v4.1-flash");
  });

  it("saves an edited prompt and updates the counter", () => {
    const { deps } = openPanel();
    openTab("llm");
    const prompt = textarea("Системная инструкция");
    expect(prompt.value).toBe(DEFAULT_CLEANUP_PROMPT_RU);
    setValue(prompt, "Мой промпт");
    expect(root().textContent).toContain("Символов: 10");
    clickButton("Сохранить");
    const saved = deps.saveConfig.mock.calls[0]?.[0] as AppConfig;
    expect(saved.llm.prompt).toBe("Мой промпт");
  });

  it("uses the default prompt when the stored prompt is blank", () => {
    openPanel(
      makeDeps(
        validConfig((config) => {
          config.llm.prompt = "   ";
        }),
      ),
    );
    openTab("llm");
    expect(textarea("Системная инструкция").value).toBe(DEFAULT_CLEANUP_PROMPT_RU);
  });

  it("resets the prompt after a second click", () => {
    openPanel(
      makeDeps(
        validConfig((config) => {
          config.llm.prompt = "Мой промпт";
        }),
      ),
    );
    openTab("llm");
    const prompt = textarea("Системная инструкция");
    clickButton("Сбросить к стандартному");
    expect(prompt.value).toBe("Мой промпт");
    expect(button("Нажмите ещё раз для сброса")).not.toBeNull();
    clickButton("Нажмите ещё раз для сброса");
    expect(prompt.value).toBe(DEFAULT_CLEANUP_PROMPT_RU);
    expect(footerStatus()).toContain("Промпт сброшен");
  });

  it("disarms the prompt reset after three seconds", () => {
    vi.useFakeTimers();
    openPanel();
    openTab("llm");
    clickButton("Сбросить к стандартному");
    expect(button("Нажмите ещё раз для сброса")).not.toBeNull();
    vi.advanceTimersByTime(3_000);
    expect(button("Сбросить к стандартному")).not.toBeNull();
  });

  it("loads Ollama and OpenAI-compatible LLM models", async () => {
    __setXmlhttpResponder((details) => {
      if (String(details.url).endsWith("/api/tags")) {
        return json({ models: [{ name: "deepseek-v4.1-flash" }, { name: "llama3" }] });
      }
      return json({ data: [{ id: "gpt-4o-mini" }] });
    });

    openPanel(
      makeDeps(
        validConfig((config) => {
          config.llm.model = "";
        }),
      ),
    );
    openTab("llm");
    clickButton("Загрузить модели");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("Модели загружены: 2.");
    });
    expect(input("Модель").value).toBe("deepseek-v4.1-flash");

    setValue(field("Провайдер"), "custom-openai");
    setValue(input("Модель"), "");
    clickButton("Загрузить модели");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("Модели загружены: 1.");
    });
    expect(input("Модель").value).toBe("gpt-4o-mini");
  });

  it("tests the LLM connection with the sample phrase", async () => {
    __setXmlhttpResponder((details) => {
      if (String(details.url).endsWith("/api/tags")) {
        return json({ models: [{ name: "deepseek-v4.1-flash" }] });
      }
      return json({ message: { content: "Чистый текст." } });
    });

    openPanel();
    openTab("llm");
    clickButton("Проверить подключение");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("Подключение работает. Пример: Чистый текст.");
    });
    const chat = __getRequests().find((request) => request.method === "POST");
    const body = JSON.parse(String(chat?.data)) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[1]?.content).toContain("ээ");
  });

  it("warns when cleanup is disabled during the LLM test", async () => {
    __setXmlhttpResponder(() => json({ models: [{ name: "m" }] }));
    openPanel();
    openTab("llm");
    toggle("Включить очистку LLM", false);
    clickButton("Проверить подключение");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("очистка выключена");
    });
    expect(__getRequests().filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("reports a cleanup fallback during the LLM test", async () => {
    __setXmlhttpResponder((details) => {
      if (String(details.url).endsWith("/api/tags")) {
        return json({ models: [{ name: "m" }] });
      }
      return json({ message: { content: "Извините, я не могу это сделать." } });
    });
    openPanel();
    openTab("llm");
    clickButton("Проверить подключение");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("очистка вернула сырой текст");
    });
    expect(visibleInlineText()).toContain("отказ модели");
  });

  it("reports LLM test errors", async () => {
    __setXmlhttpResponder((details) => {
      if (String(details.url).endsWith("/api/tags")) {
        return json({ models: [{ name: "m" }] });
      }
      return { status: 401, responseText: "nope" };
    });
    openPanel();
    openTab("llm");
    clickButton("Проверить подключение");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("API-ключ LLM");
    });
  });

  it("checks the prompt against the last raw text", async () => {
    __setXmlhttpResponder(() => json({ message: { content: "Очищено." } }));
    const deps = makeDeps();
    deps.getLastRawText = () => "  мой сырой текст  ";
    openPanel(deps);
    openTab("llm");
    clickButton("Проверить на примере");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toBe("Готово. Результат ниже.");
    });
    const result = must(root().querySelector<HTMLElement>(".prompt-result"), "result");
    expect(result.hidden).toBe(false);
    expect(result.textContent).toBe("Очищено.");

    const body = JSON.parse(String(__getRequests()[0]?.data)) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[1]?.content).toBe("мой сырой текст");
  });

  it("uses the built-in sample when there is no last raw text", async () => {
    __setXmlhttpResponder(() => json({ message: { content: "ok" } }));
    openPanel();
    openTab("llm");
    clickButton("Проверить на примере");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toBe("Готово. Результат ниже.");
    });
    const body = JSON.parse(String(__getRequests()[0]?.data)) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[1]?.content).toContain("ээ");
  });

  it("shows a fallback result for the prompt test", async () => {
    __setXmlhttpResponder(() => json({ message: { content: "не могу помочь" } }));
    openPanel();
    openTab("llm");
    clickButton("Проверить на примере");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("LLM вернул сырой текст");
    });
    const result = must(root().querySelector<HTMLElement>(".prompt-result"), "result");
    expect(result.textContent).toContain("тест очистки");
  });

  it("refuses the prompt test while cleanup is disabled", () => {
    openPanel();
    openTab("llm");
    toggle("Включить очистку LLM", false);
    clickButton("Проверить на примере");
    expect(visibleInlineText()).toContain("Очистка выключена");
    expect(__getRequests()).toHaveLength(0);
  });

  it("shows prompt test errors", async () => {
    __setXmlhttpResponder(() => ({ status: 500, responseText: "down" }));
    openPanel();
    openTab("llm");
    clickButton("Проверить на примере");
    await vi.waitFor(() => {
      expect(visibleInlineText()).toContain("LLM временно недоступен");
    });
    const result = must(root().querySelector<HTMLElement>(".prompt-result"), "result");
    expect(result.hidden).toBe(true);
  });
});

describe("behavior tab", () => {
  it("saves every behavior toggle and number", () => {
    const { deps } = openPanel();
    openTab("behavior");
    toggle("Отправлять сообщения в composer", false);
    toggle("Отправлять ответы на вопросы OpenCode", true);
    toggle("При ошибке очистки вставлять сырой текст", false);
    toggle("Сохранять аудио при ошибке STT", false);
    setValue(input("Максимальная длительность записи, сек"), "300");
    setValue(input("Попыток при сетевых ошибках"), "3.6");
    clickButton("Сохранить");

    const saved = deps.saveConfig.mock.calls[0]?.[0] as AppConfig;
    expect(saved.behavior).toEqual({
      autoSubmit: false,
      autoSubmitQuestion: true,
      fallbackToRaw: false,
      saveFailedAudio: false,
      maxRecordingSeconds: 300,
    });
    expect(saved.retry.maxAttempts).toBe(4);
  });

  it("rejects an out-of-range recording duration", () => {
    const { deps } = openPanel();
    openTab("behavior");
    setValue(input("Максимальная длительность записи, сек"), "1");
    clickButton("Сохранить");
    expect(deps.saveConfig).not.toHaveBeenCalled();
    expect(footerStatus()).toContain("от 5 до 600 секунд");
  });

  it("rejects an empty retry count", () => {
    const { deps } = openPanel();
    openTab("behavior");
    setValue(input("Попыток при сетевых ошибках"), "");
    clickButton("Сохранить");
    expect(deps.saveConfig).not.toHaveBeenCalled();
    expect(footerStatus()).toContain("Количество попыток");
  });

  it("lists the interface language options", () => {
    openPanel();
    openTab("behavior");
    const language = field("Язык интерфейса");
    expect(language).toBeInstanceOf(HTMLSelectElement);
    const select = language as HTMLSelectElement;
    expect(select.value).toBe("ru");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Авто (по браузеру)",
      "Русский",
      "English",
    ]);
  });

  it("applies the selected language after saving", () => {
    const { deps } = openPanel();
    openTab("behavior");
    setValue(field("Язык интерфейса"), "en");
    clickButton("Сохранить");
    const saved = deps.saveConfig.mock.calls[0]?.[0] as AppConfig;
    expect(saved.ui.language).toBe("en");
    expect(footerStatus()).toBe("Saved.");
  });

  it("renders English labels after saving the language", () => {
    const deps = makeDeps();
    const { panel } = openPanel(deps);
    openTab("behavior");
    setValue(field("Язык интерфейса"), "en");
    clickButton("Сохранить");
    panel.close();

    openPanel(makeDeps(deps.getConfig()));
    expect(root().querySelector(".title")?.textContent).toBe("Voice input");
    expect(root().querySelector('.tab[data-tab="behavior"]')?.textContent).toBe("Behavior");
  });
});

describe("diagnostics tab", () => {
  it("shows version, page and selector status, and refreshes it", async () => {
    openPanel();
    openTab("diagnostics");
    await vi.waitFor(() => {
      expect(root().textContent).toContain("Сохранённых ошибок нет.");
    });
    expect(root().textContent).toContain("0.9.3");
    expect(root().textContent).toContain("не обнаружена");
    expect(root().textContent).toContain("Composer dock");
    expect(root().textContent).toContain("Микрофон в композере");
    expect(root().textContent).toContain("Микрофон в композере виден");
    expect(root().textContent).toContain("Поле вопроса (актуальное)");
    expect(root().textContent).toContain("Поле вопроса (legacy)");
    expect(root().textContent).toContain("✗ нет");

    addComposer();
    clickButton("Проверить снова");
    expect(footerStatus()).toBe("Селекторы проверены.");
    expect(root().textContent).toContain("✓ есть");
  });

  it("detects an OpenCode page with a composer", () => {
    addComposer();
    openPanel();
    openTab("diagnostics");
    expect(root().textContent).toContain("Страница OpenCode");
    expect(root().textContent).toContain("да");
  });

  it("renders storage estimates", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 5 * 1024 * 1024, quota: 200 * 1024 * 1024 }),
        persisted: async () => true,
      },
    });
    openPanel();
    openTab("diagnostics");
    await vi.waitFor(() => {
      expect(root().textContent).toContain("Постоянное хранение");
    });
    expect(root().textContent).toContain("5.0 МБ");
    expect(root().textContent).toContain("200 МБ");
    expect(root().textContent).toContain("да");
  });

  it("shows dashes when storage estimates are unavailable", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => {
          throw new Error("denied");
        },
        persisted: async () => {
          throw new Error("denied");
        },
      },
    });
    openPanel();
    openTab("diagnostics");
    await vi.waitFor(() => {
      expect(root().textContent).toContain("Постоянное хранение");
    });
    expect(root().textContent).toContain("—");
  });

  it("lists the latest failure and clears the store", async () => {
    await saveFailure(failure({ error: "Ошибка распознавания" }));
    openPanel();
    openTab("diagnostics");
    await vi.waitFor(() => {
      expect(root().textContent).toContain("Записей");
    });
    expect(root().textContent).toContain("Последняя стадия");
    expect(root().textContent).toContain("распознавание");
    expect(root().textContent).toContain("Ошибка распознавания");

    clickButton("Очистить сохранённые ошибки");
    await vi.waitFor(() => {
      expect(root().textContent).toContain("Сохранённых ошибок нет.");
    });
    expect(footerStatus()).toBe("Сохранённые ошибки очищены.");
  });

  it("prefers the onClearFailures callback", async () => {
    const deps = makeDeps();
    deps.onClearFailures = vi.fn(async () => {
      await clearFailures();
    });
    await saveFailure(failure());
    openPanel(deps);
    openTab("diagnostics");
    await vi.waitFor(() => {
      expect(root().textContent).toContain("Записей");
    });
    clickButton("Очистить сохранённые ошибки");
    await vi.waitFor(() => {
      expect(deps.onClearFailures).toHaveBeenCalledTimes(1);
      expect(footerStatus()).toBe("Сохранённые ошибки очищены.");
    });
  });

  it("reports clear failures", async () => {
    const deps = makeDeps();
    deps.onClearFailures = vi.fn(async () => {
      throw new Error("locked");
    });
    await saveFailure(failure());
    openPanel(deps);
    openTab("diagnostics");
    await vi.waitFor(() => {
      expect(root().textContent).toContain("Записей");
    });
    clickButton("Очистить сохранённые ошибки");
    await vi.waitFor(() => {
      expect(footerStatus()).toBe("Не удалось очистить: locked");
    });
  });

  it("uses the fallback error text for a failure without details", async () => {
    await saveFailure(failure({ error: "" }));
    openPanel();
    openTab("diagnostics");
    await vi.waitFor(() => {
      expect(root().textContent).toContain("Без описания");
    });
  });

  it("truncates long failure errors", async () => {
    await saveFailure(failure({ error: "x".repeat(500) }));
    openPanel();
    openTab("diagnostics");
    await vi.waitFor(() => {
      expect(root().querySelector(".diag-error")).not.toBeNull();
    });
    const errorNode = must(root().querySelector<HTMLElement>(".diag-error"), "diag error");
    expect(errorNode.textContent?.length).toBe(320);
    expect(errorNode.textContent?.endsWith("…")).toBe(true);
  });
});
