# Intermittent popup lag investigation — 2026-11-02

## Finding

Slow playback was reproduced after document readiness was `complete`, fonts were `loaded`, and no resource completion overlapped the animation. The first full-glass sample began about nine seconds after navigation. These observations do not support a page-download wait as the cause of those particular stalls. They do not rule out startup work on other devices or in other circumstances.

Long tasks of 50–200ms overlapped some initial test transitions. Their script attribution was unavailable. No long-animation-frame breakdown was delivered in these samples, despite the browser advertising support. We cannot assign those tasks to an exact function, GPU rasterization, garbage collection or another application. Browser automation and instrumentation are additional possible sources of interference. Do not claim a single proven root cause or that all stalls are fixed.

## Comparisons

Same local desktop in-app browser, default1176×766 viewport, button activation through browser automation, no CPU/network throttling. Bounded sequential opening/Cancel cycles; page tasks were preserved. Callback gaps are not compositor presentation timestamps, and runs are not randomized or load-controlled.

- `profile-blur.jsonl`:10 full-glass transitions;13 callback gaps over25ms, max117.4ms. Opening setup6.9–15.1ms.
- `profile-no-blur.jsonl`:10 diagnostic no-popup-blur transitions;2 gaps over25ms, max49.6ms. This reduced many gaps, but did not remove them or isolate blur as the sole cause.
- `profile-single-glass.jsonl`:10 diagnostic single20px-panel-blur transitions;8 gaps over25ms, max67ms, one completion tail171.6ms. Not promoted because the result did not justify changing the approved glass appearance.
- `profile-scoped-setup.jsonl`:8 transitions after the setup change, with the visible diagnostic output still present. Max callback gap50.1ms and one completion tail89.3ms. Stalls were still possible.
- `profile-final.jsonl`:6 transitions with scoped setup, batched geometry reads and a hidden diagnostic output. Maximum callback gap17.1ms, no gaps over25ms; completion tails16.9–17.1ms. Opening setup7.0ms on first use and4.4ms on both subsequent uses; closing setup1.5–1.7ms. This short final sample is encouraging, not proof of a universal performance improvement or hitch-free operation.

The first two files predate completion-tail logging. Later `completionTailMs` records time from the last sampled callback to animation completion, so a delayed completion is not silently excluded from analysis. It is not itself a presentation-frame timestamp.

## Targeted changes

The existing popup lifecycle reapplied button material to the whole document on open/close:174 candidate controls in the observed page, including calendar slots. It now scopes that work to the dialog's four controls. Cache the final radius/font before temporary DOM writes and finish label measurement before starting the surface animation. Preserve the full glass filters/tint, native crisp content, source-origin geometry,240/300ms timing and sidebar behavior. Final keyboard verification found that the close callback attempted focus restoration before proxy cleanup made the source visible. Cleanup now precedes the callback; browser Enter/Escape verification returns focus to `plan-selected-date` with zero temporary layers. The regression checks source visibility and layer removal inside the close callback.

The local `?motionAudit=1` profiler now records readiness, resource completions, setup phases, callback gaps, completion tail and available long-task/frame attribution. Records are held in a hidden `#motion-audit` output (last24 transitions), avoiding a growing visible JSON display under the blurred backdrop. The normal page creates no audit RAF, observer or output. The hidden audit output change improves the measurement setup; it is not a claim that the normal page previously had profiler overhead.

For explicit development comparisons only, append `&motionNoBlur=1` or `&motionLightGlass=1` to the audit URL. These have no effect without `motionAudit=1`; reload without the flags to restore full glass. Observers and RAF are released on completion/cancellation. See [Chrome's Long Animation Frames documentation](https://developer.chrome.com/docs/web-platform/long-animation-frames) for the50ms observation threshold and attribution limits. Absence of a long-task record does not imply every16.7ms deadline was met.

## Verification and next boundary

116 Node tests, JS syntax and whitespace checks passed. Added audit interruption/observer cleanup and normal-page no-observer/no-audit-RAF checks. Browser exercised repeated open/Cancel, keyboard Enter/Escape interruption, source restoration, zero temporary layers, and normal page without audit output. Local screenshot `profiled-popup.jpg` shows the glass appearance only. The six-transition timing file predates the final cleanup-order fix; its measurements describe animation setup/playback, not that subsequent focus fix. OS reduced motion and physical devices were not newly tested; existing mocked reduced-motion/resize checks pass.

The remaining intermittent main-thread stalls require a browser performance trace with script attribution (or a user-assisted slow-run capture) to diagnose conclusively. Do not substitute a shorter animation, removed glass, or artificial page-loading delay for that evidence.

Local review: http://127.0.0.1:4208/index.html#home . TEST feature-branch backup only; no public deployment/shared repository change.
