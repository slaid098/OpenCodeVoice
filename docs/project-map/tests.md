---
module: tests
purpose: Unit- и интеграционные тесты (vitest) + моки GM API
key_files:
  - tests/setup.ts — общий setup (fake-indexeddb, очистка DOM и GM store)
  - tests/__mocks__/$/index.ts — моки GM_*
  - tests/pipeline.test.ts — state machine и восстановление
  - tests/settings-panel.test.ts — панель настроек
  - tests/insert.test.ts — вставка и отправка в OpenCode 2
  - tests/ui.test.ts — инъекция кнопок
dependencies: [src]
last_updated: 2026-10-20
---

# tests/

## Structure

- `__mocks__/$/index.ts` — моки `GM_getValue`/`GM_setValue`/`GM_registerMenuCommand`/`GM_info`/`GM_xmlhttpRequest` (abort, timeout, delay, responders, inspection helpers).
- `setup.ts` — `fake-indexeddb/auto`, сброс GM store, DOM, стилей, UI hosts и локали после каждого теста.
- `audio.test.ts` — MediaRecorder, MIME, stop/timeout/empty/error, cancel, permission errors.
- `config.test.ts` — defaults, пресеты `groq`/`custom`, load/save/normalize, битый JSON, миграция 1.x, сохранение `customEndpoint`/`customModel`, валидация RU/EN, menu commands.
- `http.test.ts` — retry/backoff, retryable statuses, `Retry-After`, abort, таймауты.
- `i18n.test.ts` — `resolveLocale` (auto/ru/en, navigator), подстановки, текущая локаль, полнота RU/EN словарей, отсутствие кириллицы в EN.
- `insert.test.ts` — v2 editor, Enter submit, fallback `composer-submit`, актуальное поле вопроса (`input[data-slot="text-input-v2-input"]`), legacy `textarea`, клик по последней кнопке футера, `requestSubmit`.
- `keyboard.test.ts` — Ctrl+Space/Escape, модификаторы, repeat, composition, открытые настройки.
- `llm.test.ts` — Ollama/OpenAI протоколы, `think`/`reasoning_effort`, fallback на `400`, sanitize/validate, refusal/too-long.
- `models.test.ts` — `/api/tags`, `/v1/models`, нормализация base URL, auth, 404/405, региональная блокировка 403.
- `pipeline.test.ts` — happy path, ошибки STT/LLM/insert/submit, cancel, retryLast, recover, отсутствие дублирования.
- `settings-panel.test.ts` — Shadow DOM, вкладки, сохранение, провайдеры Whisper/Custom URL, язык интерфейса, модели, проверки подключения, промпт, диагностика, ошибки.
- `storage.test.ts` — IndexedDB CRUD, ArrayBuffer↔Blob, prune, quota, persistence.
- `transcribe.test.ts` — FormData, `response_format`, парсинг text/JSON, пустой ответ, 400 fallback, 429 retry, классификация 401/403/451 и регион.
- `ui.test.ts` — инъекция mic/gear в composer/question, футер/header/custom option, удаление кнопки и повторная инъекция, mobile CSS, aria после смены языка.

## Patterns

- `vitest run`; 13 файлов, 405 тестов.
- GM API мокируются через vitest alias на `tests/__mocks__/$/index.ts`.
- IndexedDB — `fake-indexeddb/auto`, без реального браузера.
- DOM — `happy-dom`; UI тестируется через публичный `setupUI`/`createUi` и side-effect в DOM.
- Coverage thresholds — 70% (statements/branches/functions/lines); исключены `src/index.ts`, `src/types.ts`, конфиги.
