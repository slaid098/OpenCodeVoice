---
module: .github
purpose: CI workflows, dependabot, deploy
key_files:
  - .github/workflows/ci.yml — CI (lint, typecheck, test, knip)
  - .github/workflows/deploy.yml — сборка + деплой в ветку dist
  - .github/dependabot.yml — авто-обновление зависимостей
dependencies: []
last_updated: 2026-10-20
---

# .github/

## Structure
- `workflows/ci.yml` — CI (lint, typecheck, test, knip)
- `workflows/deploy.yml` — сборка + деплой в ветку dist (без GitHub Release). GitHub (`slaid098/OpenCodeVoice`) — канал установки и обновлений.
- `dependabot.yml` — авто-обновление зависимостей
