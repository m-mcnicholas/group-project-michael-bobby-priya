# Staged glass popup — 2026-11-02

Implemented the user's approved approach: prepare the existing form ahead of activation, move a lightweight source-linked shell, then reveal the native fields at stable bounds. Local TEST only; the public site/shared repository is not changed.

## Behavior

The existing form already lives in HTML; this is rendering preparation, not a new network loader. Its layout is measured once while the closed dialog is invisible and non-modal, using requestIdleCallback with a bounded timer fallback. Preparation does not open the dialog, focus anything, reset form values or create an artificial loading screen. New viewport/font readiness schedules preparation again. Pending jobs are cancelled/skipped while a popup is active.

Opening uses cached dimensions, heading position and typography. An unusually early uncached click reserves a bounded responsive frame without synchronously measuring the hidden form. The native form scrolls within that frame. During shell movement the form has display:none and is inert/hidden to assistive navigation; focus stays on the named native dialog, which still supports Escape and backdrop dismissal. A click inside the shell does not count as a backdrop click.

Two lightweight, fixed corner silhouettes maintain source/window material continuity using transforms and complementary opacity. The title travels separately. No per-frame bounds, corner radius, shadow, blur or text-size properties animate. Source tint/gradient, action wording and actual starting pill shape remain. The full-screen backdrop is statically dimmed while moving; static glass blur is enabled only after geometry settles. The settled native form retains the yellow or neutral glass recipe.

At the end of shell travel, the already-existing native fields reveal at fixed bounds. Their full layout/paint is deliberately deferred until that point; warming layout does not pre-rasterize all GPU content. Once reveal finishes, title-field focus is applied only if the user has not already focused a control. Closing first resolves the content into the fixed shell, then returns the shell/title to the source. Source visibility is restored before native close/focus return.

Shared timing:240ms shell opening, then120ms content reveal;300ms closing contains60ms content-out followed by240ms shell return. A reversal during initial travel skips the field reveal. This is an intentional two-stage opening, not a claim that full form availability is faster than the old240ms combined transition. Reduced motion bypasses staging synchronously. Sidebar/page behavior and archived fur labs remain unchanged.

The frame stays fixed through reveal. A browser resize finishes pending movement, restores responsive native sizing for one measurement, then reserves the new frame. Fixed percentage form heights are disabled during that measurement to prevent overflow. Native dialog UA max-width/max-height were also overridden to match the intended14px horizontal/16px vertical margins; otherwise the browser silently clamped the shell's requested bounds by6–10px. Final phone measurement:362×812px, matching dialog and form exactly, no document overflow; desktop680×680.367px, also matching. Phone content scrolls inside the frame. The test requested a390×844 viewport; no physical phone/virtual keyboard claim is made.

## Verification

123 Node regressions pass. New/updated checks cover closed preparation without focus/reset, no hidden-form reads on a cold activation, shell-before-content ordering, transform/opacity-only keyframes, fixed reservation, close ordering/source restoration, Escape reversal without stale callbacks, cancellation during reveal, idle-job guards, resize settlement, restored bounds, reduced motion and profiler cleanup. Changed JS syntax and diff checks pass.

Browser checks: shell stage with form rendered height0; settled form/window identical size; deferred title focus; keyboard Enter/Escape during travel; source focus restored; edit identity and original values; inner-shell click remaining open; backdrop dismissal; resize during opening/closing and desktop↔phone while open; phone scrolling/no horizontal overflow; zero temporary layers after completion; no console warnings/errors. Test dialogs used Cancel only, preserving the user's planner data. Temporary benchmark pages were removed before handoff.

## Measurements and limits

Separate diagnosis copies replayed four synthetic open/Cancel cycles per version. The prior implementation was read from TEST HEAD before this change, without replacing working-tree source. Same default desktop browser, sequential runs with uncontrolled system load/cache; these are callback intervals, not compositor presentation FPS.

- `staged-prior-synthetic.json`:8 transitions, maximum callback gap26.2ms; prior opening completed in247.8–264.6ms.
- `staged-synthetic.json`:initial staged8-transition sample, maximum19.3ms. This predates the final typography/resize corrections.
- `staged-final-synthetic.json`:final8-transition sample, maximum21.3ms; no callback gaps over25ms or reported long frames. Geometry remained680×680.367px across shell, content and ready states. Content stage began245.7–260.4ms after activation; all fields finished resolving379.8–394.4ms after activation, including setup/callback overhead.
- `staged-real-input.json`:two trusted interactions before the final typography/resize correction. Opening first-update response88ms, handler6.5ms, post-handler80.6ms; closing48ms, handler2.1ms, post-handler45.5ms. Full opening420.2ms, closing326.2ms. These are single interactions, not a field INP score or an equivalent controlled comparison with the earlier160ms observation.

The prior version was also mostly smoothly paced in this session. These small samples do not establish a universal frame-rate improvement or eliminate browser/system scheduling stalls. The verified structural benefit is moving full-form layout/paint outside shell travel, with stable final bounds. First-use layer creation, static glass painting at handoff and host/system contention remain possible costs.

Method references: [web.dev animation properties guidance](https://web.dev/articles/animations-guide), [Chrome idle callback scheduling](https://developer.chrome.com/blog/using-requestidlecallback). Performance safeguards follow those principles; compositor-only execution is not guaranteed by an API/property name.

Screenshots: `staged-desktop.jpg`, `staged-phone.jpg` (settled appearance, not recordings). The isolated diagnosis observer now records stage/prepared/inline reservation fields without extra per-frame geometry reads. Its generator remains outside normal app imports; no diagnostic code is loaded by the planner.

Local review: http://127.0.0.1:4208/index.html#home . TEST feature-branch backup only; publication awaits explicit local approval.
