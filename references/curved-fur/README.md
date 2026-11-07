# Experimental curved fur comparison — 2026-10-30

Local preview: http://127.0.0.1:4206/fur-physics-lab.html

**Gate result: retain the approved renderer.** This is an implemented, measurable experiment, not a demonstrated realism improvement or a rollout approval. Actual-size curvature is subtle. The four-surface synchronized harness stalls badly, including on A's unchanged spring simulation. These recordings preserve the stalls; they are not retimed demonstrations.

## What Blender contributed

The previous reduced spring study reproduced the existing spring response; it was not independent evidence of animal realism. Appearance renders supplied color/lighting references. The useful new input was the independent rooted contact probe in the live Blender reference scene: object `Rooted contact probe — segment constraints`, shape key `Contact frame 18`, representative fiber 35. We read its five centerline nodes without changing the user's scene. The extracted points and fit are in `../blender/strand-shape-reference.json`.

The lateral profile fits `t² × (k + (1−k)t)`, k = 3.78113472. Browser curvature blends from root-stiff k=.38 toward that fit with compression. This transfers a constrained strand's curved shape into the actual WebGL renderer, rather than importing a static mesh. It does not transfer a full Blender dynamics/contact solver; the native per-fiber spring still drives displacement. One strand at one contact frame is not biological calibration.

## Implementation and scope

A keeps one straight quad (6 vertices). B has three ribbon segments (18 vertices), fixed root, two intermediate points, pressure-dependent centerline/tangent and the existing root-owned glyph colors. At rest B collapses redundant sections into A's quad; subdivision opens smoothly with deformation. Actual browser readback of both inspection surfaces and production labels returned **0.000 / 255 RMSE** after reset. This protects the approved resting interpolation and silhouette.

Optional combing memory and neighborhood compression use a bounded 32×16 field, not pairwise collisions. Directional stroke goals persist through the chosen hold and decay without rebound. The pressure field adds coherent central depression and surrounding compression on top of native outward splay. Variants are independently selectable. Each B surface adds 26,624 CPU bytes and 8,192 GPU texture bytes. It samples the field per vertex; this cost needs optimization before rollout. No density increase hides the geometry difference.

The separate wave preview passes the same pressure-dependent curve helper to the existing sheet timeline. It preserves shared click-origin growth, the 32-sector handoff, recovery obligations, dye and uniform flattening. Optional pile fields are **not propagated into the wave**. Source/crest shape correspondence and field handoff remain incomplete. No application-wide integration is enabled. The normal planner does not load the pile module or opt into segmented strands.

## Evidence

- `curvature-four-gestures.webm`: synchronized A/B center press, off-center press, slow and fast brushing, then recovery; curvature alone.
- `combined-four-gestures.webm`: same trace with both pile additions.
- `combing-slow-brush.webm`: isolated directional memory.
- `neighbors-center-press.webm`: isolated neighboring compression.
- `wave-baseline.webm` and `wave-curved.webm`: same viewport, source and destination setup, separate native runs. These are workspace composites; they exclude pre-first-frame preparation and are not OS recordings.
- `*-trace.json`: versioned normalized inputs, 180 ms press and 25 swept brush samples; 280 ms hold, fixed 120 Hz simulation. Press/brush coordinates scale to identical CSS-sized samples. A/B receive the same events within each fixed step. Simulation catch-up is capped at 100 ms per presented frame, so stalls can extend wall time. Video labels show simulation time.
- `held-comparison.jpg`: actual inspection surfaces and 208×44 production controls, plus an explicitly magnified representative geometry diagram.
- `desktop-metrics.json` and `mobile-width-metrics.json`: actual unrecorded fast-brush combined-variant runs. Mobile width is 390×844 in the same desktop browser, **not physical mobile hardware**. Browser viewport restored afterward.

The capture canvas uses actual CSS sizes, with no magnification of fur. Browser screenshots and videos include real rasterization. Diagrams magnify a sampled curve 14× and are not visual proof of improved fur.

## Measurements and interpretation

Both inspection samples have 5,200 fibers; each production control has 9,932 at the same medium quality/settings. Inspection submitted vertices: 31,200 A / 93,600 B. Representative maximum centerline deviation from a straight root-tip chord was .992 CSS px in the curvature-only sequence, 1.153 px in the combined sequence and 1.341 px in the desktop fast-brush run. Root displacement was 0.000 px. These measure changed geometry, not perceived softness.

Curvature-only recorded sequence: 44 FPS overall, max interval 133.3 ms, GPU inspection draw maxima 5.62 ms A / 7.28 ms B. Combined recorded sequence: 9 FPS, max interval 216.7 ms. Desktop unrecorded combined fast brush: 6 FPS, max interval 200 ms, pair simulation maxima 94.9/96.6 ms A/B, pair submission maxima .2/.2 ms, inspection GPU elapsed maxima 5.87/5.87 ms. Mobile-width run: 7 FPS, max interval 183.4 ms, pair simulation maxima 81.8/83.0 ms. Rebuild samples 1.2/1.3 ms. Inspection buffers/texture bytes 270,401/278,593. Metrics include four concurrently simulated surfaces and diagnostics, not an isolated production button; GPU times come from nonblocking disjoint queries and CPU submission times are reported separately. Maxima are not percentiles or proof of equal cost.

Wave baseline finished at 56 FPS / max37.2 ms; curved preview at 32 FPS / max153.4 ms in separate runs. Both finished at100%, with sharp native destination and zero temporary contexts/buffers/programs/textures/framebuffers. These sequential runs do not control thermal load or cache state. No performance pass is claimed, and no adaptive quality was applied to conceal stalls. The main CPU bottleneck in the comparison includes unchanged native simulation; tripled vertex cost and field texture reads add further GPU work. Contact-only tessellation or a dedicated active-region draw should be evaluated before any promotion.

## Verification and remaining gate

102 Node tests pass, including anchored endpoints, actual exported pressure profile, memory persistence/decay, bounded optional compression and deterministic traces. Changed JavaScript syntax and git whitespace checks pass. Real browser smoke checks: both WebGL modes compile; rest readback matches; B context loss produces fallback then restoration recreates WebGL; reset and resize interrupt replay; reduced motion gives zero displacement/curvature; keyboard controls remain semantic; both wave modes complete without console errors and release all temporary GPU resources.

Held frames and recordings show a geometric difference, but the dense top-down short pile still reads similarly at button size. There is no independent animal-fur validation, full contact collision, physical-device benchmark, or user visual preference approval. The enhanced mode therefore stays isolated. The approved renderer remains the default. Nothing was deployed or changed in the shared group repository.
