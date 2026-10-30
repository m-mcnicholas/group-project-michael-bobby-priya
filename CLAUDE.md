# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DuckPlan is an 11th-grade group project (Michael, Bobby, Priya): a student planner that combines a calendar and a task list, syncs with Axis, and sorts everything by class, with subtle duck theming. The long-term plan (TypeScript + Expo/React Native, Supabase, Electron desktop, Axis via iCal or a server-side function) lives in `plans.md`. The Expo/Electron apps don't exist yet. What exists today is a buildless static site in `landing/` backed by the Supabase backend in `supabase/` (see `supabase/README.md`). The site stays local-only until `landing/supabase-config.js` is filled in.

## Collaboration procedure (from `plans.md`)

`plans.md` acts as the shared agents file. Before starting work, pull and read it to see what's been done. When you finish, add a dated entry to its `## Progress` section and push it. Entries normally state whether a public deployment was made. Push to a non-`main` branch unless explicitly told otherwise, and get changes into `main` through pull requests.

## Mandatory project rules (`.cursor/rules/`, always apply)

- **Local-first release** (`local-first-release.mdc`): make website changes locally, run checks, then start a loopback preview and present it to the user clearly labeled as *local*. Never deploy to Netlify, trigger a production release, or claim the public site (https://duckplan-mbp.netlify.app) is updated until the user explicitly approves. Pushing a feature branch is not deployment approval. After approval: pull, verify, publish, then check the public URL.
- **Fur is the fundamental button material** (`button-interactions.mdc`): new conventional buttons use the shared fur renderer instead of a painted surface. Text, icon-only, and icon-plus-text labels are all formed by the same fur-strand mask (no painted icons on top of fur). Icon-only controls need an explicit `aria-label`. Dense repeated content controls (calendar cells, time slots, task rows, event blocks) may stay lightweight non-fur surfaces but still follow the interaction rules below.
- **Three-stage button feedback** (same file): every enabled button or button-like control needs distinct **hover**, **held-press** (pointer, touch, Space, or Enter), and **post-release** feedback, plus a clear `:focus-visible` state. Disabled controls show none of these. Under reduced motion, movement is replaced by tint/outline/brightness while all three stages remain. Effects must not shift layout. Fur controls use localized strand brushing, compression, and recovery, and must never move or scale the whole control. Verify all of these states whenever a button is added or changed.
- **Chat Check** (`chat-check.mdc`): when the user asks for a "Chat Check", commit and push to the test repo `bobbyzhang133-star/Duck-Plan-Test` (never deploy), then ask the user's Duck Plan ChatGPT project to review that commit against the plan and acceptance criteria, including the commit id and any requested focus. Ask for concrete mismatches, causes, severity, and next changes, then report where the request was sent and summarize the reply.

## Commands

No build step and no package.json. Netlify publishes `landing/` as-is (`netlify.toml`).

```sh
# Run all tests (Node built-in test runner)
node --test tests/

# Run one test by name
node --test --test-name-pattern="motion guard" tests/

# Local preview (fur-lab.html must be served over HTTP, not opened via file://)
python3 -m http.server 8000 --bind 127.0.0.1 --directory landing
# → http://127.0.0.1:8000/  and  http://127.0.0.1:8000/fur-lab.html
```

## Architecture (`landing/`)

Plain HTML/CSS/JS with no modules or bundler. Scripts load in order through `<script>` tags and talk to each other via globals:

Load order: `planner-model.js`, `ical-parser.js`, `supabase-config.js`, `planner-store.js`, `fur-material.js`, `button-interactions.js`, `app.js`.

1. `planner-model.js` is a UMD-style module (`window.DuckPlannerModel` in the browser, `module.exports` in Node). It holds pure planner logic: local-time date keys (`YYYY-MM-DD`, never UTC), Day/Week/Month date ranges, task grouping, and `migrateTasks`. Tasks keep the **deadline** (`dueDate`/`dueTime`) separate from optional **scheduled work** (`scheduledStart` plus duration). Migration must never invent a schedule from an old due time.
2. `fur-material.js` is an IIFE that exposes `window.DuckFur` (`mount`, `mountAll`, `unmount`, `defaults`, and `__testing`). It is a native WebGL2 instanced-strand fur renderer. Each mounted host gets its own canvas and WebGL context. It falls back to a static PNG when WebGL2 is missing or the context is lost.
3. `button-interactions.js` is an IIFE that implements the three-stage rule for standard controls by adding the `interaction-pressed` and `interaction-released` classes. It is loaded by both pages.
4. `app.js` is the planner UI (`const Model = window.DuckPlannerModel`). Home is a full-viewport workspace with two linked panels, Tasks and Calendar (Day/Week/Month). Desktop defaults to Week and phones default to Day. Selecting a date updates the task panel, and clicking an empty slot prefills the task sheet. Navigation is an off-canvas drawer (`body.sidebar-open`). Tasks reference classes by `classId`; look classes up with `store.classById`. Settings holds the Account (magic link / Google), local-task import, and Axis connect/sync rows; Classes has add/edit/archive through `#class-modal`. Notifications and drag-and-drop are intentionally not implemented yet. `index.html` loads `app.js` and `planner-store.js` with a `?v=` cache-busting query, so bump it when they change.
5. `planner-store.js` (`window.DuckPlannerStore`, UMD) is the **only** code that reads or writes planner data. It keeps an in-memory cache (`listItems(range)`, `listClasses`, `classById` are synchronous), applies mutations optimistically (`upsertItem`, `toggleComplete`, `deleteItem`, `upsertClass`), and notifies `subscribe` listeners. Signed in, it uses Supabase (supabase-js loaded from jsDelivr only when configured, PKCE auth, soft deletes, Realtime on `items`/`classes`); otherwise it uses `localStorage` (`duckplan-demo-tasks-v1`, `duckplan-demo-classes-v1`) and migrates legacy `className` tasks to `classId`. App task fields are camelCase; `taskToRow`/`rowToTask` map them to the snake_case columns.
6. `ical-parser.js` (`window.DuckAxisIcal`, UMD) parses Axis iCal feeds, validates feed links (`normalizeFeedUrl`), and plans re-syncs (`planAxisSync`). `supabase/functions/axis-sync/ical-parser.js` must stay a byte-identical copy; after editing, run `cp landing/ical-parser.js supabase/functions/axis-sync/ical-parser.js`.
7. `fur-lab.html` + `fur-lab.js` form a tuning lab for the fur material. It is reachable from Settings → Interactive fur lab.

How fur buttons are integrated (`app.js` `shouldUseFurButton` / `setupFurMaterial`):
- Fur mounts on every visible `button`, `a.secondary-button`, and `a.nav-open-button` that has text or an `aria-label`, except the dense content controls excluded by class in `shouldUseFurButton` (`.calendar-slot`, `.calendar-event-block`, `.month-day`, `.task-select`, etc.). `data-fur-button` forces it on.
- Only the active interaction surface holds WebGL contexts. Hidden views and `aria-hidden` regions unmount. When the drawer is open only drawer controls keep fur, and when the modal is open only modal controls do. Re-run setup after rendering dynamic buttons, and unmount before you replace them, or contexts leak.
- Production tuning values (e.g. `radius: 12.8`, `pressRadius: 38.4`, `labelLengthScale: 0.8`, `labelWidthScale: 0.9`) were approved by the user. Don't change them without asking.
- The HTML label stays as the accessible name but is visually transparent. The canvas is `aria-hidden`, has `pointer-events: none`, and overscans the button by 18px.

`landing/FUR_MATERIAL.md` is the detailed design doc for the renderer: buffer/attribute layout (`rootSeeds` stride 6, `state` stride 4, `materialMask` stride 3), the signed-distance glyph pipeline, per-fiber recovery holds, rest tolerances, and known limitations. Read it before changing `fur-material.js`, and keep it updated.

## Tests

- `tests/planner-model.test.cjs` `require`s `landing/planner-model.js` directly and covers date math, legacy-task migration, and calendar grouping.
- `tests/planner-store.test.cjs` covers the row mappers, local mode, local-task import, and cloud mode against a fake supabase-js client.
- `tests/ical-parser.test.cjs` parses the made-up `tests/fixtures/axis-feed.ics` and covers title splitting, link validation, and re-sync planning. Never commit a real feed or feed link.
- `sh supabase/tests/run-local.sh` applies the migrations and seed to a throwaway Docker Postgres and runs `supabase/tests/rls.test.sql`.
- `tests/fur-material.test.cjs` stubs `global.window = {}`, `require`s `landing/fur-material.js`, and tests the pure/simulation helpers exported on `window.DuckFur.__testing`. To make a new internal testable, add it to that `__testing` export.
