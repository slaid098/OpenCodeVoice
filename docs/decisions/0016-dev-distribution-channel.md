# ADR 0016: dev-канал на GitHub (`dev` → `dev-dist`)

- **Date**: 2026-10-23

## Статус

Accepted.

## Контекст

Изменения перед релизом проверялись только локальными тестами: lint, typecheck, vitest, coverage, knip и build. Этого недостаточно для UI-правок, которые зависят от живого DOM OpenCode (мобильная шторка, диалоги, композер, page gate). Нужен был канал, в который можно поставить сборку себе, визуально проверить и только потом отдать её всем пользователям stable-канала.

Стабильный канал уже живёт на GitHub: `slaid098/OpenCodeVoice`, ветка `dist`, установка через `raw.githubusercontent.com`. GitHub Releases удалены (ADR 0005). Forgejo-remote (`git.slaid098.dev`) — не канал распространения и в этой схеме не участвует.

## Решение

**1. Отдельная ветка `dev`.** Вся незавершённая работа идёт в `dev`; `main` остаётся стабильной веткой. Merge `dev` → `main` выполняется только после зелёного CI и визуальной проверки dev-сборки.

**2. Workflow `deploy-dev.yml`.** На каждый push в `dev` (и вручную через `workflow_dispatch`) GitHub Actions:

- запускает `npm ci`, lint, typecheck, knip и `vitest run --coverage` (порог 70%);
- собирает userscript с `OCVD_CHANNEL=dev`;
- формирует версию `<version из package.json>-dev.<github.run_number>` через `OCVD_VERSION`;
- делает force-push в orphan-ветку `dev-dist`.

**3. Отдельная identity dev-скрипта.** `vite.config.ts` при `OCVD_CHANNEL=dev` меняет:

- `@name` → `OpenCode Voice Dictation (dev)`;
- `@namespace` → `https://github.com/slaid098/opencode-voice-dictation/dev`;
- `@updateURL`/`@downloadURL` → файлы в `dev-dist`;
- `@version` → значение из `OCVD_VERSION`.

`@icon` остаётся на `main/assets/icon.png`. Tampermonkey/Violentmonkey видят dev-скрипт как отдельную запись, поэтому он не заменяет стабильный и не ломает его автообновление. На время визуальной проверки стабильный скрипт отключается, чтобы на странице не было двух микрофонов.

**4. Установка dev.**

```
https://raw.githubusercontent.com/slaid098/OpenCodeVoice/dev-dist/opencode-voice-dictation.user.js
```

После первого успешного запуска workflow ветка `dev-dist` появляется автоматически.

**5. Промоушен.** После визуального подтверждения открывается PR `dev` → `main`. CI проверяет PR; после merge `deploy.yml` собирает stable-версию и публикует её в `dist`. Dev-скрипт удаляется/отключается, стабильный включается обратно. При следующих правках цикл повторяется: версия в `package.json`/`vite.config.ts` поднимается на следующую стабильную, dev-сборки получают суффикс `-dev.<run>`.

**6. Force-push.** Разрешён только в `dist` (stable, из `main`) и `dev-dist` (dev, из `dev`). В `main` force-push запрещён.

## Альтернативы

### 1. Собирать локально и ставить из файла

- **Плюс**: не нужен workflow и новая ветка.
- **Минус**: нет автоматического обновления dev-сборки; каждый раз нужно вручную пересобирать и переустанавливать; легко забыть, какая версия установлена.

### 2. Та же identity (`@name`/`@namespace`), но `@updateURL` на `dev-dist`

- **Плюс**: сохраняется общее хранилище настроек и API-ключа.
- **Минус**: dev-сборка заменяет стабильный скрипт у тестировщика; после merge нужно вручную переустанавливать stable, а сравнение версий `0.9.7-dev.N` ↔ `0.9.7` в userscript-менеджерах не гарантирует ожидаемое поведение.

### 3. Публиковать dev в `dist`

- **Плюс**: одна ветка, один URL.
- **Минус**: недопустимо: все стабильные пользователи получили бы непроверенную сборку.

### 4. GitHub Actions artifact вместо ветки `dev-dist`

- **Плюс**: не нужно создавать ветку.
- **Минус**: artifact нельзя указать в `@updateURL`; автообновление не работает, ссылка живёт ограниченное время.

### 5. Отдельный репозиторий для dev

- **Плюс**: полная изоляция.
- **Минус**: дублирование workflow и истории; для одного проекта избыточно.

## Последствия

- Stable-пользователи не получают dev-сборки; `dist` обновляется только из `main`.
- Dev-сборка автообновляется с `dev-dist` после каждого push в `dev`.
- У dev-скрипта отдельное хранилище Tampermonkey: API-ключ и настройки нужно ввести заново. Это осознанная плата за независимость от stable.
- Визуальная проверка становится обязательным шагом перед merge в `main`; зелёный CI — необходимое, но не достаточное условие.
- Имя и namespace стабильного скрипта не меняются; dev-различие задаётся только через env в `vite.config.ts`.
- Ветку `dev-dist` можно пересоздавать force-push’ем; история dev-сборок не является источником истины.

## Источники

- `.github/workflows/deploy.yml` — текущий stable-деплой в `dist`.
- `vite.config.ts` — `userscript.name`/`namespace`/`version` и URL-ы.
- `docs/decisions/0005-pr-37-remove-releases-add-icon.md` — отказ от GitHub Releases.
- `docs/decisions/0015-composer-mic-scope.md` — изменения, для которых вводится dev-канал.
