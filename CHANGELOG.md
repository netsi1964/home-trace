# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
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
