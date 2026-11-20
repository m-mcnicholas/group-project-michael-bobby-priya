# Shared GitHub release — November 20, 2026

The user requested this verified version on the main GitHub repository. The website is published on `main`; the corresponding portable native app uses [`codex/ios-main-release-20261120`](https://github.com/m-mcnicholas/group-project-michael-bobby-priya/tree/codex/ios-main-release-20261120), following the existing separate-bundle release convention.

## Source and integration

Website input: `fb93ff7ee96932ec9336c8beabc5f7857782b893` (application `c5b5aed`, cache v95). Shared main input: `7efdff7c4f0832c3655e871d91eedad3d20ea075`. The merge preserves the newer owner deployment guide and both planning histories. No website application file differs from the already verified input.

Native input: `8951ee601dd2f699e14865c68afe7b3b6eae0fd9`. The portable release retains its six web overlays and `native-cloud.js`; no native application/resource/config or landing content changes. Only personal development-team selections are cleared in the portable Xcode project; the existing local project retains its signing settings. The native API remains `https://duckplan-latest.ocs-learning.workers.dev/api`, as approved by the user. Original-server and new-site accounts/data are separate.

Latest separate deployment: [duckplan-latest.ocs-learning.workers.dev](https://duckplan-latest.ocs-learning.workers.dev/#calendar). This GitHub publication does not redeploy either Cloudflare server, migrate a database, rotate credentials or install the phone app. The original site's owner guide in `DEPLOYMENT.md` is retained.

## Verification

PASS:575 tests in the merged website and580 tests in the portable native release. Landing hashes are checked against all118 canonical website files. PASS:the portable Debug simulator app/widget build succeeds unsigned after signing fields are cleared; all119 bundled web files match the verified native app source. Results and source manifests are stored in this directory.

The unchanged application source reuses the exact-version live desktop/phone/iPad browser evidence under `docs/cloudflare-latest-20261119` and the actual native iOS27.2 WKWebView matrix under `docs/native-latest-20261119`:32 passed native mode runs (18 phone,14 iPad), with local/live-account feature checks, persisted templates/Schedule/unscheduled copies, due/work presentation, linked/manual alert preferences, account isolation and bidirectional foreground task-detail/alarm-time metadata sync. This bounded reuse is supported by full source hashes; it is not a new physical-device or background-delivery claim.

Physical installation/delivery/Stop/Snooze, APNs delivery, trusted OS drag-layer behavior and physical Safari/PWA remain NOT RUN or BLOCKED as documented. Free Personal Team background push remains disabled. A successful GitHub push/build does not update an installed phone or enable missing server capabilities.

## Install the native app

For GitHub downloads, check out the portable app branch linked above, open `ios/DuckPlan.xcodeproj`, choose your team and phone, then Run. `main/landing` serves the website; the native branch includes the required app-only transport overlays.

On this Mac, continue using `/Users/bobbyzhang/Documents/ChatGPT/Duck Plan/DuckPlan-iOS/ios/DuckPlan.xcodeproj`. It already contains the verified native web copy, new API and original signing settings. Do not copy the portable release's blank signing fields onto that existing project.
