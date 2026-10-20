import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MESSAGE_KEYS,
  getLocale,
  initI18n,
  resetI18n,
  resolveLocale,
  setLocale,
  t,
  translate,
} from "../src/i18n.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveLocale", () => {
  it("honors an explicit preference", () => {
    expect(resolveLocale("ru", ["en-US"])).toBe("ru");
    expect(resolveLocale("en", ["ru-RU"])).toBe("en");
  });

  it("picks Russian only for Russian browser languages", () => {
    expect(resolveLocale("auto", ["ru-RU", "en-US"])).toBe("ru");
    expect(resolveLocale("auto", ["ru"])).toBe("ru");
    expect(resolveLocale("auto", ["en-US", "ru-RU"])).toBe("en");
    expect(resolveLocale("auto", ["be-BY"])).toBe("en");
    expect(resolveLocale("auto", ["de"])).toBe("en");
  });

  it("skips blank entries and falls back to the first real language", () => {
    expect(resolveLocale("auto", [" ", "ru-RU"])).toBe("ru");
    expect(resolveLocale("auto", [""])).toBe("ru");
    expect(resolveLocale("auto", [])).toBe("ru");
  });

  it("reads navigator.languages and then navigator.language", () => {
    vi.stubGlobal("navigator", { languages: ["ru-RU", "en-US"], language: "ru-RU" });
    expect(resolveLocale("auto")).toBe("ru");

    vi.stubGlobal("navigator", { languages: [], language: "en-GB" });
    expect(resolveLocale("auto")).toBe("en");

    vi.stubGlobal("navigator", undefined);
    expect(resolveLocale("auto")).toBe("ru");
  });
});

describe("translate", () => {
  it("substitutes named parameters", () => {
    expect(translate("ru", "settings.subtitle", { version: "0.9.3" })).toBe("OpenCode 2 · v0.9.3");
    expect(
      translate("en", "pipeline.retryIn", {
        label: "STT",
        attempt: 2,
        max: 3,
        seconds: 1.5,
      }),
    ).toBe("Retrying STT (2/3) in 1.5 s…");
    expect(translate("ru", "stt.network", { message: "таймаут" })).toBe(
      "Не удалось связаться со STT: таймаут",
    );
  });

  it("keeps placeholders when no parameters are passed", () => {
    expect(translate("ru", "stt.httpError")).toContain("{status}");
    expect(translate("ru", "common.save", { unused: "x" })).toBe("Сохранить");
  });
});

describe("current locale", () => {
  it("is Russian by default and switches with setLocale", () => {
    expect(getLocale()).toBe("ru");
    expect(t("common.save")).toBe("Сохранить");

    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("common.save")).toBe("Save");

    resetI18n();
    expect(getLocale()).toBe("ru");
    expect(t("common.save")).toBe("Сохранить");
  });

  it("initI18n resolves the auto preference", () => {
    initI18n("en");
    expect(getLocale()).toBe("en");

    initI18n("ru");
    expect(getLocale()).toBe("ru");
  });
});

describe("dictionaries", () => {
  it("define every key in both languages", () => {
    for (const key of MESSAGE_KEYS) {
      expect(typeof translate("ru", key), key).toBe("string");
      expect(typeof translate("en", key), key).toBe("string");
      expect(translate("ru", key).trim(), key).not.toBe("");
      expect(translate("en", key).trim(), key).not.toBe("");
    }
    expect(MESSAGE_KEYS.length).toBeGreaterThan(150);
    expect(new Set(MESSAGE_KEYS).size).toBe(MESSAGE_KEYS.length);
  });

  it("has no Cyrillic in English strings", () => {
    const cyrillic = /[Ѐ-ӿ]/;
    for (const key of MESSAGE_KEYS) {
      // The Russian cleanup sample is intentionally Russian in both dictionaries.
      if (key === "settings.sample.ru") {
        continue;
      }
      expect(cyrillic.test(translate("en", key)), key).toBe(false);
    }
  });
});
