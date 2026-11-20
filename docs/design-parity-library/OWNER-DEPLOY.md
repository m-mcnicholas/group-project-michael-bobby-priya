# Owner deployment handoff

Use the current [repository-root deployment guide](../../DEPLOYMENT.md). It records the confirmed old hosted release, Cloudflare database-access blocker, exact owner commands, expected main-release versions and verification steps.

Deploy from this repository's `main` into the existing Worker and database. Main contains the required backend and migrations through0008; the separate native fallback branch is not required to enable server templates. The guide distinguishes main's version67 website from the newer version68 native fallback, and explains how to update an installed phone separately.

The original source archive and this documentation are preparation only. No production migration, public deployment or physical-phone installation was performed when preparing them. Preserve existing accounts, data, bindings, secrets and API origin.
