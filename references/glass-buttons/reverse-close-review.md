# Retrace opening on close — 2026-11-02

The user identified a vertical dip in the previous rounded-return implementation. The prior center-plus-geometric-size path (`0ee548b`) moved the top edge down during early shrinking and then back up to the launcher. Rounded held poses and terminal alignment did not establish a good trajectory; the earlier review missed that defect.

Removed that separate33-frame path and its live frame reconstruction. A single `travel` function now uses the same two transform endpoints for each of the nine corner/edge/center pieces, source paint and title. Opening uses small→full; closing uses full→small. Both consume the same monotonic damped easing. This reverses the spatial path with the same settling response in each direction; it does not play the entire easing clock backward. Closing still resolves native content for60ms before240ms shell travel; opening still reveals native content after240ms travel over120ms. Interrupted motion starts from captured live transforms. Circular corner scaling, matching material/caption, cleanup, native semantics, focus and reduced-motion bypass remain.

Validation:

- 128 tests pass. A regression compares every closing corner/source/title transform pair with the opening pair in reversed order. Existing continuity, interruption, source restoration and reduced-motion tests remain.
- `reverse-close-geometry.json`: diagnosis-only natural playback, four opens/four closes,1280×720. Every closing trace has15 shell samples: top moves monotonically19.8125→approximately32.993px; no reversal (previous held20% top was about122px). Opening follows the opposite direction. Small source press/release offsets can change the measured launch rectangle by fractions of a pixel between activations.
- `reverse-close-mid.jpg`: deliberately paused at20% of shell time to inspect round corners and continuous material. A held screenshot alone does not prove the trajectory; use the trace and local playback.
- Normal preview open/Cancel and Enter/Escape interruption leave zero temporary layers and restore focus to `plan-selected-date`; no console warnings/errors.
- JS syntax and diff checks pass. No new frame-rate claims; geometric sampling intentionally reads layout only in the disposable diagnostic copy.

The `geometry=1` trace is opt-in and absent from the normal planner. Generated diagnosis files were removed after use. Local review: http://127.0.0.1:4208/index.html#home . TEST feature-branch backup only; no public deployment or shared repository modification.
