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
- `workflows/deploy.yml` — сборка + деплой в ветку dist (без GitHub Release). GitHub (`slaid098/OpenCodeVoice`) — основной канал обновлений; Forgejo (`git.slaid098.dev`) — зеркало, обновляется только при наличии секрета `FORGEJO_TOKEN`, иначе вручную force-push в `dist`.
- `dependabot.yml` — авто-обновление зависимостей
