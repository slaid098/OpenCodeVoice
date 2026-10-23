# ADR 0017: fallback mic/gear внутри формы композера при отсутствии dock

- **Date**: 2026-10-23

## Статус

Accepted.

## Контекст

На Firefox Android во время работы агента микрофон и настройки появлялись в fixed-панели поверх переписки, хотя композер оставался видимым. После перезагрузки кнопки возвращались в строку композера. `findComposerDock()` возвращал `null` (или dock не проходил проверку `isHittable()`), поэтому `showComposerFallback(dock)` выбирал `ocvd-floating-actions--fixed`, даже когда на экране была доступная `form[data-component="composer"]`.

Fixed-панель визуально отрывается от композера и перекрывает контент сессии. Это противоречит правилу «микрофон остаётся в композере, fallback — только если строка действий недоступна».

## Решение

`showComposerFallback(dock, form)` выбирает первый доступный anchor:

1. видимый и hittable `session-composer-dock`;
2. видимая и hittable `form[data-component="composer"]` (или form, найденная через editor);
3. `document.documentElement` с классом `ocvd-floating-actions--fixed`, только если ни dock, ни форма недоступны.

Fallback внутри anchor получает класс `ocvd-fallback-actions`; если anchor имеет `position: static`, ему выставляется `position: relative`. Для проверки anchor используются `isRenderedNode()` (учитывает computed `visibility`) и `isHittable()`, поэтому скрытая или перекрытая форма не становится якорем.

## Последствия

- Во время работы агента кнопки остаются прикреплёнными к видимому композеру, а не висят над перепиской.
- Fixed-панель остаётся последним резервом для случая, когда весь композер скрыт.
- Тесты: form-only fallback остаётся внутри формы; скрытый dock по-прежнему даёт fixed-fallback; возврат в строку действий после её появления работает.
- Если OpenCode перестанет использовать и dock, и form, потребуется новый селектор контейнера композера.

## Источники

- Скриншот пользователя от 2026-10-23: Firefox Android, строка композера со stop-кнопкой, mic/gear в fixed-панели.
- ADR 0013: fallback при работе агента.
- `src/ui.ts`: `showComposerFallback`, `injectComposer`.
- `src/insert.ts`: `findComposerDock`, `findComposerForm`.
