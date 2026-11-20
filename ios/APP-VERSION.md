# Current native app version

The website is on this repository’s `main` branch. The matching portable iPhone/iPad app is on [`codex/ios-main-release-20261120`](https://github.com/m-mcnicholas/group-project-michael-bobby-priya/tree/codex/ios-main-release-20261120).

The app release bundles website `fb93ff7` (application `c5b5aed`, cache v95), retaining six app-only web overlays and `native-cloud.js`. Its API is **https://duckplan-latest.ocs-learning.workers.dev/api**, using the new site’s separate accounts/data as explicitly selected. Existing original-server records and guest data were not deleted or migrated.

For a GitHub checkout, use the app branch, open `ios/DuckPlan.xcodeproj`, select your development team and connected device, then Run. Portable signing selections are blank. On this Mac, the existing `DuckPlan-iOS/ios/DuckPlan.xcodeproj` retains its original signing settings and verified native files; keep using that project.

Verification: both original unsigned builds, all119 web-file bundle checks,580 Node tests and32 actual iPhone/iPad WKWebView mode runs passed. The portable project is also compiled after clearing personal signing fields. Details: `docs/main-release-20261120/README.md` and `docs/native-latest-20261119/README.md`.

A GitHub push/build does not install the physical phone. Free Personal Team closed-app APNs sync remains unavailable; native alarm/notification physical delivery is a separate check.
