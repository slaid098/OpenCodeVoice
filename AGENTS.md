# opencode-voice-dictation

Project-specific rules for agents. This file **complements** the global `~/.config/opencode/AGENTS.md` (orchestrator model, pipeline, code style) — it does NOT replace it. Both are loaded together by opencode.

## Version bump (CRITICAL)

Bump `version` in **both** files synchronously on every PR touching `src/`, `vite.config.ts`, or `tests/`:

- `vite.config.ts` → `userscript.version` (vite-plugin-monkey reads `@version` from here, NOT from `package.json`)
- `package.json` → `version` (for npm/semver tooling only)

Desync (bumping only one file) = userscript managers (Tampermonkey/Violentmonkey) do not see the auto-update even though npm sees the new version. Without a bump at all, auto-update never triggers.

`vite.config.ts` and `package.json` are the source of truth for the current version; do not duplicate the number in docs.

## i18n

All user-facing strings go through `t()` from `src/i18n.ts`; never hardcode Russian or English text in `src/` (comments may stay in any language). The `ru` and `en` dictionaries must contain the same `MessageKey` set; `en` is typed as `Record<MessageKey, string>`, so a missing key fails typecheck. Placeholders use `{name}` and are replaced by `translate()`.

- `ui.language` accepts `auto | ru | en`; `auto` resolves to RU for `ru*` browser languages and EN otherwise.
- `initI18n()` runs once at bootstrap, before menu registration and UI creation. `save()` in the settings panel calls `setLocale(resolveLocale(config.ui.language))`.
- Tampermonkey menu items are registered once and pick up the new language only after a page reload — this is a known limitation.
- The default cleanup prompt is localized (`DEFAULT_CLEANUP_PROMPT_RU` / `DEFAULT_CLEANUP_PROMPT_EN`); a user-edited prompt is never overwritten.
- New keys must be added to both dictionaries; keep `tests/i18n.test.ts` green (it checks key parity and the absence of Cyrillic in EN values, except the intentionally Russian cleanup sample).

## `@connect`

`vite.config.ts` `userscript.connect` generates the `@connect` metablock. Currently `*`: STT and LLM endpoints are user-configurable (built-in Groq Whisper, a custom OpenAI-compatible STT endpoint, Ollama Cloud/Local, custom OpenAI-compatible proxies), so the domain is not known ahead of time. Do NOT narrow it — that breaks custom endpoints and nginx workarounds.

## STT providers

- `SttProviderId` is `"groq" | "custom"`. `"groq"` is the built-in Whisper preset: the endpoint comes from `STT_PRESETS.groq.endpoint`, the model from `stt.groqModel` (default `whisper-large-v3-turbo`).
- `"custom"` uses `stt.customEndpoint` and `stt.customModel`. Any OpenAI-compatible endpoint is allowed; the API key is optional for proxies without auth.
- `stt.customEndpoint`/`stt.customModel` are preserved when the user switches back to `groq`, so switching providers never loses a custom URL.
- Legacy `endpoint`/`model` fields and `provider: "openai"` exist only as migration input (`LEGACY_OPENAI_STT` fills gaps). Never write them back.
- 403 handling: first distinguish a key error (`401`, "invalid api key"), then a region block (OpenAI `unsupported_country_region_territory`, Groq `Forbidden` on `api.groq.com`, `451`), otherwise report a generic forbidden. Do not map every 403 to a region block: a proxy with a bad key must still see the key message. `isSttRegionBlock()` is shared by `transcribe.ts` and `models.ts`.

## Dist deploy

The `dist` branch is the **only** distribution channel for the userscript. Deploy happens via `deploy.yml` (plain `git push --force` to an orphan `dist` branch) on push to `main`. GitHub Releases were removed (PR#37, ADR-0005). `@updateURL`/`@downloadURL` point to raw files on the `dist` branch of `slaid098/OpenCodeVoice`, and `@icon` points to `main/assets/icon.png`. Bumping `@version` + deploying to `dist` is sufficient for auto-update. Force-push is allowed only to `dist`, never to `main`.

## `@icon`

`vite.config.ts` `userscript.icon` → `main/assets/icon.png` (128×128 PNG RGBA) on GitHub (`raw.githubusercontent.com/slaid098/OpenCodeVoice`). Do NOT delete `assets/icon.png` and do NOT change the path without editing both the file location and the `icon` URL in sync. Do not confuse it with `assets/cover.svg`/`assets/cover.png` (README cover, 1024×1024).

## `@namespace`

`vite.config.ts` `userscript.namespace` — это ИДЕНТИФИКАТОР скрипта для userscript-менеджеров (Tampermonkey/Violentmonkey используют пару `@name` + `@namespace` для дедупликации, Greasemonkey-стандарт). НЕ функциональный URL — менеджеры НЕ резолвят его. НЕ менять при смене хостинга или переименовании репозитория — смена namespace = userscript-менеджер видит «новый» скрипт → дубликат вместо обновления.

## OpenCode 2 selectors

`SELECTORS` in `src/insert.ts` — the primary contract with the OpenCode 2 DOM:

- composer dock: `[data-component="session-composer-dock"]`
- composer form (fallback anchor): `form[data-component="composer"]`
- editor: `[data-component="composer-editor"][role="textbox"][aria-multiline="true"]`
- actions slot: `[data-slot="composer-actions"]`
- submit: `[data-action="composer-submit"]`
- question dock: `[data-component="session-question-dock"]`
- question input (current): `[data-slot="question-option"][data-custom="true"] [data-slot="text-input-v2-input"]`
- question input (legacy): `textarea[data-slot="question-custom-input"]`
- question custom option: `[data-slot="question-option"][data-custom="true"]`
- question header actions: `[data-slot="question-header-actions"]`
- question footer: `[data-slot="question-footer-actions"]`

`findComposerActions()` resolves in order: dock → `composer-actions` slot → composer form → parent of `composer-submit` → visible global actions slot. `ui.ts` injects into the resolved row; if no row exists, it places a floating mic above `form[data-component="composer"]`. Keep these fallbacks: Firefox Android may render the composer without `session-composer-dock`.

`LEGACY_SELECTORS` exists only as a fallback for older OpenCode 2 builds; do not extend it for OpenCode 1. Composer submit is a synthetic Enter keydown first, with a click on `[data-action="composer-submit"]` as fallback (ADR 0008).

Question injection picks the container in this order: footer actions → header actions → custom option → legacy form. The mic is placed before the last foreign button in the footer/header, and after the field in the custom option. Keep exactly one question mic and move it when the container changes.

Question submit clicks the last enabled button in `question-footer-actions` (ignoring `[data-ocvd]`, `disabled`, and `aria-disabled="true"`); this both commits the custom answer and advances the form. Only the legacy DOM uses Enter → `form.requestSubmit()`. Do not send Enter first in the current DOM: it commits the input but does not submit the question.

Selector status (including whether each mic is present and visible) is exposed in Settings → Diagnostics.

## Mobile CSS

The narrow-screen fix lives entirely inside `@media (max-width: 767px)` in `ensureStyle()` (`src/ui.ts`). The model title gets `flex: 1 1 0; min-width: 0` and truncates with an ellipsis, while the agent and variant buttons keep `flex: 0 0 auto`. Do NOT replace this with `position: sticky` — it was explicitly rejected, and desktop styles must remain untouched. Keep the `:has([data-action="composer-model"])` selector and the direct-child fallback.

## Session and draft guards

Auto-submit is global, on by default, and is the primary mode. Do NOT add per-recording "review/send" modes or a new history screen: saved text uses the existing recovery banner and the "Retry last dictation" menu command.

- `pipeline.start()` stores `originPath = getSessionPath()` (`window.location.pathname + window.location.search`, i.e. `/server/:serverKey/session/:id`). `FailedDictation.originPath` is persisted with the record.
- `sessionChanged(record)` must be checked before insertion (`runInsert`), before submission (`runSubmit`), and in the `runLlm` cleanup-failure branch that inserts raw text. On mismatch nothing is inserted or submitted; the record is saved with stage `insert`/`submit`, the recovery banner is shown, and a toast explains what happened.
- Manual recovery (`insertRaw`) is an explicit user action: it inserts into the current field using `record.cleanText || record.rawText`, so a recognized-but-not-inserted text is still available after switching back.
- `rawInserted = true` after any successful insertion (normal or manual). It prevents duplicate insertion: the next recovery offers "Submit" instead of "Insert text". `submitRaw()` keeps `cleanText` (`record.cleanText = record.cleanText || record.rawText`).
- `rememberDraft(target)` snapshots the composer editor text or question input value at recording start; `isDraftChanged(target)` compares it before insertion. If the draft changed and auto-submit is on, insert the text but skip submission and show a toast. With auto-submit off, behavior is unchanged.
- Draft comparison is plain text equality, not caret position or selection; cursor insertion and selection replacement are out of scope for now.

## Compact recording UI

- The recording status is a fit-content pill: red dot + timer (`01:05`), 30×30 stop button (red square) and 30×30 cancel button (×). Stop and cancel are inside the pill, away from OpenCode's agent-stop button. `UiOptions.onStop` calls `pipeline.stop()`.
- The composer mic stays a mic during recording (`aria-label` "Остановить запись", red pulsing dot via `::after`); it is not replaced by a red square. Only processing phases replace the icon with a spinner.
- Keep the pill above the composer at the existing safe-area offset; do not move or cover OpenCode controls.

## Settings panel layout

- The sheet has a fixed height, not `max-height`: `92dvh` on mobile and `min(86dvh, 760px)` from 760 px. Tab switching must not move the top edge.
- `renderContent()` resets `contentEl.scrollTop` so a new tab opens at the top.
- At `max-width: 520px` the four tabs are a 2×2 grid (no horizontal scroll); at `max-width: 480px` the password/model rows and footer wrap, inputs and the Save button take the full width. Buttons use `white-space: nowrap`.
- Native `<option>` elements need explicit `background: var(--bg)` and `color: var(--fg)`; without it provider names can be white-on-white in the light theme.

## Mic re-injection

`handleMutations()` schedules `inject()` when foreign nodes are added **and** when an Element containing our nodes was removed and is no longer connected. This covers OpenCode deleting only our button without adding anything else. A 1-second heartbeat (`setInterval`, only while `document.visibilityState === "visible"`) is the last-resort safety net; `inject()` must stay idempotent so the heartbeat does not move nodes. Do not remove the heartbeat without an equally reliable replacement. When an existing mic is visible but the target container is temporarily invisible, leave the mic in place instead of removing it.

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

- `index.ts` — bootstrap: page gate, i18n init, menu commands, settings panel, UI, keyboard, recovery
- `i18n.ts` — RU/EN dictionaries, `t`/`translate`, `resolveLocale`, current locale
- `config.ts` — defaults/presets, `ocvd.config.v2` (single JSON key), legacy 1.x migration, validation, menu commands
- `types.ts` — `AppConfig`, `Locale`/`LocalePreference`, `FailedDictation`, `SelectorStatus`, pipeline types
- `audio.ts` — `MediaRecorder` (webm/opus → webm → mp4), permission errors, 3 s stop timeout
- `http.ts` — `GM_xmlhttpRequest` wrapper, `HttpError`, retry/backoff, `Retry-After`, abort
- `transcribe.ts` — STT providers (`groq` Whisper / `custom` OpenAI-compatible), response parsing, 403 classification, retry policy
- `llm.ts` — Ollama native and OpenAI-compatible cleanup, prompt handling, response sanitization/fallback
- `models.ts` — model list loading for STT and LLM
- `pipeline.ts` — recording → STT → LLM → insert → submit state machine, retry/cancel/recover, session guard (`originPath`) and draft guard (`rememberDraft`/`isDraftChanged`)
- `storage.ts` — IndexedDB failure store (`failures`, audio as `ArrayBuffer`), prune, persistence
- `insert.ts` — OpenCode 2 selectors, caret insertion, footer-button question submit, legacy fallbacks, draft snapshot (`rememberDraft`/`isDraftChanged`)
- `ui.ts` — idempotent mic/gear injection into composer/question docks, mobile CSS, compact recording pill, heartbeat, toast, recovery banner
- `settings-panel.ts` — Shadow DOM bottom sheet (STT / Cleanup / Behavior / Diagnostics), fixed height, responsive tabs/rows, interface language selector
- `keyboard.ts` — Ctrl+Space toggle, Escape cancel

Never log API keys or request bodies. Error messages must redact credentials. Secrets live only in GM storage (userscript) and are not encrypted at rest — document this in user-facing docs.

## Tests

Vitest + `happy-dom`, `fake-indexeddb/auto`. The `$` module (vite-plugin-monkey's `GM_*` alias) is mocked at `tests/__mocks__/$/index.ts` via vitest `resolve.alias`. `tests/setup.ts` resets DOM, GM mock store, and UI hosts between tests. Coverage excludes `src/index.ts`, `src/types.ts`, and config files — everything else must stay above the 70% threshold.
