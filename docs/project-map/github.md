---
module: .github
purpose: CI workflows, dependabot, deploy
key_files:
  - .github/workflows/ci.yml — CI (lint, typecheck, test, knip)
  - .github/workflows/deploy.yml — сборка + деплой стабильного скрипта в ветку dist
  - .github/workflows/deploy-dev.yml — сборка + деплой dev-скрипта в ветку dev-dist
  - .github/dependabot.yml — авто-обновление зависимостей
dependencies: []
last_updated: 2026-10-23
---

# .github/

## Structure
- `workflows/ci.yml` — CI (lint, typecheck, test, knip)
- `workflows/deploy.yml` — сборка + деплой стабильного скрипта в ветку dist (без GitHub Release). GitHub (`slaid098/OpenCodeVoice`) — канал установки и обновлений.
- `workflows/deploy-dev.yml` — проверки (включая coverage), сборка dev-скрипта с `OCVD_CHANNEL=dev` и версией `<package.json>-dev.<run_number>`, force-push в `dev-dist` на каждый push в `dev`. Dev-скрипт имеет отдельные `@name`/`@namespace` и не заменяет стабильный.
- `dependabot.yml` — авто-обновление зависимостей
