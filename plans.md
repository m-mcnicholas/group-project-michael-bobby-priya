# Plans and Discussion
## Procedures
Use the plans.md file as agents.md. This project is collaborative, so ALWAYS pull the agents.md file and check what has been done before beginning work, and ALWAYS record what you did in the agents.md file once finished, and ALWAYS push the agents.md file when work is being done.
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
 - **Item**: id, user_id, class_id (optional), type (assignment / test / task / event), title, notes, due/start/end time, priority, tags, completed, source (axis / manual), axis_id
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

