# Plans and Discussion
## Procedures
Use the plans.md file as agents.md. This project is collaborative, so ALWAYS pull the plans.md file and check what has been done before beginning work, and ALWAYS record what you did in the plans.md file once finished, and ALWAYS push the plans.md file when work is being done. If you push, push to a non-main branch unless explicitly told. Use pull requests instead of pushing to main.

i was here

### Project Rules
 - Follow `.cursor/rules/button-interactions.mdc` for every button and button-like control across the project.
 - Follow `.cursor/rules/local-first-release.mdc` for all website work: review changes locally and obtain explicit approval before any public deployment.
## Ideation
 - ~~flashcard app~~
 - [x] digital planner linked with Axis
   - mix of calendar and task list
   - automatically sorts things by class
   - lots of organization options
   - both web and native apps for all platforms
## Plans
### Overview
**DuckPlan** is a digital planner for students that combines a calendar and a task list, pulls classes and assignments from Axis, and sorts everything by class automatically. One shared codebase ships to web, iOS, Android, and desktop.

### Core Features
 - **Axis sync**: sign in, import classes, assignments, and due dates, then re-sync on a schedule
 - **Calendar view**: day / week / month; assignments, tests, and personal events in one place
 - **Task list view**: checklist of to-dos with due dates, priority, and completion status
 - **Auto-sort by class**: every item from Axis is tagged with its class; manual items can be assigned to a class
 - **Organization options**: color per class, filters (class, due date, priority, done/not done), sorting, custom tags, search
 - **Personal items**: add tasks and events that are not from Axis (clubs, sports, jobs)
 - **Reminders**: notifications before due dates (configurable)
 - **Sync across devices**: data saved to the cloud so the same planner shows up everywhere

### Stretch Features
 - Offline mode with sync when back online
 - Dark mode and themes
 - Recurring tasks/events
 - Breaking big assignments into subtasks
 - Time estimates and a "what should I work on now" suggestion
 - Grade view pulled from Axis

### Theming
 - Subtle duck theming throughout the project (e.g. a small duck logo/app icon, duck-inspired accent colors, light touches in empty states and loading screens) — present but never distracting from the planner itself

### Proposed Tech Stack (open for discussion)
 - **Language**: TypeScript
 - **App (web + iOS + Android)**: React Native with Expo (Expo Router, react-native-web for the web build)
 - **Desktop (macOS / Windows / Linux)**: wrap the web build with Tauri or Electron
 - **Backend / database / auth**: Supabase (Postgres, auth, row-level security) or Firebase
 - **Axis integration**: server-side function that talks to Axis so credentials/tokens never live in the client
 - **Version control**: GitHub, feature branches + pull requests, at least one teammate reviews each PR

### Data Model (draft)
 - **User**: id, name, email, Axis account link, settings
 - **Class**: id, user_id, name, teacher, period, color, axis_id
 - **Item**: id, user_id, class_id (optional), type (assignment / test / task / event), title, notes, independent due date/time, optional scheduled work start/end or duration, priority, tags, completed, source (axis / manual), axis_id
 - **Reminder**: id, item_id, time

### Open Questions
 - What does Axis offer for integration — a public API, an export (iCal/CSV), or nothing? Do we need school/IT permission? This decides how Phase 2 works. 
    - We know that it offers iCal, we are not sure if it has an API
 - If there is no API: fall back to an iCal feed import or manual entry until access is figured out.
 - Supabase or Firebase?
  - Supabase
 - Tauri or Electron for desktop (or skip desktop until later)?
  -Electron

### Milestones
 1. **Phase 0 — Setup**
    - Agree on tech stack and answer the Axis question
    - Create the Expo project, linting/formatting, folder structure
    - Set up the backend project and auth
 2. **Phase 1 — Planner without Axis (MVP)**
    - Sign up / log in
    - Create, edit, delete, and complete tasks and events manually
    - Create classes with colors and assign items to them
    - Task list view with filters and sorting
    - Calendar view (week + month)
 3. **Phase 2 — Axis integration**
    - Connect an Axis account
    - Import classes and assignments, auto-tag by class
    - Scheduled re-sync without creating duplicates (match on axis_id)
 4. **Phase 3 — Polish and platforms**
    - Reminders / push notifications
    - Search, tags, and more organization options
    - Test and publish the web build; build iOS/Android with Expo; desktop wrapper
 5. **Phase 4 — Stretch features** (as time allows)

### Suggested Roles (change as needed)
 - **Michael**: project setup, backend, auth, data model
 - **Bobby**: Axis integration and sync logic
 - **Priya**: UI/UX — calendar and task list views, design, theming
 - **Everyone**: testing, code review, updating this file

## Progress
 - 2026-10-23: Wrote the initial project plan above (features, tech stack, data model, open questions, milestones, roles).
 - 2026-10-23: Named the project DuckPlan and added a Theming section calling for subtle duck theming throughout.
 - 2026-10-23: Added a responsive DuckPlan coming-soon page and Netlify configuration, then deployed it publicly at https://duckplan-mbp.netlify.app. The placeholder lives in `landing/` and can be replaced by the Expo web build later.
 - 2026-10-24: Replaced the generic duck emoji with an original white-and-yellow cartoon DuckPlan mascot, added it as the favicon and page accent, and disabled the public Powered by Netlify badge.
 - 2026-10-24: Redrew the mascot from user-provided duck meme references as a tall white duck with sunglasses, orange bill and feet, loose cartoon linework, and a confident pose; kept the previous mascot asset for rollback.
 - 2026-10-24: Created and published a sunglasses-free v3 of the tall DuckPlan mascot while preserving the v2 artwork for rollback.
 - 2026-10-24: Approved the refined v8 DuckPlan mascot with bead-like duck eyes, a confident temple-pointing pose, improved proportions, and a transparent background; updated the landing page and favicon to use it.
 - 2026-10-24: Built the first interactive DuckPlan website draft from the project plan, including Today, Calendar, Tasks, Classes, and Settings views; responsive layouts; class-based organization; task filters, search, completion, local task creation, and clear prototype states for Axis integration.
 - 2026-10-24: Rethemed the interactive DuckPlan draft around a yellow-and-white visual system, using dark ink for accessible contrast while retaining class colors for organization.
 - 2026-10-24: Refined the responsive web prototype using Apple Human Interface Guidelines: clearer visual hierarchy, system typography, larger readable labels, 44px-class touch targets, semantic selected states, restrained materials, and adaptive sidebar-to-tab-bar navigation on phones.
 - 2026-10-24: Applied Apple material guidance to DuckPlan: regular translucent materials now distinguish navigation and controls from opaque content surfaces, with stronger contrast, restrained blur, reduced-transparency support, and solid fallbacks for browsers without backdrop filtering.
 - 2026-10-24: Strengthened the web material treatment after visual review by lowering control-layer opacity, adding visible color behind the glass, increasing blur and saturation, and adding bright edge highlights while keeping content surfaces opaque and readable.
 - 2026-10-24: Refined the New Task dialog into a distinct thick-material sheet: the form now carries the translucent blurred surface, inputs use a more opaque control fill for legibility, and the dimmed backdrop preserves page context.
 - 2026-10-24: Added a project-wide button interaction rule requiring distinct hover, pressed/click, keyboard-focus, disabled, and reduced-motion behavior for every button-like control.
 - 2026-10-24: Applied the button interaction rule to the current web prototype with project-wide pressed feedback and disabled behavior, plus tailored hover responses for navigation, primary controls, text actions, filters, profile controls, and icon buttons.
 - 2026-10-24: Created a reusable DuckPlan duck-down button material informed by Apple HIG material and motion guidance: fine feather fibers follow pointer or swipe direction, compress locally at the press point, recover with damped motion, preserve label contrast, support keyboard activation, and stop moving when reduced motion is enabled.
 - 2026-10-24: Replaced the illustrated button fibers with an original photorealistic top-down warm-ivory animal-fur texture, then added a masked duplicate texture at the pointer to simulate local flattening and darkened compression when pressed.
 - 2026-10-24: Refined the button material into ultra-short, dense, end-on duck down in the mascot's ivory-white and pale buttery-yellow palette, preserving the existing pointer-follow and local press-compression behavior.
 - 2026-10-25: Rebuilt the button material as a procedural WebGL2 strand system with localized velocity-based brushing, spring-damper recovery, geometry-driven press compression, depth-aware shading, quality levels, settled/offscreen pausing, context-loss and static fallbacks, reduced-motion behavior, and selective primary-button integration. Added an adjustable standalone material lab for visual and performance validation.
 - 2026-10-25: Increased procedural strand density several-fold across all quality levels, raising the inspection surface to 30,000 fibers and production controls to a much denser area-scaled profile so the resting material reads as continuous duck down rather than separated points.
 - 2026-10-25: Removed whole-control scaling and brightness changes from pressed fur surfaces so the panel stays stationary and all tactile feedback comes from localized strand compression and bending.
 - 2026-10-25: Strengthened the stationary fur-surface rule across hover and press states, and added an immediate pointer-down imprint so fibers visibly compress at contact before continuing through spring-based motion and recovery.
 - 2026-10-25: Added a local-first release rule requiring website changes to be previewed and explicitly approved locally before any public deployment.
 - 2026-10-25: Added a configurable 0–1,200 ms fur recovery delay, defaulting to 300 ms, so pressed fibers linger briefly before springing back; prepared the change for local approval only.
 - 2026-10-25: Extended the local fur recovery-delay control to 2,000 ms so longer press impressions can be tested before publication approval.
 - 2026-10-25: Replaced point-sampled brushing with continuous swept-segment interaction and stored per-fiber press targets so quick mouse movement cannot miss the middle of the trail, and the whole pressed path respects the recovery delay.
 - 2026-10-25: Retuned fur recovery as an overdamped motion with a 450 ms default linger, slower progressive lift, and little to no springy rebound; preserved the adjustable 0–2,000 ms recovery-delay range for local testing.
 - 2026-10-25: Extended the fur impression to linger for 2 seconds by default, with a locally adjustable recovery delay up to 5 seconds before the smooth overdamped lift begins.
 - 2026-10-25: Applied the recovery delay to hover-brushed trails as well as pressed drags, and refined click deformation into a deeply compressed center with an outward-splayed surrounding ring.
 - 2026-10-25: Refined the fur model from real down and hairy-surface mechanics: broader near-flat contact matting, stronger bent transition fibers, darker compressed roots, and friction-inspired staggered recovery across neighboring strands.
 - 2026-10-25: Rebuilt production fur buttons as fur-only silhouettes with no painted border or background: longer outward edge strands define the pill shape and darker masked strands form the visible label text while preserving semantic HTML labels and keyboard focus.
 - 2026-10-26: Sharpened fur-built button lettering at production size by increasing silhouette density, shortening and aligning dark label strands, and tightening the glyph mask so words remain distinctly readable without painted text.
 - 2026-10-26: Promoted the locally approved Duck-Plan-Test fur-button model into the main DuckPlan website. Primary and dark action buttons now use the tested WebGL2 renderer with the saved 0.80× label length and 0.90× label width, smooth free perimeter, signed-distance fur lettering, localized press depth, continuous brush trails, per-fiber recovery, accessibility-preserving HTML controls, and static/reduced-motion fallbacks. Integration remains local pending review; no public deployment was made.
 - 2026-10-26: Expanded the approved fur-button model into a local all-buttons experiment across navigation, icon, text, filter, secondary, profile, calendar, modal, and dynamically rendered class-menu buttons. Per-control label normalization keeps short visible titles or symbols in the fur lettering while the native HTML button continues to own its accessible name and behavior. Only the current visible control set retains WebGL surfaces; hidden views release their contexts, and an open modal temporarily owns the renderers while its inert background releases them. This prevents the all-button treatment from exhausting browser resources on desktop or mobile. No public deployment was made.
 - 2026-10-26: Narrowed the website fur treatment after local review so it applies only to text-only native buttons. Navigation, icon, arrow, counter, avatar, notification, close, and menu-symbol controls retain their standard UI; plain-label filters, actions, secondary controls, and modal buttons keep the approved interactive fur. Visibility-aware renderer cleanup remains in place. No public deployment was made.
 - 2026-10-26: Reduced the production fur-button interaction radius exactly fivefold, from 64 px to 12.8 px, so hover and press deformation stays tightly localized. The Fur Lab remains independently tunable, and no public deployment was made.
 - 2026-10-26: Split the fur interaction radius into separate hover and click behavior. Production hover brushing remains tightly localized at 12.8 px, while click, keyboard activation, and pressed dragging use a 38.4 px radius—exactly three times larger. The renderer falls back to the normal radius when no press radius is configured, preserving the Fur Lab's independent single-radius tuning. No public deployment was made.
 - 2026-10-26: Added the primary “Add task” control as an explicit exception to the text-only fur-button rule. Its decorative plus and accessible name remain in the semantic HTML, while the visible fur lettering reads “Add task”; other icon-containing controls remain standard. No public deployment was made.
 - 2026-10-26: Expanded the project-wide interaction rule so every enabled button, regardless of material, must have distinct hover, held-press, and post-release feedback with keyboard, disabled, and reduced-motion equivalents. Added a shared interaction module to the planner and Fur Lab so static, dynamically rendered, and anchor-based standard controls rebound after release, while fur controls keep localized brushing, compression, and strand recovery. No public deployment was made.
 - 2026-10-27: Promoted the locally reviewed DuckPlan website work from `codex/netlify-placeholder` to the repository's `main` branch as a clean fast-forward, including the planner prototype, approved mascot, Apple-inspired material system, interactive fur controls, and three-stage button interaction rule. This GitHub promotion did not deploy or update the public Netlify site.
 - 2026-10-28: Synchronized the canonical GitHub `main` source into the separate `Duck-Plan-Test` repository for Chat Check and external project review, while preserving the test repository's dedicated Chat Check rule and excluding unrelated untracked mascot drafts. No public deployment was made.
 - 2026-10-28: Rebuilt the `Duck-Plan-Test` homepage as a unified task-first workspace. Home now pairs a date-synchronized daily plan with functional Day, Week, and Month calendar modes; desktop defaults to Week and phone layouts default to Day. Calendar date selection updates the task panel, scheduled blocks and deadline markers are visually distinct, overlapping work uses lanes, empty time slots prefill the task sheet, and task/calendar selections stay linked.
 - 2026-10-28: Split task deadlines from scheduled work in the local data model. Existing localStorage data migrates without turning old due times into work sessions, while the expanded create/edit sheet supports independent due date/time, scheduled date/time, duration, completion, and deletion. Added local-time date helpers, midnight/focus refresh, overdue/scheduled/unscheduled/completed groupings, and automated migration/calendar tests.
 - 2026-10-28: Verified the unified planner locally at desktop and 390 px mobile widths, including date synchronization, Day/Week/Month switching, empty-slot creation, task completion updating the calendar, responsive task-first stacking, and the approved fur controls. All 17 Node tests pass, JavaScript syntax checks pass, and no public deployment was made. Axis sync, authentication, cloud persistence, notifications, and drag-and-drop scheduling remain intentionally unimplemented; drag-and-drop is deferred until a reliable accessible interaction can be built.
 - 2026-10-28: Removed the persistent sidebar from the default unified Home layout. Navigation now opens as an accessible off-canvas drawer from the compact header, closes after navigation, by backdrop click, close control, or Escape, and keeps the planning workspace full-width by default on desktop and mobile. This remains local-only pending approval.
 - 2026-10-28: Simplified Home into a clean, full-viewport planning surface where Tasks and Calendar are the only primary panels. Removed the separate page header and summary layer from the default view, moved the selected date, completion summary, and task creation into the Tasks panel, retained only a compact floating navigation trigger, and made both panels fill the available desktop viewport together. This remains local-only pending approval.
 - 2026-10-28: Promoted the interactive duck-down fur renderer to the fundamental project-wide material for conventional buttons and button-like controls. Icon-only and icon-plus-text controls now form their symbols with the same animated fur mask as text labels, while dense repeated content controls such as calendar cells, time slots, task rows, and event blocks retain lightweight surfaces for performance and legibility. Drawer, modal, and view lifecycles continue to keep WebGL contexts limited to the active surface. This remains local-only pending approval.

