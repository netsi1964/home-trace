# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Phase 3: offline app shell (service worker, never caches API or data), offline notice, recovery of interrupted jobs, storage-full handling, focus management and 44 px hit areas on image badges, layouts checked at 360 px.
- Phase 2: private analysis proxy with an invite code, a signed cookie, per-job and daily request limits (Netlify Blobs), live discovery and identity proposals, and a consent notice before the first analysis.
- Phase 1: rooms and viewpoints, camera with clean snapshots, review with Same object? Yes / No / Skip, inventory with merge and undo, comparison statuses, and ZIP export/import with validation, in four languages, with Demo detections.
- Netlify hosting: `@sveltejs/adapter-netlify` replaces `adapter-node`; `netlify.toml` with noindex and camera-only permissions headers.
- GitHub Pages feature tour (`site/index.html`, published by `.github/workflows/pages.yml`).
- Vision-LLM detector for Phase 0 (`--provider vision` and `vision-jev`), Qwen3-VL by default via
  OpenRouter, with JEV as optional presence checker. `.env.example` documents the keys.
- SvelteKit 3 app on adapter-node with HomeTrace SVG favicon and typed i18n (en, da, es, zh).
- Phase 0: verified JEV contract (`docs/jev-contract.md`), JEV adapter via OpenRouter with hard
  request budgets and no automatic retry, evaluation harness (`npm run eval`), annotation tool
  (`/phase0/annotate`) and synthetic Demo fixtures.
- PRD v1.3: SvelteKit on Node instead of a static SPA; session URLs are same-device deep links.
- PRD v1.1 in `development/PRD.md`.
- Repo scaffolding: licence, contributor and security docs, AI-agent instructions, CI.
