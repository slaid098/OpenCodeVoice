---
module: .
purpose: Index of project structure and top-level modules
last_updated: 2026-10-20
---

# Project Map — OpenCodeVoice

Userscript **0.9.0** для голосовой диктовки в OpenCode 2 web: Whisper (Groq) или Custom URL → необязательная очистка LLM → вставка в композер/question → автоотправка. Интерфейс RU/EN. Точки входа в UI OpenCode 2 задаются в `SELECTORS` (`src/insert.ts`), fallback для ранних 2.0.x — `LEGACY_SELECTORS`.

GitHub (`slaid098/OpenCodeVoice`) — основной канал установки и обновлений; Forgejo — зеркало. Версия 0.9.0 — осознанный downgrade с 2.0.1, поэтому установленные копии 2.0.1 требуют ручной переустановки.

## Top-level modules

- [`src/`](./src.md) — исходники userscript (bootstrap, i18n, pipeline, STT, LLM, storage, UI, настройки)
- [`tests/`](./tests.md) — unit- и интеграционные тесты (vitest) + моки GM API
- [`.github/`](./github.md) — CI workflows, dependabot, deploy
- [`assets/`](./assets.md) — статичные ассеты (иконка userscript и обложка README)
- [`docs/`](./docs.md) — handoff, ADR, project map

## Build / tooling

- `vite.config.ts` + `vite-plugin-monkey` — сборка userscript (`.user.js` + `.meta.js`), метаданные указывают на GitHub `OpenCodeVoice`
- `biome.json` — lint/format
- `tsconfig.json` — TypeScript
- `knip.json` — детектор неиспользуемого кода
- `vitest.config.ts` — test runner и coverage thresholds

## Conventions

- Один handoff на PR: `docs/handoff/pr-<N>-<slug>.md` с секциями `## Что сделано`, `## Почему`, `## Pending`, `## Watch out`.
- ADR на архитектурное решение: `docs/decisions/<NNNN>-<slug>.md` с секциями `## Статус`, `## Контекст`, `## Решение`, `## Альтернативы`.
- Селекторы OpenCode 2 — единый источник в `src/insert.ts`; при изменении DOM обновлять ADR и Diagnostics.
- Пользовательские строки — только через `t()` в `src/i18n.ts`; новые ключи добавлять в оба словаря.
- Секреты (API-ключи, токены) не коммитить и не логировать.
