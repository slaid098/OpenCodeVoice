# opencode-voice-dictation

Project-specific rules for agents. This file **complements** the global `~/.config/opencode/AGENTS.md` (orchestration and code style) — it does NOT replace it. Both are loaded together by opencode.

## Documentation

Do not create `docs/handoff/`, `docs/decisions/`, or `docs/project-map/`. They duplicate PR descriptions and `AGENTS.md` and go stale. `AGENTS.md`, PR descriptions, and git history are the source of truth. `docs/` is ignored so the old workflow cannot be reintroduced by accident.

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

There are two distribution channels, both on GitHub (`slaid098/OpenCodeVoice`):

- `dist` — stable userscript. Deployed only from `main` by `deploy.yml` (`git push --force` to an orphan `dist` branch).
- `dev-dist` — dev userscript. Deployed only from `dev` by `deploy-dev.yml` on every push to `dev`.

GitHub Releases were removed (PR #37). Stable `@updateURL`/`@downloadURL` point to `dist`, dev ones to `dev-dist`; `@icon` always points to `main/assets/icon.png`. Bumping `@version` + deploying to `dist` is sufficient for stable auto-update.

The dev build has a distinct `@name` (`OpenCode Voice Dictation (dev)`) and `@namespace` (`.../dev`), so userscript managers keep it as a separate script and it never replaces the stable install. `deploy-dev.yml` derives the dev version from `package.json` and appends `-dev.<run_number>` (`OCVD_VERSION`), and sets `OCVD_CHANNEL=dev`; `vite.config.ts` switches the identity and URL branch from these env vars. The source version in `package.json`/`vite.config.ts` remains the next stable version.

Force-push is allowed only to `dist` and `dev-dist`, never to `main`. Do not merge `dev` into `main` until the dev build has been installed and visually checked; CI passing is necessary but not sufficient.

## `@icon`

`vite.config.ts` `userscript.icon` → `main/assets/icon.png` (128×128 PNG RGBA) on GitHub (`raw.githubusercontent.com/slaid098/OpenCodeVoice`). Do NOT delete `assets/icon.png` and do NOT change the path without editing both the file location and the `icon` URL in sync. Do not confuse it with `assets/cover.svg`/`assets/cover.png` (README cover, 1024×1024).

## `@namespace`

`vite.config.ts` `userscript.namespace` — это ИДЕНТИФИКАТОР скрипта для userscript-менеджеров (Tampermonkey/Violentmonkey используют пару `@name` + `@namespace` для дедупликации, Greasemonkey-стандарт). НЕ функциональный URL — менеджеры НЕ резолвят его. НЕ менять при смене хостинга или переименовании репозитория — смена namespace = userscript-менеджер видит «новый» скрипт → дубликат вместо обновления. Единственное исключение — dev-сборка: `vite.config.ts` при `OCVD_CHANNEL=dev` намеренно добавляет `/dev` к namespace и ` (dev)` к имени, чтобы dev-скрипт жил отдельной записью и не заменял стабильный.

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

`findComposerEditor()` prefers the active editor inside the dock (rendered, on-screen, hittable), then the last active editor in the document, then the last visible editor, then the dock editor/last editor. A stale composer left by another session must not win after SPA navigation. `isVisibleNode()` also rejects computed `display: none`/`visibility: hidden`, not only missing client rects. `findComposerActions()` resolves through that editor first: `composer-actions` inside its form → the form's submit row → the dock's `composer-actions` → the last active global actions slot outside a question dock → the last visible global actions slot → the global submit row. `ui.ts` injects into the resolved row; if no row exists, it uses the composer fallback described below. The submit button is usually nested inside a flex wrapper in `composer-actions`, not a direct child: insert the mic/gear before the direct child that contains the submit, never pass the nested submit itself to `insertBefore` (it throws `NotFoundError`, which used to abort injection and leave the mic missing after a session switch). Keep these fallbacks: Firefox Android may render the composer without `session-composer-dock`.

`LEGACY_SELECTORS` exists only as a fallback for older OpenCode 2 builds; do not extend it for OpenCode 1. Composer submit first checks the submit button: when it is `disabled` or `aria-disabled="true"`, return `false` without dispatching Enter, because OpenCode will not accept the message (the agent is working, the session is blocked, or uploads are pending). Otherwise dispatch a synthetic Enter keydown first, with a click on `[data-action="composer-submit"]` as fallback.

Question injection picks the container in this order: header actions → footer actions → custom option → legacy form. The header comes first because the footer sits under the options and is often clipped by the bottom edge of a tall question panel, while the header is always on screen. The mic is placed before the last foreign button in the header/footer, and after the field in the custom option. Keep exactly one question mic and move it when the container changes.

Question elements are resolved inside the **last visible** `session-question-dock` (the same rule as `findComposerDock()`), never through the first dock found in the document. OpenCode can leave a hidden dock from a previous render, and injecting into it makes the mic invisible.

Question submit clicks the last enabled button in `question-footer-actions` (ignoring `[data-ocvd]`, `disabled`, and `aria-disabled="true"`); this both commits the custom answer and advances the form. Only the legacy DOM uses Enter → `form.requestSubmit()`. Do not send Enter first in the current DOM: it commits the input but does not submit the question.

Selector status (including whether each mic is present and visible) is exposed in Settings → Diagnostics.

## Mobile CSS

The phone fix lives entirely inside `@media (max-width: 767px) and (pointer: coarse) and (hover: none)` in `ensureStyle()` (`src/ui.ts`). The touch-capability conditions are mandatory: a desktop browser must never match this block at any window width or zoom level, because these rules change the composer-controls row. The model title gets `flex: 1 1 0; min-width: 0` and truncates with an ellipsis, while the agent and variant buttons keep `flex: 0 0 auto`. Do NOT replace this with `position: sticky` — it was explicitly rejected, and desktop styles must remain untouched. Keep the `:has([data-action="composer-model"])` selector and the direct-child fallback.

## Session and draft guards

Auto-submit is global, on by default, and is the primary mode. Do NOT add per-recording "review/send" modes or a new history screen: saved text uses the existing recovery banner and the "Retry last dictation" menu command.

- `pipeline.start()` stores `originPath = getSessionPath()` (`window.location.pathname + window.location.search`, i.e. `/server/:serverKey/session/:id`). `FailedDictation.originPath` is persisted with the record.
- `sessionChanged(record)` must be checked before insertion (`runInsert`), before submission (`runSubmit`), and in the `runLlm` cleanup-failure branch that inserts raw text. On mismatch nothing is inserted or submitted; the record is saved with stage `insert`/`submit`, the recovery banner is shown, and a toast explains what happened.
- Manual recovery (`insertRaw`) is an explicit user action: it inserts into the current field using `record.cleanText || record.rawText`, so a recognized-but-not-inserted text is still available after switching back.
- `rawInserted = true` after any successful insertion (normal or manual). It prevents duplicate insertion: the next recovery offers "Submit" instead of "Insert text". `submitRaw()` keeps `cleanText` (`record.cleanText = record.cleanText || record.rawText`).
- `rememberDraft(target)` snapshots the composer editor text or question input value at recording start; `isDraftChanged(target)` compares it before insertion. If the draft changed and auto-submit is on, insert the text but skip submission and show a toast. With auto-submit off, behavior is unchanged.
- Draft comparison is plain text equality, not caret position or selection; cursor insertion and selection replacement are out of scope for now.
- `runSubmit` inserts first and only then submits. If `submitPrompt()` returns `false` and `isSubmitBusy()` is true, finish with the `pipeline.agentBusy` toast and keep the text in the composer: the agent is still working, the session is blocked, or uploads are pending. Do not show a submit error or a recovery banner in this case.

## Compact recording UI

- The recording status is a fit-content pill: red dot + timer (`01:05`), 30×30 stop button (red square) and 30×30 cancel button (×). Stop and cancel are inside the pill, away from OpenCode's agent-stop button. `UiOptions.onStop` calls `pipeline.stop()`.
- The composer mic stays a mic during recording (`aria-label` "Остановить запись", red pulsing dot via `::after`); it is not replaced by a red square. Only processing phases replace the icon with a spinner.
- Keep the pill above the composer at the existing safe-area offset; do not move or cover OpenCode controls.

## Settings panel layout

- The sheet has a fixed height, not `max-height`: `92dvh` on mobile and `min(86dvh, 760px)` from 760 px. Tab switching must not move the top edge.
- The `.tabs` row is a flex item of the fixed-height sheet: keep `flex: 0 0 auto`. Without it the row behaves as a scroll container with a zero min-height, flex-shrink squeezes it when the active tab is tall, and the tabs plus their bottom border jump between tabs.
- `renderContent()` resets `contentEl.scrollTop` so a new tab opens at the top.
- At `max-width: 520px` the four tabs are a 2×2 grid (no horizontal scroll); at `max-width: 480px` the password/model rows and footer wrap, inputs and the Save button take the full width. Buttons use `white-space: nowrap`.
- Native `<option>` elements need explicit `background: var(--bg)` and `color: var(--fg)`; without it provider names can be white-on-white in the light theme.

## Model pickers

Model selection in Settings uses the custom inline listbox (`addModelInput` in `settings-panel.ts`), not the native `<datalist>`. Firefox for Android does not render datalist suggestions for text inputs, and desktop browsers do not open the datalist after a programmatic "Load models". The list opens automatically after loading, filters while typing, supports ↑/↓ + Enter + Escape, and closes on selection, outside pointerdown, tab switch, and panel close. Escape must close the list before the panel; the panel keydown handler calls `closeActiveModelList()`. The input stays free-form, so a custom model ID that is not in the list still works. Keep the list inside the field: as an inline block it is not clipped by the `.content` scroll container and needs no fixed-position math.

## Page gate

The userscript runs on `*://*/*`, so `isOpencodePage()` is the gate. It must recognize the OpenCode app shell even when no composer is mounted: `[data-slot="titlebar"]` / `[data-slot="titlebar-v2"]`, `[data-slot="home-panel"]`, `[data-slot="session-chat-panel"]`, `[data-component="new-session"]`, in addition to the composer/question selectors. Otherwise loading `/` (the sessions list) can exhaust `waitForOpencode()` before a session is opened, and SPA navigation does not fire `pageshow`/`visibilitychange`, so the mic only appears after a reload.

## Composer mic visibility

- Hide the composer mic while an OpenCode dialog or mobile drawer is open: a rendered `[data-component="dialog-overlay"]` or `[data-slot="mobile-drawer-content"]` without `[data-closed]`. These layers cover the session, and a fixed fallback would float over the session picker.
- `[data-slot="mobile-drawer-content"]` is force-mounted: check computed `visibility` and `[data-closed]`, not only `getClientRects()`. Observe `data-open`/`data-closed`/`data-closing` so the mic disappears when the drawer opens, not only on the next heartbeat.
- A force-mounted drawer can stay `visibility: visible` after closing and only move off-screen. `hasBlockingOverlay()` must ignore overlays that no longer overlap the viewport; otherwise the mic stays removed until reload.
- Session switching is SPA navigation: the previous session's composer can stay mounted after the new one appears. Choose the active composer (rendered, on-screen, hittable), not the last one by DOM order. `inject()` compares `pathname + search`; on a change it removes the old composer controls and re-injects immediately. Do not add a session settle window that suppresses injection: a usable new composer must get the mic at once, and the heartbeat re-injects if OpenCode mounts it later.
- Hidden stale composers left by an inactive session must not create a floating mic on `/`. A fallback is allowed only when the composer exists (even if temporarily hidden) and either a visible composer surface or a visible `[data-slot="session-chat-panel"]` is present. Otherwise remove the mic, gear and fallback: the home/session-selection screen has no composer mic.
- On a real session, keep the fallback available while OpenCode temporarily hides the composer; the heartbeat re-injects when it returns.

## Mic re-injection

`handleMutations()` schedules `inject()` when foreign nodes are added, when an Element containing our nodes was removed and is no longer connected, and when `data-open`/`data-closed`/`data-closing` changes. This covers OpenCode deleting only our button without adding anything else and the mobile tabs drawer opening. A 1-second heartbeat (`setInterval`, only while `document.visibilityState === "visible"`) is the last-resort safety net; `inject()` must stay idempotent so the heartbeat does not move nodes. Do not remove the heartbeat without an equally reliable replacement. Keep exactly one composer mic and one gear for the whole page (`takeButton`).

When the actions row exists but is invisible, off-screen, covered, or too narrow for the buttons (`isVisibleNode`/`isOnScreen`/`isHittable`/`fitsInside`), move the buttons to a fallback instead of leaving them unavailable: inside a rendered, overlapping `form[data-component="composer"]` (`ocvd-fallback-actions`), then inside a rendered, overlapping composer dock, otherwise a fixed floating panel on `document.documentElement` (`ocvd-floating-actions--fixed`). Prefer the form: it is the rounded composer card, while the dock can span the whole session panel, which puts a dock-anchored row at the bottom of the screen or outside the viewport. The anchored fallback is a static full-width row below the composer content, so it grows the card and cannot be clipped under the model controls; do not make it absolutely positioned inside the row. Use `overlapsViewport`, not strict full containment, for the anchor: mobile composers often extend a few pixels under the browser toolbar. Never move them into a hidden form or dock. When the row becomes usable again, put the buttons back in front of the submit button and remove the fallback. A row that is visible but cannot fit the buttons is retried after `ROW_RETRY_MS` (15 s) or when its geometry changes. While a visible question dock is open, do not create a composer fallback: the question dock owns the visible mic.

## Stack

Vite 8 + vite-plugin-monkey 8 + TypeScript 5.9 (strict) + Biome 2.6 (2-space, 100 width, double quotes, semicolons, trailing commas, `noExplicitAny: error`) + Vitest 5 + Knip 6.42. Node 22 (`.nvmrc`), `engines: ^20.19 || >=22.12` (Vite 8 requirement).

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
