---
module: src
purpose: Исходники userscript — UI OpenCode 2, аудио, STT, очистка LLM, пайплайн, i18n и восстановление
key_files:
  - src/index.ts — bootstrap userscript
  - src/pipeline.ts — state machine диктовки, защита сессии и черновика
  - src/i18n.ts — словари RU/EN и текущая локаль
  - src/config.ts — конфиг v2, пресеты, миграция 1.x
  - src/insert.ts — селекторы OpenCode 2, вставка, отправка, снимок черновика
  - src/ui.ts — кнопки микрофона/настроек, mobile CSS, компактная плашка, heartbeat, тосты, recovery-баннер
  - src/settings-panel.ts — мобильная панель настроек (Shadow DOM), адаптивные вкладки
  - src/http.ts — GM_xmlhttpRequest, retry/backoff
  - src/transcribe.ts — STT-провайдеры и классификация 403
  - src/llm.ts — очистка текста через LLM
  - src/models.ts — загрузка списков моделей
  - src/storage.ts — IndexedDB для неудачных записей
  - src/audio.ts — MediaRecorder
  - src/keyboard.ts — Ctrl+Space / Escape
  - src/types.ts — общие типы
dependencies: []
last_updated: 2026-10-21
---

# src/

## Structure

- `index.ts` — bootstrap: `isOpencodePage()` gate, `waitForOpencode()`, `initI18n()`, регистрация меню, создание панели настроек, UI, keyboard, `pipeline.recover()`, первый запуск без ключа/endpoint-а.
- `i18n.ts` — словари `ru`/`en` с одинаковым `MessageKey`, `t`, `translate`, `resolveLocale` (`auto` → RU для `ru*`, иначе EN), `initI18n`/`setLocale`/`getLocale`/`resetI18n`, `MESSAGE_KEYS`.
- `pipeline.ts` — state machine `idle → recording → stt → llm → insert → submit`; `toggle`, `cancel`, `retryLast`, `recover`, `forget`. Зависимости (recorder, transcribe, cleanup, insert, submit, storage, UI) инжектируются через `createPipeline`. `start()` запоминает `originPath` и снимок черновика; `sessionChanged()` проверяется перед вставкой, отправкой и аварийной вставкой сырого текста; изменённый черновик отменяет автоотправку, но не вставку. Если submit-кнопка недоступна (`isSubmitBusy()`), текст остаётся в композере, а пайплайн завершается тостом «Агент ещё работает» без ошибки и recovery. Recovery-баннер переиспользуется для сохранённого текста.
- `config.ts` — `ocvd.config.v2` (одна JSON-строка), `createDefaultConfig(locale)`, `loadConfig`/`saveConfig`, `normalizeConfig`, `validateConfig(config, locale)`, пресеты `STT_PRESETS` (`groq`/`custom`) и `LLM_PRESETS`, `DEFAULT_CLEANUP_PROMPT_RU`/`_EN`, `LEGACY_OPENAI_STT`, миграция 1.x, `resolveSttEndpoint`/`resolveSttModel`, `applySttPreset`, 4 menu commands.
- `types.ts` — `AppConfig` (`ui`, `stt`, `llm`, `behavior`, `retry`), `Locale`/`LocalePreference`, `FailedDictation`, `CleanupResult`, `SelectorStatus`.
- `http.ts` — обёртка `GM_xmlhttpRequest`: `httpRequest`, `withRetry`, `HttpError`, `AbortError`, `Retry-After`, таймауты.
- `transcribe.ts` — `groq` (встроенный Whisper: endpoint из `STT_PRESETS`, модель из `groqModel`) и `custom` (`customEndpoint`/`customModel`); FormData, `response_format` (`text` для groq, `json` для custom), повтор без optional-полей на `400`, `isSttRegionBlock()` и `formatSttError()`.
- `llm.ts` — Ollama native `/api/chat` (`think`) и OpenAI-compatible `/v1/chat/completions` (`reasoning_effort`); `validateCleanup` с fallback на сырой текст.
- `models.ts` — `listSttModels`/`listLlmModels`: Ollama `/api/tags`, OpenAI `/v1/models`, обработка 404/405; для 403 использует общую классификацию региона.
- `storage.ts` — IndexedDB `opencode-voice-dictation` / `failures`; аудио как `ArrayBuffer`; prune (5 записей, 7 дней), quota handling, `requestPersistence`.
- `insert.ts` — `SELECTORS` OpenCode 2, legacy fallback, `resolveTarget`, `insertText`/`replaceText`, `submitPrompt`, `submitQuestion`, `getSelectorStatus`, `rememberDraft`/`isDraftChanged`. `findComposerEditor()` предпочитает видимый editor в dock, затем последний видимый editor в документе; `findComposerActions()` идёт от выбранного editor/form → actions в форме → строка submit → actions в dock → последний видимый глобальный actions вне question dock → глобальная строка submit. `submitComposer()` не отправляет Enter при `disabled`/`aria-disabled` submit и возвращает `false`; `isComposerSubmitBusy()` сообщает то же состояние пайплайну. Актуальное поле вопроса — `input[data-slot="text-input-v2-input"]` в `[data-slot="question-option"][data-custom="true"]`, legacy — `textarea[data-slot="question-custom-input"]`; элементы вопроса ищутся в последнем видимом `session-question-dock`, чтобы скрытый старый dock не перехватывал кнопку; отправка вопроса — последняя включённая кнопка `[data-slot="question-footer-actions"]`.
- `ui.ts` — идемпотентная инъекция mic/gear в `composer-actions` (или fallback-ряд) и контейнеры вопроса (header actions → футер → custom option → legacy form; шапка приоритетна, потому что футер обрезается снизу); если строка действий невидима, за экраном или перекрыта, кнопки уходят в fallback внутри видимого dock либо в fixed-панель на `documentElement`, а при восстановлении строки возвращаются в неё; повторная попытка для видимой, но тесной строки — через 15 с или при изменении геометрии; во время открытого вопроса composer-fallback не создаётся. Phone-only mobile CSS (`@media (max-width: 767px) and (pointer: coarse) and (hover: none)`); компактная плашка записи с точкой, таймером, стопом и отменой; микрофон остаётся микрофоном с пульсирующей красной точкой; heartbeat раз в секунду при видимой вкладке; тост, recovery-баннер, Shadow DOM hosts.
- `settings-panel.ts` — bottom sheet с вкладками STT / Очистка / Поведение / Диагностика; фиксированная высота, сброс прокрутки при смене вкладки, сетка вкладок 2×2 на узком экране, перенос строк и полноширинные кнопки; провайдер STT (`Whisper (Groq)` / `Custom URL`), язык интерфейса, загрузка моделей, проверки подключения, редактируемый промпт; явные цвета `option` для читаемого списка провайдеров.
- `audio.ts` — `MediaRecorder`, MIME webm/opus → webm → mp4, `stop` с 3-секундным таймаутом, `cancel`.
- `keyboard.ts` — `Ctrl+Space` toggle, `Escape` cancel; игнорирует `repeat`/`isComposing`, не срабатывает при открытой панели.

## Patterns

- Все пользовательские строки — через `t()` (`i18n.ts`); RU и EN словари обязаны содержать одинаковый набор ключей.
- Все DOM-селекторы OpenCode 2 собраны в `SELECTORS` (`insert.ts`); `LEGACY_SELECTORS` — только fallback для ранних 2.0.x.
- Композер может не иметь `session-composer-dock` (наблюдалось на Firefox Android); поэтому действия ищутся через выбранный editor/form, затем через dock и глобальный actions slot, а при их отсутствии mic/gear рендерятся fallback-панелью.
- Вставка в contenteditable — `execCommand("insertText")` с fallback через `beforeinput`/`input`; в `input`/`textarea` — native setter + `InputEvent`.
- Отправка композера — проверка `disabled`/`aria-disabled` submit, затем синтетический Enter, fallback — клик `[data-action="composer-submit"]`. Вопрос: в актуальном DOM — клик по последней включённой кнопке футера (Enter только коммитит кастомное поле); в legacy — Enter → `form.requestSubmit()`.
- UI перерисовывается SolidJS, поэтому инъекция проверяет `isConnected`, помечает элементы `data-ocvd`, повторяется через MutationObserver и heartbeat; удаление только нашей кнопки тоже планирует повторную инъекцию. Кнопки не остаются в скрытой/перекрытой строке: они переезжают в видимый fallback и возвращаются, когда `isVisibleNode`/`isOnScreen`/`isHittable` снова проходят.
- Mobile CSS не использует `position: sticky`: на узких экранах сжимается название модели (`flex: 1 1 0`), остальные элементы ряда сохраняют размер. Desktop не затрагивается.
- Кастомный STT-endpoint не теряется: legacy `endpoint`/`model` мигрируют в `customEndpoint`/`customModel` при `provider: "custom"`, а `applySttPreset` не очищает custom-поля при переключении на Groq.
- 403 классифицируется как ключ → регион → общий forbidden; прокси с неверным ключом не получает ложное сообщение о регионе.
- Сетевые ошибки проходят через `withRetry`; ключи и тела запросов не логируются.
- Пайплайн не зависит от DOM и тестируется с fake-зависимостями.
- Перед вставкой и отправкой пайплайн сверяет `originPath` с текущим путём страницы (`pathname + search`); при смене сессии текст сохраняется и показывается в recovery-баннере, а не уходит в чужой чат.
- Снимок черновика (`rememberDraft`) сравнивается перед вставкой (`isDraftChanged`): изменённый черновик отменяет только автоотправку, текст всё равно вставляется.
- После успешной вставки `rawInserted = true`, поэтому повторное восстановление предлагает отправку, а не повторную вставку.
- Пока агент работает, композер остаётся доступным: mic/gear не исчезают, а новая диктовка ставит сообщение в очередь OpenCode. Если submit всё же заблокирован, текст остаётся в поле и показывается информационный тост.
