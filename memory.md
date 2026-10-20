# memory.md — home-trace

Durable decisions and context for AI agents working in this repo. Keep it short: it is imported into
every session. Put rules in `AGENTS.md` and requirements in `development/PRD.md`, not here.

## Decisions

- Name: HomeTrace. Repo: `home-trace` (the PRD suggested `hometrace`).
- License: Apache-2.0.
- Language: English everywhere, UI strings kept separate for later localisation.
- Platform: responsive web app, phone first. No account, data on device, ZIP export.
- AI: JEV Images where measured capability supports it. The user confirms every identity match.
- Sten is the first prototype tester and is colour-blind.

## Where we stopped

- 2026-10-19: PRD v1.3. SvelteKit scaffold, JEV contract verified via OpenRouter (`typesafe/jev-1.14`),
  Phase 0 harness (`npm run eval`), annotation tool (`/phase0/annotate`), synthetic Demo fixtures.
- Demo findings: JEV has no multi-box answer; count-then-locate plus per-strip locating for repeats works
  on drawings; identity judged 3 of 5 lookalike pairs "same". See `docs/jev-contract.md`.
- 2026-10-20: Sten asked for a vision-LLM detector next to JEV. `vision` / `vision-jev` providers built;
  on Demo drawings Qwen3-VL found 19/19 without a category list but is 5–10× slower (see `docs/vision-contract.md`).
- Next: Sten takes ≥ 12 real photos, annotates, runs the live eval (`docs/phase0.md`). Then decide
  PRD-SEC-009 question 1 (JEV alone or extra detector) before Phase 1.

## Open questions

See "Decisions after the first technical evaluation" in `development/PRD.md` (PRD-SEC-009).
Stack: SvelteKit + TypeScript on adapter-node, confirmed 2026-10-19 (not a static SPA; the proxy needs a server route).
