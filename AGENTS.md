# opencode-voice-dictation

Project-specific rules for agents. This file **complements** the global `~/.config/opencode/AGENTS.md` (orchestrator model, pipeline, code style) — it does NOT replace it. Both are loaded together by opencode.

## Version bump (CRITICAL)

Bump `version` in **both** files synchronously on every PR touching `src/`, `vite.config.ts`, or `tests/`:

- `vite.config.ts` → `userscript.version` (vite-plugin-monkey reads `@version` from here, NOT from `package.json`)
- `package.json` → `version` (for npm/semver tooling only)

Desync (bumping only one file) = userscript managers (Tampermonkey/Violentmonkey) do not see the auto-update even though npm sees the new version. Without a bump at all, auto-update never triggers.

Current version: **2.0.1** (OpenCode 2 web only).

## `@connect`

`vite.config.ts` `userscript.connect` generates the `@connect` metablock. Currently `*`: STT and LLM endpoints are user-configurable (Groq, OpenAI, Ollama Cloud/Local, custom OpenAI-compatible proxies), so the domain is not known ahead of time. Do NOT narrow it — that breaks custom endpoints and nginx workarounds.

## Dist deploy

The `dist` branch is the **only** distribution channel for the userscript. Deploy happens via `deploy.yml` (plain `git push --force` to an orphan `dist` branch) on push to `main`. GitHub Releases were removed (PR#37, ADR-0005). `@updateURL`/`@downloadURL` point to raw files on the `dist` branch hosted on Forgejo (`git.slaid098.dev`) — bumping `@version` + deploying to `dist` is sufficient for auto-update. Force-push is allowed only to `dist`, never to `main`.

The workflow always pushes `dist` to the GitHub mirror and pushes to Forgejo only when the `FORGEJO_TOKEN` GitHub secret is set (a Forgejo PAT with `write:repository`). Without the secret it emits a warning instead of failing; in that case publish `dist` manually.

## `@icon`

`vite.config.ts` `userscript.icon` → `main/assets/icon.png` (128×128 PNG RGBA). Do NOT delete `assets/icon.png` and do NOT change the path without editing both the file location and the `icon` URL in sync.

## `@namespace`

`vite.config.ts` `userscript.namespace` — это ИДЕНТИФИКАТОР скрипта для userscript-менеджеров (Tampermonkey/Violentmonkey используют пару `@name` + `@namespace` для дедупликации, Greasemonkey-стандарт). НЕ функциональный URL — менеджеры НЕ резолвят его. НЕ менять при миграции хоста (GitHub → Forgejo) — смена namespace = userscript-менеджер видит «новый» скрипт → дубликат вместо обновления.

## OpenCode 2 selectors

`SELECTORS` in `src/insert.ts` — the primary contract with the OpenCode 2 DOM:

- composer dock: `[data-component="session-composer-dock"]`
- composer form (fallback anchor): `form[data-component="composer"]`
- editor: `[data-component="composer-editor"][role="textbox"][aria-multiline="true"]`
- actions slot: `[data-slot="composer-actions"]`
- submit: `[data-action="composer-submit"]`
- question dock: `[data-component="session-question-dock"]`
- question form: `form[data-slot="question-option"][data-custom="true"]`
- question input: `textarea[data-slot="question-custom-input"]`
- question footer: `[data-slot="question-footer-actions"]`

`findComposerActions()` resolves in order: dock → `composer-actions` slot → composer form → parent of `composer-submit` → visible global actions slot. `ui.ts` injects into the resolved row; if no row exists, it places a floating mic above `form[data-component="composer"]`. Keep these fallbacks: Firefox Android may render the composer without `session-composer-dock`.

`LEGACY_SELECTORS` exists only as a fallback for older 2.0.x builds; do not extend it for OpenCode 1.x — 2.0.0 does not support v1. Composer submit is a synthetic Enter keydown first, with a click on `[data-action="composer-submit"]` as fallback (ADR 0008). Question submit is Enter on the textarea, then `form.requestSubmit()`, then a footer button. Selector status is exposed in Settings → Diagnostics.

## Stack

Vite 6 + vite-plugin-monkey 5 + TypeScript 5.7 (strict) + Biome 1.9.4 (2-space, 100 width, double quotes, semicolons, trailing commas, `noExplicitAny: error`) + Vitest 3 + Knip 6.24. Node 22 (`.nvmrc`), `engines: node >=20`.

## Commands

- `npm run lint` (`biome check`)
- `npm run typecheck` (`tsc --noEmit`)
- `npm run test` (`vitest run`)
- `npm run knip` (dead-code)
- `npm run build` (vite build → `dist/`)

Coverage thresholds: **70%** (statements/branches/functions/lines).

## src/ structure

- `index.ts` — bootstrap: page gate, menu commands, settings panel, UI, keyboard, recovery
- `config.ts` — defaults/presets, `ocvd.config.v2` (single JSON key), legacy 1.x migration, validation, menu commands
- `types.ts` — `AppConfig`, `FailedDictation`, `SelectorStatus`, pipeline types
- `audio.ts` — `MediaRecorder` (webm/opus → webm → mp4), permission errors, 3 s stop timeout
- `http.ts` — `GM_xmlhttpRequest` wrapper, `HttpError`, retry/backoff, `Retry-After`, abort
- `transcribe.ts` — STT providers (Groq/OpenAI/Custom), response parsing, retry policy
- `llm.ts` — Ollama native and OpenAI-compatible cleanup, prompt handling, response sanitization/fallback
- `models.ts` — model list loading for STT and LLM
- `pipeline.ts` — recording → STT → LLM → insert → submit state machine, retry/cancel/recover
- `storage.ts` — IndexedDB failure store (`failures`, audio as `ArrayBuffer`), prune, persistence
- `insert.ts` — OpenCode 2 selectors, caret insertion, Enter submit, legacy fallbacks
- `ui.ts` — idempotent mic/gear injection into composer/question docks, timer, toast, recovery banner
- `settings-panel.ts` — Shadow DOM bottom sheet (STT / Cleanup / Behavior / Diagnostics)
- `keyboard.ts` — Ctrl+Space toggle, Escape cancel

Never log API keys or request bodies. Error messages must redact credentials. Secrets live only in GM storage (userscript) and are not encrypted at rest — document this in user-facing docs.

## Tests

Vitest + `happy-dom`, `fake-indexeddb/auto`. The `$` module (vite-plugin-monkey's `GM_*` alias) is mocked at `tests/__mocks__/$/index.ts` via vitest `resolve.alias`. `tests/setup.ts` resets DOM, GM mock store, and UI hosts between tests. Coverage excludes `src/index.ts`, `src/types.ts`, and config files — everything else must stay above the 70% threshold.
