# ADR 0015: composer mic scope — app shell gate and modal layers

- **Date**: 2026-10-23

## Статус

Accepted.

## Контекст

Пользователь сообщил о двух проблемах:

1. На экране выбора сессии появлялся «резервный» плавающий микрофон и перекрывал список сессий. Это происходило на `/` (домашняя страница со списком сессий) и при открытии мобильной шторки выбора вкладок сверху. Скрытые композеры от неактивных сессий остаются в DOM, `findComposerDock()`/`findComposerEditor()` находили их, а `showComposerFallback()` создавал fixed-панель на `documentElement` с `z-index: 2147482999`. Шторка OpenCode имеет `z-index: 50–51`, поэтому микрофон оказывался поверх неё.

2. Иногда во время работы модели микрофон отсутствовал, и помогал только reload. `isOpencodePage()` проверял только селекторы композера/вопроса. Если страница загружалась на `/`, где композера нет, `waitForOpencode()` исчерпывал 20 попыток. Переход в сессию через SPA не вызывает `pageshow`/`visibilitychange`, поэтому `setup()` больше не запускался. Reload уже на странице сессии инициализировал UI.

Дополнительное ограничение: `[data-slot="mobile-drawer-content"]` смонтирован постоянно (`forceMount`). Закрытая шторка имеет `data-closed` и `visibility: hidden`, но `getClientRects()` у неё непустой, поэтому прежняя проверка видимости считала её открытой.

## Решение

**1. Page gate распознаёт app shell.** В `PAGE_DETECT_SELECTORS` добавлены `[data-slot="titlebar"]` / `[data-slot="titlebar-v2"]`, `[data-slot="home-panel"]`, `[data-slot="session-chat-panel"]` и `[data-component="new-session"]`. UI стартует на `/` до открытия сессии; дальнейшие переходы обрабатываются MutationObserver и heartbeat.

**2. Микрофон скрыт под модальными слоями OpenCode.** `hasBlockingOverlay()` проверяет видимый `[data-component="dialog-overlay"]` и `[data-slot="mobile-drawer-content"]` без `[data-closed]`. Пока слой открыт, mic, gear и composer-fallback удаляются. После закрытия heartbeat/MutationObserver возвращают кнопки.

**3. Force-mounted шторка проверяется структурно.** `isRenderedNode()` требует непустой `getClientRects()` и computed `visibility !== "hidden"`. `isClosedNode()` дополнительно отсекает `[data-closed]` на самом узле или предке. MutationObserver слушает `data-open`/`data-closed`/`data-closing`, поэтому микрофон исчезает сразу при открытии шторки, не ожидая секунду.

**4. Floating fallback только в контексте сессии.** Если композерных узлов нет вообще — кнопки удаляются. Если узлы есть, но все скрыты, fixed-fallback разрешён только при видимой сессии (`[data-slot="session-chat-panel"]`). На `/` видимой сессии нет, поэтому скрытый композер не оставляет микрофон на экране выбора. На реальной сессии fallback сохраняется, пока OpenCode временно прячет композер, и возвращается в строку, когда она снова доступна.

**5. Версия.** `0.9.6` → `0.9.7` синхронно в `package.json` и `vite.config.ts`.

## Альтернативы

### 1. Гейтить по URL (`/server/:key/session/:id`, `/new-session`)

- **Плюс**: проще всего, гарантированно убирает микрофон с `/`.
- **Минус**: ломается на кастомном base path, embedded-сборках и старых маршрутах; DOM-признак видимой сессии структурный и не зависит от URL.

### 2. Скрывать микрофон только при открытой мобильной шторке

- **Плюс**: минимальная правка под конкретную жалобу.
- **Минус**: не решает floating-микрофон на `/` из-за скрытых композеров и не покрывает диалоги OpenCode (command palette, настройки, выбор модели).

### 3. Оставить fixed-fallback на всех страницах и поднять z-index ещё выше

- **Плюс**: кнопка всегда доступна.
- **Минус**: именно это и перекрывает выбор сессии; UI не должен висеть над модальными слоями, которые делают композер недоступным.

### 4. Всегда показывать fallback на сессии, даже когда композерных узлов нет

- **Плюс**: микрофон виден при полном размонтировании композера.
- **Минус**: появляется поверх child-session prompt-disabled и request-доков (permission/websearch/elicitation), где диктовка бессмысленна. Композер должен существовать хотя бы в скрытом виде.

### 5. Только CSS-скрытие кнопки

- **Плюс**: ноль JS-логики.
- **Минус**: кнопка остаётся в DOM, `takeButton`/fallback продолжают считать её доступной, а после закрытия слоя можно получить неверную позицию или дубликат.

## Последствия

- На `/` и на экране выбора сессии композерного микрофона нет; при возврате в сессию он появляется.
- Пока открыт диалог OpenCode или мобильная шторка, микрофон скрыт; после закрытия возвращается.
- UI инициализируется на домашней странице, поэтому открытие сессии через SPA больше не требует reload.
- Скрытые композеры неактивных сессий больше не создают floating-микрофон.
- Список модальных селекторов привязан к OpenCode 2; при появлении нового типа модального слоя его нужно добавить в `OVERLAY_SELECTORS`.
- Тесты: home со скрытым композером, fixed-fallback на видимой сессии, открытая/закрытая мобильная шторка, открытый/закрытый диалог, app shell в page gate.

## Источники

- `anomalyco/opencode` dev, `packages/app/src/shell/mobile-drawer.tsx` и `mobile-drawer.css` — `forceMount`, `data-closed`, `z-index: 50/51`.
- `anomalyco/opencode` dev, `packages/ui/src/context/dialog.tsx` — `data-component="dialog-overlay"`, `data-dialog-layer`.
- `anomalyco/opencode` dev, `packages/app/src/session/screen.tsx` — `data-slot="session-chat-panel"` и постоянный composer dock.
- `anomalyco/opencode` dev, `packages/app/src/shell/routes/routes.tsx` — маршруты `/`, `/new-session`, `/server/:serverKey/session/:id`.
- Предыдущий ADR: `docs/decisions/0013-composer-busy-fallback.md` (fallback при работе агента).
