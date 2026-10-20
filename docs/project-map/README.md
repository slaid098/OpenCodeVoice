---
module: .
purpose: Index of project structure and top-level modules
last_updated: 2026-10-20
---

# Project Map — opencode-voice-dictation

Userscript 2.0.0 для голосовой диктовки в OpenCode 2 web: Whisper STT → очистка LLM → вставка в композер/question → автоотправка. Точки входа в UI OpenCode 2 задаются в `SELECTORS` (`src/insert.ts`), fallback для ранних 2.0.x — `LEGACY_SELECTORS`.

## Top-level modules

- [`src/`](./src.md) — исходники userscript (bootstrap, pipeline, STT, LLM, storage, UI, настройки)
- [`tests/`](./tests.md) — unit- и интеграционные тесты (vitest) + моки GM API
- [`.github/`](./github.md) — CI workflows, dependabot, deploy
- [`assets/`](./assets.md) — статичные ассеты (иконка userscript)
- [`docs/`](./docs.md) — handoff, ADR, project map

## Build / tooling

- `vite.config.ts` + `vite-plugin-monkey` — сборка userscript (`.user.js` + `.meta.js`)
- `biome.json` — lint/format
- `tsconfig.json` — TypeScript
- `knip.json` — детектор неиспользуемого кода
- `vitest.config.ts` — test runner и coverage thresholds

## Conventions

- Один handoff на PR: `docs/handoff/pr-<N>-<slug>.md` с секциями `## Что сделано`, `## Почему`, `## Pending`, `## Watch out`.
- ADR на архитектурное решение: `docs/decisions/<NNNN>-<slug>.md` с секциями `## Статус`, `## Контекст`, `## Решение`, `## Альтернативы`.
- Селекторы OpenCode 2 — единый источник в `src/insert.ts`; при изменении DOM обновлять ADR и Diagnostics.
- Секреты (API-ключи, токены) не коммитить и не логировать.
