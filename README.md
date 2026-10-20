# 🚀 opencode-voice-dictation
![Cover](assets/cover.png)
<!-- tagline-en:start -->
> Voice dictation for OpenCode 2 web — Whisper STT, LLM cleanup, auto-submit, recovery
<!-- tagline-en:end -->
<!-- tagline-ru:start -->
> Голосовой ввод для OpenCode 2 web — Whisper, очистка LLM, автоотправка, восстановление
<!-- tagline-ru:end -->

[English](#-english) | [Русский](#-русский)

---

## 🇺🇸 English

<!-- summary-en:start -->
### ❓ Why
Dictating to agents from a phone is much faster than typing on a small screen. Stock Android voice input does not know OpenCode's composer, and OpenCode web has no built-in microphone.

### ✅ What
A Tampermonkey/Violentmonkey userscript for the OpenCode 2 web UI. One tap records speech, Whisper transcribes it, an LLM removes filler words and profanity, fixes punctuation, and the result is inserted into the composer or question prompt and optionally submitted. Failed recordings are kept in IndexedDB and can be retried right in the page.
<!-- summary-en:end -->

<!-- features-en:start -->
### Features

| Feature | Description |
|---------|-------------|
| 🎤 Mic in composer | Records from the composer; the transcript is inserted at the caret |
| ❓ Mic in question prompts | Dictate answers to OpenCode questions; the form is not submitted by the mic button |
| 🧠 Whisper STT | Groq `whisper-large-v3-turbo` by default (fast, fewer hallucinations), `whisper-large-v3` fallback; OpenAI and custom OpenAI-compatible endpoints |
| ✨ LLM cleanup | Editable Russian prompt: removes filler words and profanity, fixes punctuation, preserves meaning; Ollama Cloud (`deepseek-v4.1-flash`, reasoning off), Ollama Local, custom OpenAI-compatible |
| 📝 Editable prompt | The cleanup prompt is edited in the settings panel, survives updates, and can be reset to the default |
| ⚡ Auto-submit | Separate toggles for the composer and for question prompts |
| 🔁 Retry and recovery | Automatic retries with backoff; a recovery banner offers "Retry", "Insert raw text", and "Delete" right in the UI |
| 💾 No lost recordings | Audio and text are saved in IndexedDB on failure and restored after a page reload |
| 🌍 Language | Auto-detect, Russian, English, or any Whisper language code |
| 📱 Mobile-first | Large touch targets, safe-area padding, bottom-sheet settings; works in Android Firefox and Kiwi |
| 🔄 Auto-update | Updates via `@updateURL` from the `dist` branch |
| ⌨️ Ctrl+Space / Esc | Desktop hotkeys to start/stop and cancel |
<!-- features-en:end -->

### Requirements

- **OpenCode 2.0.25+** web UI (recommended: 2.0.32). OpenCode 1.x uses a different DOM and is not supported.
- A userscript manager: Tampermonkey or Violentmonkey.
- An STT API key (Groq by default) and, optionally, an LLM API key.
- Microphone access. Browsers only allow it on `https://` or `localhost`, so use a Cloudflare Tunnel (or another HTTPS reverse proxy) when connecting from a phone.

### Quick Start

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Android: Firefox or Kiwi Browser).
2. Get a key at [console.groq.com/keys](https://console.groq.com/keys). For LLM cleanup, get an Ollama Cloud key at [ollama.com](https://ollama.com) (optional — cleanup can be disabled).
3. Open the [script install link](https://git.slaid098.dev/slaid098/opencode-voice-dictation/raw/branch/dist/opencode-voice-dictation.user.js) — it installs into Tampermonkey.
4. Open your OpenCode web UI. On the first run the settings panel opens automatically: paste the STT key and, if needed, the LLM key, then save.
5. Tap the mic button in the composer, speak, and tap it again. The cleaned text is inserted and, with auto-submit enabled, sent.

### How it works

```text
mic -> MediaRecorder (webm/opus) -> Whisper STT -> raw transcript
    -> LLM cleanup (optional) -> insert into composer/question -> auto-submit
```

- The default STT model is `whisper-large-v3-turbo`: it is fast and hallucinates less than `whisper-large-v3` on silence. Switch to `whisper-large-v3` in the settings if you need maximum accuracy.
- The default cleanup model is `deepseek-v4.1-flash` via Ollama Cloud with reasoning disabled. Any Ollama or OpenAI-compatible endpoint can be used instead.
- If cleanup fails, the raw transcript is inserted (controlled by "Insert raw text if cleanup fails"), so dictation never blocks on the LLM.
- If STT fails, the audio is stored in IndexedDB and a recovery banner appears. You can retry immediately or after a page reload.

### Settings

Open the gear button next to the microphone or the Tampermonkey menu → **Настройки голосового ввода** (Settings). The panel has four tabs:

- **STT** — provider preset (Groq / OpenAI / Custom), endpoint, API key, model (with "Load models"), language, prompt, temperature, "Test connection".
- **Cleanup** — enable/disable, provider (Ollama Cloud / Ollama Local / Custom OpenAI-compatible), Base URL, API key, model, reasoning, connection test, and the editable cleanup prompt with a character counter and "Reset to default".
- **Behavior** — auto-submit composer, auto-submit question answers, fallback to raw text, save failed audio, maximum recording length, retry attempts and delays.
- **Diagnostics** — userscript version, status of the OpenCode 2 selectors, IndexedDB usage, the last error, and saved failed recordings.

The cleanup prompt is stored in the userscript's GM storage. Updating the script does not overwrite your edits; the default is applied only on first run or after "Reset to default". The dictation text is sent as a separate user message, so there is no need to add a placeholder to the prompt.

### Reliability

- Retries are automatic for network errors, timeouts, `408`, `425`, `429`, and `5xx` (3 attempts with exponential backoff and jitter by default). `400`, `401`, `403`, and `404` are not retried — they need a settings fix.
- `Retry-After` from the server is respected.
- The recording is saved **before** STT starts. STT, cleanup, insert, and submit failures each produce a recovery banner with actions appropriate to the failed stage.
- Repeating an insert after an error replaces the previously inserted text instead of duplicating it.
- Only the last five failed recordings (up to seven days old) are kept; the store is pruned automatically.

### Privacy and security

- Audio is sent to the configured STT provider; the transcript is sent to the configured LLM provider. Nothing else leaves the browser.
- API keys are stored in userscript manager storage (GM storage). They are **not encrypted at rest** — anyone with access to the browser profile can read them. Use keys with minimal scope and rotate them if the device is shared.
- The script never logs keys or request bodies. Error messages redact credentials.
- The mic only works in a secure context; use HTTPS for remote access.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| Mic button does not appear | Make sure the page is OpenCode 2.0.25+. Open Diagnostics and check the selector status. Reload the page. |
| `401` from STT or LLM | Re-enter the API key in the settings; check that the provider preset matches the key. |
| `429` / "Too many requests" | Wait; the script retries automatically. Consider a different model or provider. |
| "Empty transcription" | The recording was silent or too short. Record again; the previous audio is kept if saving is enabled. |
| Microphone permission denied | Allow the microphone for the site in browser settings. On Android, microphone access requires HTTPS. |
| Text is inserted into the wrong place | The question prompt may have closed; the script falls back to the composer. Check the target in Diagnostics. |
| Auto-submit does nothing | OpenCode's submit button may have changed. The script presses Enter first and falls back to `[data-action="composer-submit"]`. Check Diagnostics and update the script. |
| Wrong language | Clear the Whisper prompt (STT tab) or set the language explicitly. An English prompt biases the model toward English. |

### Updating from 1.x

The 2.0.0 script keeps the same `@name` and `@namespace`, so Tampermonkey updates it in place. On first load the legacy 1.x settings (Groq key, model, language, Whisper prompt, temperature, auto-submit) are migrated into the new config automatically. The old menu commands are replaced by the settings panel; the new menu contains Settings, Toggle auto-submit, Retry last dictation, and Clear saved failures.

Version 2.0.0 targets the OpenCode 2 DOM only. If you still run OpenCode 1.x, stay on the 1.0.7 release.

---

## 🇷🇺 Русский

<!-- summary-ru:start -->
### ❓ Зачем
Диктовать агенту с телефона намного быстрее, чем печатать на маленьком экране. Стандартный голосовой ввод Android не знает про композер OpenCode, а в OpenCode web нет встроенного микрофона.

### ✅ Что
Userscript для Tampermonkey/Violentmonkey под веб-интерфейс OpenCode 2. Одно нажатие записывает речь, Whisper расшифровывает её, LLM убирает слова-паразиты и мат, исправляет пунктуацию, после чего текст вставляется в композер или в вопрос и при желании отправляется. Неудачные записи сохраняются в IndexedDB и повторяются прямо на странице.
<!-- summary-ru:end -->

<!-- features-ru:start -->
### Фичи

| Фича | Описание |
|------|----------|
| 🎤 Микрофон в композере | Запись из поля ввода; текст вставляется в позицию курсора |
| ❓ Микрофон в вопросах | Диктовка ответов на вопросы OpenCode; кнопка микрофона не отправляет форму |
| 🧠 Whisper STT | По умолчанию Groq `whisper-large-v3-turbo` (быстрая, меньше галлюцинаций), fallback — `whisper-large-v3`; OpenAI и кастомные OpenAI-совместимые endpoint-ы |
| ✨ Очистка LLM | Редактируемый русский промпт: убирает паразиты и мат, исправляет пунктуацию, сохраняет смысл; Ollama Cloud (`deepseek-v4.1-flash`, reasoning выключен), Ollama Local, кастомный OpenAI-совместимый |
| 📝 Редактируемый промпт | Промпт очистки правится в панели настроек, переживает обновления и сбрасывается к стандартному |
| ⚡ Автоотправка | Отдельные переключатели для композера и для ответов на вопросы |
| 🔁 Повтор и восстановление | Автоматические retry с backoff; баннер восстановления с кнопками «Повторить», «Вставить сырой текст» и «Удалить» прямо в интерфейсе |
| 💾 Запись не теряется | Аудио и текст сохраняются в IndexedDB при ошибке и восстанавливаются после перезагрузки |
| 🌍 Язык | Автоопределение, русский, английский или любой код языка Whisper |
| 📱 Мобильный интерфейс | Крупные кнопки, safe-area, настройки в виде bottom sheet; работает в Android Firefox и Kiwi |
| 🔄 Автообновление | Обновляется через `@updateURL` из ветки `dist` |
| ⌨️ Ctrl+Space / Esc | Горячие клавиши на десктопе: старт/стоп и отмена |
<!-- features-ru:end -->

### Требования

- **OpenCode 2.0.25+** (рекомендуется 2.0.32). В OpenCode 1.x другой DOM — он не поддерживается.
- Userscript-менеджер: Tampermonkey или Violentmonkey.
- API-ключ STT (по умолчанию Groq) и, опционально, ключ LLM.
- Доступ к микрофону. Браузеры разрешают его только на `https://` или `localhost`, поэтому с телефона нужен HTTPS — например, Cloudflare Tunnel или другой reverse proxy.

### Быстрый старт

1. Установи [Tampermonkey](https://www.tampermonkey.net/) (на Android — Firefox или Kiwi Browser).
2. Получи ключ на [console.groq.com/keys](https://console.groq.com/keys). Для очистки LLM — ключ Ollama Cloud на [ollama.com](https://ollama.com) (опционально, очистку можно отключить).
3. Открой [ссылку установки скрипта](https://git.slaid098.dev/slaid098/opencode-voice-dictation/raw/branch/dist/opencode-voice-dictation.user.js) — скрипт установится в Tampermonkey.
4. Открой веб-интерфейс OpenCode. При первом запуске панель настроек откроется сама: вставь ключ STT и, если нужно, ключ LLM, затем сохрани.
5. Нажми кнопку микрофона в композере, говори и нажми ещё раз. Очищенный текст вставится в поле и при включённой автоотправке отправится.

### Как это работает

```text
микрофон -> MediaRecorder (webm/opus) -> Whisper STT -> сырой текст
         -> очистка LLM (опционально) -> вставка в композер/вопрос -> автоотправка
```

- Модель STT по умолчанию — `whisper-large-v3-turbo`: она быстрая и меньше галлюцинирует на тишине, чем `whisper-large-v3`. Для максимальной точности переключись в настройках на `whisper-large-v3`.
- Модель очистки по умолчанию — `deepseek-v4.1-flash` через Ollama Cloud с выключенным reasoning. Можно указать любой Ollama- или OpenAI-совместимый endpoint.
- Если очистка не удалась, вставляется сырой текст (переключатель «Вставлять сырой текст при ошибке очистки»), поэтому диктовка не зависит от LLM.
- Если не удался STT, аудио сохраняется в IndexedDB и появляется баннер восстановления. Повторить можно сразу или после перезагрузки страницы.

### Настройки

Открой кнопку-шестерёнку рядом с микрофоном или меню Tampermonkey → **Настройки голосового ввода**. В панели четыре вкладки:

- **STT** — пресет провайдера (Groq / OpenAI / Custom), endpoint, API-ключ, модель (кнопка «Загрузить модели»), язык, промпт, temperature, «Проверить подключение».
- **Очистка** — включение/выключение, провайдер (Ollama Cloud / Ollama Local / Custom OpenAI-совместимый), Base URL, API-ключ, модель, reasoning, проверка подключения и редактируемый промпт очистки со счётчиком символов и кнопкой «Сбросить к стандартному».
- **Поведение** — автоотправка композера, автоотправка ответов на вопросы, fallback на сырой текст, сохранение аудио при ошибках, максимальная длительность записи, число попыток и задержки.
- **Диагностика** — версия userscript, статус селекторов OpenCode 2, занятое место IndexedDB, последняя ошибка и сохранённые неудачные записи.

Промпт очистки хранится в GM storage userscript-а. Обновление скрипта не перезаписывает твои правки; стандартный промпт применяется только при первом запуске или после «Сбросить к стандартному». Текст диктовки отправляется отдельным user-сообщением, поэтому добавлять плейсхолдер в промпт не нужно.

### Надёжность

- Повторы выполняются автоматически при сетевых ошибках, таймаутах, `408`, `425`, `429` и `5xx` (по умолчанию 3 попытки с экспоненциальным backoff и jitter). `400`, `401`, `403` и `404` не повторяются — нужно исправить настройки.
- Заголовок `Retry-After` от сервера учитывается.
- Запись сохраняется **до** запуска STT. Ошибки STT, очистки, вставки и отправки дают баннер восстановления с действиями для соответствующей стадии.
- Повторная вставка после ошибки заменяет ранее вставленный текст, а не дублирует его.
- Хранятся только 5 последних неудачных записей (не старше 7 дней); хранилище очищается автоматически.

### Приватность и безопасность

- Аудио отправляется в выбранный STT-провайдер, текст расшифровки — в выбранный LLM-провайдер. Больше ничего из браузера не уходит.
- API-ключи хранятся в хранилище userscript-менеджера (GM storage) и **не шифруются** — любой, у кого есть доступ к профилю браузера, может их прочитать. Используй ключи с минимальными правами и меняй их, если устройством пользуются другие.
- Скрипт не логирует ключи и тела запросов; в сообщениях об ошибках учётные данные скрываются.
- Микрофон работает только в secure context, поэтому для удалённого доступа нужен HTTPS.

### Решение проблем

| Проблема | Решение |
|----------|---------|
| Кнопка микрофона не появляется | Убедись, что это OpenCode 2.0.25+. Открой «Диагностику» и проверь статус селекторов. Если «Composer dock — нет», но «Поле ввода» и «Форма композера» — да (так бывает на Firefox Android), скрипт 2.0.1 всё равно вставит кнопку в ряд отправки или покажет плавающую кнопку над композером. Перезагрузи страницу. |
| `401` от STT или LLM | Заново введи API-ключ в настройках и проверь, что пресет провайдера соответствует ключу. |
| `429` / «Слишком много запросов» | Подожди; скрипт повторит запрос автоматически. Можно сменить модель или провайдера. |
| «Пустая расшифровка» | Запись была тихой или слишком короткой. Запиши ещё раз; предыдущее аудио сохранится, если включено сохранение. |
| Нет доступа к микрофону | Разреши микрофон для сайта в настройках браузера. На Android доступ к микрофону требует HTTPS. |
| Текст вставился не туда | Возможно, вопрос уже закрылся — скрипт переключился на композер. Проверь цель в «Диагностике». |
| Автоотправка не срабатывает | Кнопка отправки OpenCode могла измениться. Скрипт сначала нажимает Enter, затем пробует `[data-action="composer-submit"]`. Проверь «Диагностику» и обнови скрипт. |
| Неправильный язык | Очисти Whisper-промпт (вкладка STT) или явно задай язык. Английский промпт смещает модель к английскому. |

### Обновление с 1.x

Версия 2.0.0 сохраняет те же `@name` и `@namespace`, поэтому Tampermonkey обновит скрипт на месте. При первом запуске старые настройки 1.x (ключ Groq, модель, язык, Whisper-промпт, temperature, автоотправка) автоматически мигрируют в новый конфиг. Старые пункты меню заменены панелью настроек; в новом меню — «Настройки голосового ввода», «Переключить автоотправку», «Повторить последнюю диктовку» и «Очистить сохранённые ошибки».

Версия 2.0.0 рассчитана только на DOM OpenCode 2. Если ты всё ещё на OpenCode 1.x, оставайся на релизе 1.0.7.

---

## 💬 Support and contacts / Поддержка и контакты

👉 **[slaid098.dev/support](https://slaid098.dev/support)**
