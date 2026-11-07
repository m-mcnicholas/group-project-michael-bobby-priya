# Apple motion review — 2026-11-02

The user reported lag in the button-to-window transition. Research used Apple developer pages and video transcripts; no native animation timing was inferred from a slowed demonstration.

## Apple references

- [WWDC25: Build a UIKit app with the new design, Presentations at 13:31](https://developer.apple.com/videos/play/wwdc2025/284/?time=811): originating glass buttons morph into presentations. Use a stable source view to connect opening and dismissal visually.
- [Enhancing your app with fluid transitions](https://developer.apple.com/documentation/uikit/enhancing-your-app-with-fluid-transitions): UIKit zoom supports continuous interaction, including stopping, slowing and reversing. Our web morph preserves interruption/reversal, but does not implement UIKit's gesture-scrubbing API.
- [WWDC24: Enhance your UI animations and transitions](https://developer.apple.com/videos/play/wwdc2024/10145/): source-to-destination continuity; the transcript explicitly says examples are slowed to half speed. No universal Apple duration was established.
- [Understanding hitches in your app](https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app): frames must meet roughly 16.7 ms at 60 Hz or 8.3 ms at 120 Hz. A smooth easing curve alone cannot prevent missed frames.
- [WebKit: How Web Content Can Affect Power Usage](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/): prefer animation properties that avoid repeated layout/painting. This is the browser implementation reference, not evidence of Apple's private Liquid Glass renderer.

## Changes

Previous geometry animated left/top/width/height and label font size, with a moving 18px backdrop blur and animated shadow. The form stayed invisible until 55% of the 240ms opening (132ms), contributing to perceived delay even when callbacks were regularly paced.

The revised surface has one destination-sized layout and uses translation/scaling to travel from the launcher. The label has a separate fixed layout and uniform transform, avoiding stretching the native form text. Removed moving backdrop blur and shadow interpolation; the settled native form retains its glass material. Corner radius still animates and may repaint, so this is not an entirely compositor-only animation.

Content now begins resolving at 28% (67.2ms). The proxy title hands off to the native heading during the motion. Existing 240ms opening/300ms closing, monotonic damped response, source tint/title, keyboard/focus, Escape, interrupted reversal, resize cleanup and reduced-motion bypass remain. Sidebar animation was not changed.

## Measurements and limits

An opt-in `?motionAudit=1` sampler records requestAnimationFrame callback gaps during the morph. It has no sampling loop or output in the normal planner. These are small browser samples, not compositor presentation timestamps, FPS proof, native Instruments hitch ratios or a controlled benchmark. Sequential runs have uncontrolled caching/system load; wall time includes setup and callback completion, not just the configured animation duration.

Default browser viewport was 1176×766. The four baseline runs had median gaps around 16.7ms, maximum 17.6ms and no gaps above 25ms. The four refined runs had similar warm pacing: the first opening had three gaps above 25ms, maximum 34ms; the subsequent three runs had maximum 17.5ms or less. The cause of the first-run hitch is not diagnosed. **A frame-rate improvement or native-level smoothness is not proven.** The concrete improvements are less per-frame layout/blur work and earlier content visibility.

At a 390×844 viewport in the same desktop browser, opening/closing had median 16.7ms and maxima 16.8/16.7ms; no horizontal document overflow. This is not physical phone hardware or 120Hz validation.

Raw samples: `morph-baseline-timing.jsonl`, `morph-refined-timing.jsonl`, `morph-phone-timing.jsonl`. Screenshot: `apple-fluid-popout.jpg` (settled appearance only; not motion proof).

114 Node tests passed, including fixed-layout morph, no moving blur/text-size animation, early native content, deferred close, interruption, source restoration, reduced motion and resize. JavaScript syntax and diff checks passed. Browser checked desktop/phone opening and Cancel, Escape during opening, restored source, zero temporary surface/label nodes after dismissal, no audit output on the normal page and no console warnings/errors. Phone override reset afterward. User visual approval and broader cold/device performance evaluation remain pending.

Local review: http://127.0.0.1:4208/index.html#home . TEST feature branch backup only; no public deployment or shared repository changes.
