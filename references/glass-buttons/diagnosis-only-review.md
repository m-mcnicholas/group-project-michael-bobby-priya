# Popup lag: diagnosis only — 2026-11-02

The user requested diagnosis before further implementation. The normal planner's HTML, CSS, app, interaction and motion sources are unchanged from TEST commit4308d4b. No fix, material change or deployment is included in this investigation.

## What the stronger capture establishes

A real, browser-generated trusted click opening Add task produced a160ms click Event Timing duration: approximately2ms input delay,17ms event processing, and141ms remaining until the next reported paint. Closing produced168ms:1.7ms input delay,8.6ms processing, and157.7ms after processing. These are rounded single-event values from two interactions, not a site-wide INP score, not measured GPU time and not the full240/300ms animation duration. Source: `deep-real-input.json`.

The dominant measured delay in these interactions is **after the click handler returns**. It is not a slow network fetch or a long queue before the click handler starts. Document readiness was complete, fonts loaded and no resource completions overlapped either interaction. This does not prove exactly which rendering, compositor, host/browser scheduling or other post-handler work used that time. A renderer/compositor performance trace is still needed for that attribution.

The isolated initial baseline did expose one51.9ms long frame with a44.1ms TimerHandler callback, including33.4ms forced style/layout. Many other long frames had little or no attributed page script. The TimerHandler covered a timer-driven synthetic activation, so it is not a precise function-level stack trace identifying a particular app read as the cause. Source: `deep-baseline.json`.

A static-page control, with no dialog opened and no transition running, recorded149 callbacks over2.5seconds with one49.8ms gap. Its instrumented page callbacks had no recorded duration above2ms. This proves callback stalls can occur independently of an active popup; it does not prove which system component caused that stall. Source: `deep-idle.json`.

## Controlled component checks

These are separate diagnosis-only appearances, not proposed UI changes. Each automated case uses four timer-driven open/Cancel cycles, with no repeated visibility/layout polling while the animation is running. Activations are synthetic and are labeled `trusted:false`; the two real-input interactions above validate that slow response also occurs with trusted input. Case order and system load were not randomized or controlled, so differences are not a reliable optimization ranking.

- Baseline8 transitions: maximum callback gap102.1ms.
- Popup blur disabled,8 transitions: maximum194.2ms. Stalls persisted; removing popup blur alone is insufficient. Background planner filters remain.
- Fixed proxy corners,8 transitions: maximum77.2ms. Changing corner interpolation alone is insufficient.
- Button release animations disabled,8 transitions: maximum54.1ms. Overlapping button feedback alone is insufficient.
- Moving proxy layers hidden/native content forced visible,8 transitions: maximum45.3ms. Opening callbacks were near16.7ms; closing repeatedly slowed toward30–40ms. This disables visible motion, not all Web Animation bookkeeping or native dialog lifecycle work.
- Closing inertness removed,8 transitions: maximum67.5ms. The close-time slowdown persisted, so removing inertness alone is unsupported as a fix. The experiment did not separately retain text-input focus.

Raw files are `deep-*-quiet.json`, plus `deep-baseline.json`. No component check eliminated all stalls. Claiming that blur, corners, inertness or button release is the single root cause would overstate the evidence.

## System environment

During the investigation, the8-core/16GiB Mac reported load averages89.73/45.54/26.74, later53.14/45.23/29.30, with roughly40–45% CPU idle in the snapshots. About5.7GiB was compressed and7,961MiB swap was used. A separate `memory_pressure -Q` returned43% system-wide memory free.

These indicate a busy environment and substantial memory footprint/history, but **not** proven instantaneous CPU saturation, critical memory pressure or active swap I/O during a given frame. They are period observations rather than synchronized per-frame attribution. System/host scheduling contention is a credible contributor, not an established sole cause. Only aggregate observations are retained in `system-observations.json`; process names/content are not included in the repository.

## Code findings: candidates, not proven root causes

- `landing/popup-motion.js` still inserts/styles proxy layers and then measures the title box before animation; this can force synchronous layout despite the earlier batching improvement. Source lookup, showModal and focus also require first-use browser work.
- `landing/button-interactions.js:26` deliberately reads offsetWidth between class writes to restart release feedback, another forced-layout candidate.
- The surface still animates borderRadius in addition to transform. Transform promotion does not make corner painting free.
- Glass includes a full-screen6px backdrop blur,36px form blur and12px control blur, plus shadows. The form opacity animation and corner animation can require paint/compositing work. These remain credible cost multipliers, but the no-popup-blur experiment shows they are not a sufficient explanation by themselves.
- The prior audit disconnected its observers at animation completion. The diagnosis copy instead keeps them alive past completion, which returned long-animation-frame details that the earlier audit missed. The earlier six healthy samples established neither a universal fix nor the absence of presentation delays.

## Best-supported diagnosis and next boundary

The measured bottleneck is predominantly **post-handler presentation latency**, with occasional synchronous-layout cost and a shared environment that can also stall a static page. The source of the remaining post-handler delay is not conclusively divided between page paint/compositing and browser/host/system scheduling. Reducing duration again, preloading an already loaded page or removing the approved glass based on these samples would be premature.

The next discriminating capture should be a browser main-thread/render/compositor trace on a slow trusted interaction, with contemporaneous system pressure, plus a direct standalone-browser comparison under similar load. Separate cold opening, warm opening and closing. Optimize the proven expensive phase rather than selecting another easing curve. No browser-debugging trace API was exposed by the connected in-app browser; this investigation used Web Performance observers and bounded diagnostic callback timing instead. No hidden browser/CDP interface was accessed.

## Reproduction and scope

The harness is archived as `popup-diagnosis.js`. Run `node references/glass-buttons/prepare-popup-diagnosis.cjs` to create a disposable copy beside the normal entry page. Open `http://127.0.0.1:4208/popup-diagnosis.html?case=baseline#home` for manual interaction, or add `&auto=1` for four synthetic cycles. For a static-page control use `?auto=1&idle=1#home`. Other cases: `no-blur`, `no-radius`, `no-release`, `no-motion`, `no-inert`. Records are in hidden output `#deep-diagnosis`; nothing is sent externally by the harness. Remove the two generated `landing/popup-diagnosis.*` files before publishing. They were removed at the end of this task.

This instrumented copy wraps selected event/RAF callbacks and records only callbacks above2ms; it adds overhead and cannot see isolated-world, GPU or host-native work. Results are diagnostic observations, not hardware-independent performance guarantees. Sources: [Chrome's long-frame attribution and limitations](https://developer.chrome.com/docs/web-platform/long-animation-frames), [web.dev's input/processing/presentation breakdown](https://web.dev/articles/optimize-inp).

Verification: diagnostic JS/generator syntax and diff checks; diagnostic HTML confirmed identical to current entry except the added harness script; real opening/Cancel checked, no console warnings/errors. Normal planner sources compared byte-for-byte with HEAD. No new product behavior means no repeated product test suite or claimed new performance fix. Local TEST evidence backup only; no shared repository or public deployment changes.
