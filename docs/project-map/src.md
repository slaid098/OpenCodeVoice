---
module: src
purpose: Исходники userscript — UI OpenCode 2, аудио, STT, очистка LLM, пайплайн и восстановление
key_files:
  - src/index.ts — bootstrap userscript
  - src/pipeline.ts — state machine диктовки
  - src/config.ts — конфиг v2, пресеты, миграция 1.x
  - src/insert.ts — селекторы OpenCode 2, вставка и отправка
  - src/ui.ts — кнопки микрофона/настроек, тосты, recovery-баннер
  - src/settings-panel.ts — мобильная панель настроек (Shadow DOM)
  - src/http.ts — GM_xmlhttpRequest, retry/backoff
  - src/transcribe.ts — STT-провайдеры
  - src/llm.ts — очистка текста через LLM
  - src/models.ts — загрузка списков моделей
  - src/storage.ts — IndexedDB для неудачных записей
  - src/audio.ts — MediaRecorder
  - src/keyboard.ts — Ctrl+Space / Escape
  - src/types.ts — общие типы
dependencies: []
last_updated: 2026-10-20
---

# src/

## Structure

- `index.ts` — bootstrap: `isOpencodePage()` gate, `waitForOpencode()`, регистрация меню, создание панели настроек, UI, keyboard, `pipeline.recover()`, первый запуск без ключа.
- `pipeline.ts` — state machine `idle → recording → stt → llm → insert → submit`; `toggle`, `cancel`, `retryLast`, `recover`, `forget`. Зависимости (recorder, transcribe, cleanup, insert, submit, storage, UI) инжектируются через `createPipeline`.
- `config.ts` — `ocvd.config.v2` (одна JSON-строка), `createDefaultConfig`, `loadConfig`/`saveConfig`, `normalizeConfig`, `validateConfig`, пресеты `STT_PRESETS`/`LLM_PRESETS`, `DEFAULT_CLEANUP_PROMPT`, миграция 1.x, 4 menu commands.
- `types.ts` — `AppConfig` (`stt`, `llm`, `behavior`, `retry`), `FailedDictation`, `CleanupResult`, `SelectorStatus`.
- `http.ts` — обёртка `GM_xmlhttpRequest`: `httpRequest`, `withRetry`, `HttpError`, `AbortError`, `Retry-After`, таймауты.
- `transcribe.ts` — Groq/OpenAI/Custom STT, FormData, `response_format` (`text` для Whisper, `json` для custom/gpt-4o), повтор без optional-полей на `400`.
- `llm.ts` — Ollama native `/api/chat` (`think`) и OpenAI-compatible `/v1/chat/completions` (`reasoning_effort`); `validateCleanup` с fallback на сырой текст.
- `models.ts` — `listSttModels`/`listLlmModels`: Ollama `/api/tags`, OpenAI `/v1/models`, обработка 404/405.
- `storage.ts` — IndexedDB `opencode-voice-dictation` / `failures`; аудио как `ArrayBuffer`; prune (5 записей, 7 дней), quota handling, `requestPersistence`.
- `insert.ts` — `SELECTORS` OpenCode 2, legacy fallback, `resolveTarget`, `insertText`/`replaceText`, `submitPrompt`, `getSelectorStatus`; `findComposerActions` ищет dock → `composer-actions` → `form[data-component="composer"]` → родителя `composer-submit` → глобальный видимый slot.
- `ui.ts` — идемпотентная инъекция mic/gear в `composer-actions` (или в найденный fallback-ряд) и `question-footer-actions`; если ряда нет — плавающая кнопка над формой композера; таймер, тост, recovery-баннер, Shadow DOM hosts.
- `settings-panel.ts` — bottom sheet с вкладками STT / Очистка / Поведение / Диагностика; загрузка моделей, проверки подключения, редактируемый промпт.
- `audio.ts` — `MediaRecorder`, MIME webm/opus → webm → mp4, `stop` с 3-секундным таймаутом, `cancel`.
- `keyboard.ts` — `Ctrl+Space` toggle, `Escape` cancel; игнорирует `repeat`/`isComposing`, не срабатывает при открытой панели.

## Patterns

- Все DOM-селекторы OpenCode 2 собраны в `SELECTORS` (`insert.ts`); `LEGACY_SELECTORS` — только fallback для ранних 2.0.x.
- Композер может не иметь `session-composer-dock` (наблюдалось на Firefox Android); поэтому действия ищутся по форме и родителю submit, а при их отсутствии mic/gear рендерятся плавающей кнопкой.
- Вставка в contenteditable — `execCommand("insertText")` с fallback через `beforeinput`/`input`; в textarea — native setter + `InputEvent`.
- Отправка композера — синтетический Enter, fallback — клик `[data-action="composer-submit"]`.
- UI перерисовывается SolidJS, поэтому инъекция проверяет `isConnected`, помечает элементы `data-ocvd` и повторяется через MutationObserver.
- Сетевые ошибки проходят через `withRetry`; ключи и тела запросов не логируются.
- Пайплайн не зависит от DOM и тестируется с fake-зависимостями.
