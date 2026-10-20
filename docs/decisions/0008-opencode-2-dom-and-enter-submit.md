# ADR 0008: OpenCode 2 DOM and Enter-based submit

- **Date**: 2026-10-20
- **Version**: 2.0.0

## Статус

Accepted.

## Контекст

Userscript 1.0.7 был написан под DOM OpenCode 1.18.x: композер `prompt-input-v2`, dock `session-prompt-dock`, кнопка отправки `prompt-submit`. В OpenCode 2.0.x этих элементов нет — UI переписан на SolidJS, атрибуты `data-component`/`data-slot` другие, а кнопка отправки помечена `data-action="composer-submit"`. Старые селекторы не находили ни композер, ни кнопку отправки, поэтому микрофон не появлялся, а автоотправка не работала.

Дополнительно в OpenCode 2 появились question prompts — форма с `textarea[data-slot="question-custom-input"]`, в которую тоже нужно диктовать. Клик по кнопке внутри формы может её отправить, поэтому микрокнопка в вопросе не должна всплывать до формы.

## Решение

**1. Основной контракт — `SELECTORS` в `src/insert.ts`:**

```ts
composerDock:  '[data-component="session-composer-dock"]'
editor:        '[data-component="composer-editor"][role="textbox"][aria-multiline="true"]'
composerActions:'[data-slot="composer-actions"]'
submit:        '[data-action="composer-submit"]'
questionDock:  '[data-component="session-question-dock"]'
questionForm:  'form[data-slot="question-option"][data-custom="true"]'
questionInput: 'textarea[data-slot="question-custom-input"]'
questionFooter:'[data-slot="question-footer-actions"]'
```

Поиск dock-а фильтруется по наличию editor внутри: пустые и question-dock-и не считаются композером. Если найдено несколько, берётся последний видимый (`getClientRects().length > 0`) — это активная сессия.

**2. Вставка.** В contenteditable — `document.execCommand("insertText")` в текущую каретку (в конец, если каретки нет). Если команда не сработала, fallback: `beforeinput` → вставка текстового узла в range → `input`. В textarea вопроса — native setter `HTMLTextAreaElement.prototype.value` + `InputEvent("input")`, иначе SolidJS не увидит изменение.

**3. Отправка композера — синтетический Enter.** OpenCode 2 обрабатывает `keydown` с `key: "Enter"`, `shiftKey: false`, `isComposing: false` и вызывает submit. Скрипт диспатчит такое событие; если оно не было `preventDefault`-нуто, дополнительно кликает `[data-action="composer-submit"]` (кнопка может быть disabled). `keyCode`/`which`/`isComposing` определены через `Object.defineProperty`, потому что конструктор `KeyboardEvent` их не выставляет.

**4. Отправка вопроса.** Enter на textarea → `form.requestSubmit()` → primary/submit-кнопка в `question-footer-actions`.

**5. Legacy fallback** (`prompt-input`, `prompt-input-v2`, `session-prompt-dock`, `session-new-composer`, `session-composer`, `prompt-submit`) сохранён только для ранних 2.0.x сборок и не является поддержкой OpenCode 1.x.

**6. Идемпотентная инъекция.** Кнопки помечаются `data-ocvd`, перед вставкой проверяется `isConnected` и принадлежность нужному dock-у. MutationObserver с debounce переинжектит кнопки после перерисовки SolidJS; мутации внутри `.ocvd-*` игнорируются, чтобы не зациклиться.

## Последствия

- Userscript 2.0.0 требует OpenCode 2.0.25+; на 1.x он не работает by design.
- При обновлении OpenCode селекторы могут измениться. Статус каждого селектора виден в Settings → Diagnostics; это первый шаг диагностики.
- Синтетический Enter не является trusted-событием. В 2.0.x проверка `isTrusted` отсутствует, но если она появится, останется fallback на клик по `composer-submit`.
- `execCommand("insertText")` устарел, но пока поддерживается Firefox и Chromium; fallback через `beforeinput`/`input` покрывает случай отказа.

## Альтернативы

### 1. Поддержка OpenCode 1.x и 2.x в одном коде
- **Плюс**: одна ветка для всех.
- **Минус**: два разных DOM, разные способы отправки, рост сложности и тестов. Пользователь подтвердил, что нужен только актуальный OpenCode 2.x. Отвергнуто.

### 2. Только клик по `composer-submit`
- **Плюс**: проще, не зависит от обработчика клавиш.
- **Минус**: кнопка бывает disabled/перерисована, а Enter — основной путь отправки в OpenCode 2. Клик оставлен fallback-ом. Отвергнуто как единственный способ.

### 3. Прямой вызов внутреннего API SolidJS/контроллера
- **Плюс**: не зависит от DOM-событий.
- **Минус**: приватный API, ломается при каждом обновлении, нет стабильных точек входа. Отвергнуто.

## Источники

- `src/insert.ts` — `SELECTORS`, `LEGACY_SELECTORS`, `submitComposer`, `submitQuestion`
- `src/ui.ts` — инъекция кнопок и MutationObserver
- `app.asar` OpenCode 2.0.6/2.0.32 — поиск `composer-editor`, `composer-submit`, `question-custom-input`, `question-footer-actions`
- ADR 0001–0004 — история селекторов OpenCode 1.x
