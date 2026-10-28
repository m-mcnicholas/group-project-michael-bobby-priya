# DuckPlan ChatGPT Site

Site: https://duckplan-mbp.weitaoyu448.chatgpt.site

The existing planner and fur lab are hosted together. The initial deployment is private to the owner; public access requires a separate access update.

## Preparing an update

Run `node scripts/prepare-sites.mjs` from the repository root to copy the current `landing/` assets into `dist/`. The tracked `.openai/hosting.json` preserves the existing Site identity. Reuse this Site for updates; do not register a replacement.

Use the Sites publishing workflow to synchronize the exact source, package `dist/`, and deploy the saved version. GitHub pushes alone do not deploy the ChatGPT Site.

Planner data is stored in each browser. Existing Netlify browser data does not automatically move to the new origin.
