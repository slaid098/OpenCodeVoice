# 🎙️ OpenCodeVoice
![Cover](assets/cover.png)
<!-- tagline-en:start -->
> Voice dictation for OpenCode 2 web — Whisper (Groq) or a custom OpenAI-compatible endpoint, optional LLM cleanup, RU/EN interface
<!-- tagline-en:end -->
<!-- tagline-ru:start -->
> Голосовой ввод для OpenCode 2 web — Whisper (Groq) или свой OpenAI-совместимый endpoint, необязательная очистка LLM, интерфейс RU/EN
<!-- tagline-ru:end -->

**0.9.0 (pre-1.0).** GitHub is the primary install and update channel; Forgejo is a mirror. / GitHub — основной канал установки и обновлений; Forgejo — зеркало.

[English](#-english) | [Русский](#-русский)

---

## 🇺🇸 English

<!-- summary-en:start -->
### ❓ Why

Dictating is much faster than typing on a phone, and the built-in Android voice input does work in the browser. But it is noticeably less accurate than Whisper, especially for technical terms, names, and long dictation. OpenCode web also has no built-in microphone.

OpenCodeVoice adds a microphone to the OpenCode 2 composer and question prompts, sends the audio to Whisper, and optionally passes the transcript through an LLM that fixes punctuation and formats the text. The cleanup step is optional and fully configurable — use your own prompt or turn it off.
<!-- summary-en:end -->

<!-- features-en:start -->
### Features

| Feature | Description |
|---------|-------------|
| 🎤 Mic in composer | Records from the composer; the transcript is inserted at the caret |
| ❓ Mic in question prompts | Dictate answers to OpenCode questions; the mic button itself never submits the form |
| 🧠 Whisper (Groq) | Built-in endpoint and model: only an API key is needed. `whisper-large-v3-turbo` by default, `whisper-large-v3` available |
| 🔌 Custom URL | Connect OpenAI, a proxy, or any self-hosted OpenAI-compatible transcription endpoint |
| ✨ Optional LLM cleanup | Fixes punctuation and formats the text; editable prompt, can be disabled entirely |
| 📝 Editable prompt | Edited in the settings panel, survives updates, and can be reset to the default |
| ⚡ Auto-submit | Separate toggles for the composer and for question answers |
| 🔁 Retry and recovery | Automatic retries with backoff; a recovery banner offers retry, raw-text insertion, and deletion right in the UI |
| 💾 No lost recordings | Audio and text are saved in IndexedDB on failure and restored after a page reload |
| 🌍 RU/EN interface | Russian or English UI, or automatic selection from the browser language |
| 📱 Mobile and desktop | Large touch targets, safe-area padding, bottom-sheet settings; the model name shrinks on phones so the reasoning selector stays visible |
| 🔄 Auto-update | Updates from the GitHub `dist` branch via `@updateURL` |
| ⌨️ Ctrl+Space / Esc | Desktop hotkeys to start/stop and cancel |
<!-- features-en:end -->

### Requirements

- **OpenCode 2.0.25+** web UI (recommended: 2.0.32). OpenCode 1.x uses a different DOM and is not supported.
- A userscript manager: Tampermonkey or Violentmonkey.
- A Groq API key (free tier available) **or** a custom OpenAI-compatible STT endpoint with its own key and model.
- Microphone access. Browsers only allow it on `https://` or `localhost`, so use a Cloudflare Tunnel (or another HTTPS reverse proxy) when connecting from a phone.

### Quick Start

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Android: Firefox or Kiwi Browser).
2. Get a key at [console.groq.com/keys](https://console.groq.com/keys).
3. Open the [script install link](https://raw.githubusercontent.com/slaid098/OpenCodeVoice/dist/opencode-voice-dictation.user.js) — it installs into Tampermonkey.
4. Open your OpenCode web UI. On the first run the settings panel opens automatically: keep **Whisper (Groq)** and paste the key, or switch to **Custom URL** and enter your endpoint and model. Optionally configure cleanup.
5. Tap the mic button in the composer, speak, and tap it again. The text is inserted and, with auto-submit enabled, sent.

### How it works

```text
mic -> MediaRecorder (webm/opus) -> Whisper (Groq) or Custom URL -> transcript
    -> optional LLM cleanup -> insert into composer/question -> optional auto-submit
```

- **Whisper (Groq)** is the built-in preset: the endpoint and model are fixed, so only the API key is required. The default model is `whisper-large-v3-turbo`; `whisper-large-v3` is available in the model list.
- **Custom URL** works with any OpenAI-compatible transcription endpoint: OpenAI itself, a proxy that bypasses regional restrictions, or a self-hosted Whisper server. Endpoint and model are editable, and the API key is optional for proxies without authentication.
- Cleanup is optional. The default provider is Ollama Cloud with reasoning disabled; any Ollama or OpenAI-compatible endpoint can be used instead. If cleanup fails, the raw transcript is inserted (controlled by "Insert raw text if cleanup fails"), so dictation never blocks on the LLM.
- If STT fails, the audio is stored in IndexedDB and a recovery banner appears. You can retry immediately or after a page reload.

### Settings

Open the gear button next to the microphone or the Tampermonkey menu → **Voice input settings**. The panel has four tabs:

- **STT** — provider (**Whisper (Groq)** or **Custom URL**), API key, model (with "Load models"), language, recognition prompt, temperature, "Test connection". The built-in Groq endpoint is shown read-only.
- **Cleanup** — enable/disable, provider (Ollama Cloud / Ollama Local / Custom OpenAI-compatible), Base URL, API key, model, reasoning, connection test, and the editable cleanup prompt with a character counter and "Reset to default".
- **Behavior** — interface language (Auto / Russian / English), auto-submit composer, auto-submit question answers, fallback to raw text, saving failed audio, maximum recording length, retry attempts and delays.
- **Diagnostics** — userscript version, OpenCode 2 selector status (including whether each microphone button is present and visible), IndexedDB usage, and saved failed recordings.

The interface language is applied after saving. Tampermonkey menu items pick up the new language after the page reloads. The cleanup prompt is stored in GM storage; updating the script does not overwrite your edits.

### Reliability

- Retries are automatic for network errors, timeouts, `408`, `425`, `429`, and `5xx` (3 attempts with exponential backoff and jitter by default). `400`, `401`, `403`, and `404` are not retried — they need a settings fix.
- `Retry-After` from the server is respected.
- The recording is saved **before** STT starts. STT, cleanup, insert, and submit failures each produce a recovery banner with actions appropriate to the failed stage.
- The microphone button re-injects itself if OpenCode re-renders the composer or the question dock, and a heartbeat restores it within about a second if the page removes it.
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
| Mic button does not appear | Make sure the page is OpenCode 2.0.25+. Open Diagnostics: it shows both the selector status and whether the microphone buttons exist and are visible. Reload the page. |
| `401` from STT or LLM | Re-enter the API key in the settings; check that the selected provider matches the key. |
| `403` / `451` from STT | The provider may be blocking requests from your region rather than rejecting the key. The script detects the known OpenAI and Groq responses and says so explicitly. Use **Custom URL** with a proxy or another STT service. |
| `429` / "Too many requests" | Wait; the script retries automatically. Consider a different model or provider. |
| "Empty transcription" | The recording was silent or too short. Record again; the previous audio is kept if saving is enabled. |
| Microphone permission denied | Allow the microphone for the site in browser settings. On Android, microphone access requires HTTPS. |
| Text is inserted into the wrong place | The question prompt may have closed; the script falls back to the composer. Check the target in Diagnostics. |
| Auto-submit does nothing | OpenCode's submit button may have changed. The script presses Enter first and falls back to `[data-action="composer-submit"]`. Check Diagnostics and update the script. |
| Wrong language | Clear the recognition prompt (STT tab) or set the language explicitly. An English prompt biases the model toward English. |
| Reasoning selector is off-screen on a phone | Update to 0.9.0: the model name now shrinks on narrow screens instead of pushing the rest of the row off-screen. Desktop layout is unchanged. |

### Updating from 1.x

0.9.0 keeps the same `@name` and `@namespace`, so Tampermonkey treats it as the same script. On first load, legacy 1.x settings (Groq key, model, language, recognition prompt, temperature, auto-submit) are migrated automatically. A legacy OpenAI endpoint becomes **Custom URL** with its endpoint and model preserved.

### Updating from 2.0.1

0.9.0 is a deliberate version reset below 2.0.1. Userscript managers do not install a lower version automatically, so the update must be done by hand:

1. Open the [install link](https://raw.githubusercontent.com/slaid098/OpenCodeVoice/dist/opencode-voice-dictation.user.js) and confirm the reinstall.
2. Settings usually survive in GM storage, but check the API key and the STT provider after the first launch.
3. If the manager refuses to install a lower version, remove the old copy and install 0.9.0 from scratch.

After 0.9.0 is installed, future 0.9.x releases update automatically from GitHub.

---

## 🇷🇺 Русский

<!-- summary-ru:start -->
### ❓ Зачем

Диктовать намного быстрее, чем печатать с телефона, и встроенный голосовой ввод Android в браузере действительно работает. Но он заметно менее точен, чем Whisper, особенно для технических терминов, имён и длинной диктовки. К тому же в OpenCode web нет встроенного микрофона.

OpenCodeVoice добавляет микрофон в композер и в вопросные промпты OpenCode 2, отправляет аудио в Whisper и при желании прогоняет расшифровку через LLM, которая исправляет пунктуацию и приводит текст в удобный вид. Этот шаг необязателен и полностью настраивается — можно использовать свой промпт или отключить его.
<!-- summary-ru:end -->

<!-- features-ru:start -->
### Фичи

| Фича | Описание |
|------|----------|
| 🎤 Микрофон в композере | Запись из поля ввода; текст вставляется в позицию курсора |
| ❓ Микрофон в вопросах | Диктовка ответов на вопросы OpenCode; сама кнопка микрофона форму не отправляет |
| 🧠 Whisper (Groq) | Встроенный endpoint и модель: нужен только API-ключ. По умолчанию `whisper-large-v3-turbo`, доступна `whisper-large-v3` |
| 🔌 Custom URL | OpenAI, прокси или любой self-hosted OpenAI-совместимый endpoint распознавания |
| ✨ Необязательная очистка LLM | Правит пунктуацию и приводит текст в удобный вид; промпт редактируется, очистку можно полностью отключить |
| 📝 Редактируемый промпт | Правится в панели настроек, переживает обновления и сбрасывается к стандартному |
| ⚡ Автоотправка | Отдельные переключатели для композера и для ответов на вопросы |
| 🔁 Повтор и восстановление | Автоматические retry с backoff; баннер восстановления с повтором, вставкой сырого текста и удалением прямо в интерфейсе |
| 💾 Запись не теряется | Аудио и текст сохраняются в IndexedDB при ошибке и восстанавливаются после перезагрузки |
| 🌍 Интерфейс RU/EN | Русский или английский язык, либо автоматический выбор по языку браузера |
| 📱 Телефон и десктоп | Крупные кнопки, safe-area, настройки в виде bottom sheet; на телефоне название модели сжимается, чтобы переключатель reasoning оставался видимым |
| 🔄 Автообновление | Обновляется через `@updateURL` из ветки `dist` на GitHub |
| ⌨️ Ctrl+Space / Esc | Горячие клавиши на десктопе: старт/стоп и отмена |
<!-- features-ru:end -->

### Требования

- **OpenCode 2.0.25+** (рекомендуется 2.0.32). В OpenCode 1.x другой DOM — он не поддерживается.
- Userscript-менеджер: Tampermonkey или Violentmonkey.
- API-ключ Groq (есть бесплатный тариф) **или** свой OpenAI-совместимый STT-endpoint с ключом и моделью.
- Доступ к микрофону. Браузеры разрешают его только на `https://` или `localhost`, поэтому с телефона нужен HTTPS — например, Cloudflare Tunnel или другой reverse proxy.

### Быстрый старт

1. Установи [Tampermonkey](https://www.tampermonkey.net/) (на Android — Firefox или Kiwi Browser).
2. Получи ключ на [console.groq.com/keys](https://console.groq.com/keys).
3. Открой [ссылку установки скрипта](https://raw.githubusercontent.com/slaid098/OpenCodeVoice/dist/opencode-voice-dictation.user.js) — скрипт установится в Tampermonkey.
4. Открой веб-интерфейс OpenCode. При первом запуске панель настроек откроется сама: оставь **Whisper (Groq)** и вставь ключ либо выбери **Custom URL** и укажи endpoint и модель. Очистку можно настроить по желанию.
5. Нажми кнопку микрофона в композере, говори и нажми ещё раз. Текст вставится в поле и при включённой автоотправке отправится.

### Как это работает

```text
микрофон -> MediaRecorder (webm/opus) -> Whisper (Groq) или Custom URL -> расшифровка
         -> необязательная очистка LLM -> вставка в композер/вопрос -> необязательная автоотправка
```

- **Whisper (Groq)** — встроенный пресет: endpoint и модель зашиты, поэтому нужен только API-ключ. По умолчанию используется `whisper-large-v3-turbo`; в списке моделей доступна `whisper-large-v3`.
- **Custom URL** подходит для любого OpenAI-совместимого endpoint-а распознавания: сам OpenAI, прокси для обхода региональных ограничений или собственный Whisper-сервер. Endpoint и модель редактируются, а API-ключ для прокси без авторизации можно не указывать.
- Очистка необязательна. Провайдер по умолчанию — Ollama Cloud с выключенным reasoning; можно указать любой Ollama- или OpenAI-совместимый endpoint. Если очистка не удалась, вставляется сырой текст (переключатель «Вставлять сырой текст при ошибке очистки»), поэтому диктовка не зависит от LLM.
- Если не удался STT, аудио сохраняется в IndexedDB и появляется баннер восстановления. Повторить можно сразу или после перезагрузки страницы.

### Настройки

Открой кнопку-шестерёнку рядом с микрофоном или меню Tampermonkey → **Настройки голосового ввода**. В панели четыре вкладки:

- **STT** — провайдер (**Whisper (Groq)** или **Custom URL**), API-ключ, модель (кнопка «Загрузить модели»), язык, подсказка распознаванию, temperature, «Проверить подключение». Встроенный Groq-endpoint показан только для чтения.
- **Очистка** — включение/выключение, провайдер (Ollama Cloud / Ollama Local / Custom OpenAI-совместимый), Base URL, API-ключ, модель, reasoning, проверка подключения и редактируемый промпт очистки со счётчиком символов и кнопкой «Сбросить к стандартному».
- **Поведение** — язык интерфейса (Авто / Русский / English), автоотправка композера, автоотправка ответов на вопросы, fallback на сырой текст, сохранение аудио при ошибках, максимальная длительность записи, число попыток и задержки.
- **Диагностика** — версия userscript, статус селекторов OpenCode 2 (включая наличие и видимость кнопок микрофона), занятое место IndexedDB и сохранённые неудачные записи.

Язык интерфейса применяется после сохранения. Пункты меню Tampermonkey подхватят новый язык после перезагрузки страницы. Промпт очистки хранится в GM storage; обновление скрипта не перезаписывает твои правки.

### Надёжность

- Повторы выполняются автоматически при сетевых ошибках, таймаутах, `408`, `425`, `429` и `5xx` (по умолчанию 3 попытки с экспоненциальным backoff и jitter). `400`, `401`, `403` и `404` не повторяются — нужно исправить настройки.
- Заголовок `Retry-After` от сервера учитывается.
- Запись сохраняется **до** запуска STT. Ошибки STT, очистки, вставки и отправки дают баннер восстановления с действиями для соответствующей стадии.
- Кнопка микрофона возвращается сама, если OpenCode перерисовал композер или вопросный док, а heartbeat восстанавливает её примерно за секунду, если страница её удалила.
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
| Кнопка микрофона не появляется | Убедись, что это OpenCode 2.0.25+. Открой «Диагностику»: там видно и статус селекторов, и наличие/видимость самих кнопок микрофона. Перезагрузи страницу. |
| `401` от STT или LLM | Заново введи API-ключ в настройках и проверь, что выбранный провайдер соответствует ключу. |
| `403` / `451` от STT | Возможно, провайдер блокирует запросы из твоего региона, а не отвергает ключ. Скрипт распознаёт известные ответы OpenAI и Groq и прямо об этом сообщает. Используй **Custom URL** с прокси или другой STT-сервис. |
| `429` / «Слишком много запросов» | Подожди; скрипт повторит запрос автоматически. Можно сменить модель или провайдера. |
| «Пустая расшифровка» | Запись была тихой или слишком короткой. Запиши ещё раз; предыдущее аудио сохранится, если включено сохранение. |
| Нет доступа к микрофону | Разреши микрофон для сайта в настройках браузера. На Android доступ к микрофону требует HTTPS. |
| Текст вставился не туда | Возможно, вопрос уже закрылся — скрипт переключился на композер. Проверь цель в «Диагностике». |
| Автоотправка не срабатывает | Кнопка отправки OpenCode могла измениться. Скрипт сначала нажимает Enter, затем пробует `[data-action="composer-submit"]`. Проверь «Диагностику» и обнови скрипт. |
| Неправильный язык | Очисти подсказку распознаванию (вкладка STT) или явно задай язык. Английская подсказка смещает модель к английскому. |
| На телефоне не видно переключатель reasoning | Обновись до 0.9.0: на узких экранах название модели теперь сжимается, а не выталкивает остальные элементы ряда за границу. Десктопный layout не изменился. |

### Обновление с 1.x

0.9.0 сохраняет те же `@name` и `@namespace`, поэтому Tampermonkey считает её тем же скриптом. При первом запуске старые настройки 1.x (ключ Groq, модель, язык, подсказка распознаванию, temperature, автоотправка) мигрируют автоматически. Старый OpenAI-endpoint становится **Custom URL** с сохранёнными endpoint-ом и моделью.

### Обновление с 2.0.1

0.9.0 — осознанный откат версии ниже 2.0.1. Userscript-менеджеры не устанавливают более низкую версию автоматически, поэтому обновление выполняется вручную:

1. Открой [ссылку установки](https://raw.githubusercontent.com/slaid098/OpenCodeVoice/dist/opencode-voice-dictation.user.js) и подтверди переустановку.
2. Настройки обычно сохраняются в GM storage, но после первого запуска проверь API-ключ и выбранного STT-провайдера.
3. Если менеджер отказывается ставить более низкую версию, удали старую копию и установи 0.9.0 с нуля.

После установки 0.9.0 будущие версии 0.9.x обновляются автоматически с GitHub.
