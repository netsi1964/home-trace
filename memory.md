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

- 2026-10-19: PRD v1.1 imported and repo scaffolded. No implementation yet.
- Next: Phase 0 (JEV contract, fixtures with ground truth, evaluation gate).

## Open questions

See "Decisions after the first technical evaluation" in `development/PRD.md` (PRD-SEC-009).
Stack: SvelteKit + TypeScript on adapter-node, confirmed 2026-10-19 (not a static SPA; the proxy needs a server route).
