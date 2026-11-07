# Rounded popup return — 2026-11-02

**Superseded:** the user found a vertical dip in this separate closing path. See [the shared reverse-path correction](reverse-close-review.md). The original held-frame and terminal checks below did not establish a smooth trajectory.

The previous return shrank a full-size rounded panel nonuniformly into a short button. Its corner radius became vertically compressed; the button-shaped paint did not take over until late in wall-clock time. Linear width/height interpolation also kept the panel nearly square until late in travel.

The moving shell now has nine reusable clipped paint pieces. Corners scale uniformly; edge bands and center fill the changing rectangle. Closing uses 33 precomputed transform keyframes: geometric size interpolation, linear center travel, and shared damped timing. The label follows that same rectangle and ends with the launcher's original caption/icon. Original button paint resolves at matching geometry. Unblurred background dimming fades during shell travel. Internal half-pixel overlaps plus an opaque neutral backing prevent cracks/doubled translucency; moving tint/highlights remain source-derived, while full native glass returns at settled bounds. This adds nine transform layers; it is not a new renderer or per-frame JavaScript solver.

The existing native-content staging remains: opening240ms shell +120ms fields; closing60ms fields +240ms shell. Native semantics, reduced motion, interruption, focus and cleanup are retained. Sidebar/page navigation and archived fur are unchanged. Opening still uses direct transform interpolation; closing uses the new proportion path rather than its exact mathematical inverse.

Browser validation caught a native DOMRect mismatch: spreading a prototype-backed rectangle omitted its dimensions, producing invalid closing transforms. Explicit dimension copying fixes it; a prototype-backed rectangle regression test now covers it. A missing-radius fallback is also guarded.

## Evidence

- `rounded-close-mid.jpg`: deliberately paused at20% of the240ms shell return, using the shared easing. The visible rectangle is already oblong with round corners and its label remains inside. This is a held pose, not a real-time recording.
- `rounded-close-end.jpg` and `rounded-close-target.json`: held at99%, viewport1280×720. Shell100.2321×38.0122 versus real button100.2109×38; positions within0.023px. Four corner transforms have matching X/Y scales. The real source is still hidden at this pose.
- `rounded-close-timing.json`: eight separate natural transitions, four open/four close, diagnosis-only copy. Maximum sampled callback gap20.1ms; no overlapping resource completions. Instrumentation, host scheduling and this small sample limit conclusions: no universal lag-elimination claim.
- Normal planner: open/Cancel, Enter/Escape interruption, restored launcher focus, zero residual temporary layers, no horizontal overflow or console warnings/errors.
- 128 tests pass, including corner/edge continuity, gradual proportions, terminal geometry, caption, reversal and native rectangle handling. JS syntax and diff checks pass.

The optional `holdClosing` helper is confined to the disposable diagnosis copy. Scratch runtime files were removed after inspection; normal planner has no held-frame observer. Local review: http://127.0.0.1:4208/index.html#home . TEST feature-branch backup only; no public deployment or shared repository change.
