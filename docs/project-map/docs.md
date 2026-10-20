---
module: docs
purpose: Handoff-документы, ADR, project map
key_files:
  - docs/handoff/pr-<N>-<slug>.md — handoff на PR
  - docs/decisions/<NNNN>-<slug>.md — архитектурные решения (ADR)
  - docs/project-map/ — карта структуры проекта
dependencies: []
last_updated: 2026-10-20
---

# docs/

## Structure
- `handoff/pr-<N>-<slug>.md` — handoff на PR (секции: Что сделано, Почему, Pending, Watch out)
- `decisions/<NNNN>-<slug>.md` — архитектурные решения (секции: Статус, Контекст, Решение, Альтернативы)
- `project-map/` — карта структуры проекта (README + по файлу на модуль)

## ADR 2.0.0
- `0008-opencode-2-dom-and-enter-submit.md` — селекторы OpenCode 2 и отправка через Enter
- `0009-llm-cleanup-editable-prompt.md` — очистка LLM, редактируемый промпт, reasoning off, fallback
- `0010-config-v2-retry-and-recovery.md` — конфиг v2, retry-политика, IndexedDB и восстановление

## ADR 0.9.0
- `0011-i18n-stt-mobile.md` — i18n RU/EN, STT `groq`/`custom`, 403-классификация, мобильный truncate, вопросный микрофон, heartbeat и осознанный downgrade до 0.9.0

## Patterns
- Один handoff на PR, slug = тема PR.
- ADR нумеруются с 0001; имя `<NNNN>-<slug>.md` (у ранних ADR сохранён `-pr-<N>-` в имени).
- Архитектурные изменения, затрагивающие DOM OpenCode, сетевые протоколы или формат конфига, требуют ADR.
