# AGENTS.md — home-trace

Shared guidance for AI coding agents working in this repo (Claude Code, Codex, others).

## What this is

HomeTrace: a mobile-first web app that gives a home a visual memory. The user scans named viewpoints room by
room, confirms object identity (**Same object? Yes / No / Skip**), revisits viewpoints with a transparent
reference overlay, and exports everything as a portable ZIP. Data stays on the device.

**Status:** pre-alpha, Phase 0. JEV contract verified (`docs/jev-contract.md`), evaluation harness and annotation tool built. No app flow yet.

## Source of truth

`development/PRD.md` (English). Read the relevant `PRD-SEC-###` / `PRD-FEAT-###` before building.

- IDs are stable. Never renumber. New features take the next free `PRD-FEAT-###`. Test scenarios are `T01`–`T24`.
- Reference the ID in commits and PRs, e.g. `feat(PRD-FEAT-004): add same-object prompt`.
- Do not build outside the PRD scope. Follow the phase order: Phase 0 (validate JEV) before Phase 2 (integrate it).
- If the PRD is wrong or unclear, change the PRD in the same PR instead of silently diverging.

## Stack

- SvelteKit 3 + TypeScript on adapter-node (confirmed 2026-10-19), Svelte 5 runes, mobile-first. Node ≥ 22.17.
- IndexedDB through a typed repository (Dexie optional).
- getUserMedia, video, canvas and SVG overlays.
- JSON Schema or Zod with an explicit schema version.
- A small private server route as the JEV proxy. No server-side inventory database.
- Keep dependencies few and justify each one in the PR.

## Planned layout

| Path | Purpose |
|---|---|
| `development/` | PRD and other planning documents |
| `src/lib/geometry/` | Normalised boxes, validation, IoU |
| `src/lib/evaluation/` | Phase 0 ground truth, metrics, annotation draft |
| `src/lib/camera/` | Camera, clean frame capture, reference overlay |
| `src/lib/inventory/` | Rooms, viewpoints, objects, observations |
| `src/lib/matching/` | Identity proposals and user decisions |
| `src/lib/compare/` | Comparison statuses |
| `src/lib/storage/` | IndexedDB repository, drafts, recovery |
| `src/lib/archive/` | ZIP export/import and validation |
| `src/lib/providers/` | Provider adapters (`jev`, `vision`; demo lives in `scripts/`). Only place that knows a provider |
| `src/lib/i18n/` | UI strings, kept outside components |
| `src/routes/` | Screens and the private proxy route |
| `scripts/` | Node-only tools: `eval.ts`, demo fixture renderer. Run with Node type stripping |
| `fixtures/` | Demo images with ground truth, always labelled **Demo** |
| `private-fixtures/`, `eval-results/` | Real photos and their reports. Git-ignored, never committed |
| `docs/` | User and contributor documentation |
| `site/` | GitHub Pages feature tour, one self-contained HTML file. Mark unbuilt features **Planned**, demo numbers **Demo** |

## Commands

```
nvm use         # Node 24
npm run dev     # local dev server
npm run check   # type check
npm run lint    # svelte-check, warnings fail
npm test        # unit tests (vitest)
npm run eval    # Phase 0 evaluation, see docs/phase0.md. JEV runs need --confirm-paid
```

TypeScript uses `erasableSyntaxOnly` and explicit `.ts` import extensions so `scripts/` run directly in Node.
Server-only provider code lives in `*.server.ts` so SvelteKit keeps it out of the client bundle.

## Design rules

1. Never send analysis requests while the camera is just previewing. One button press = one bounded job.
2. The captured frame sent for analysis never contains the overlay, boxes or other UI.
3. Box coordinates are normalised `0..1` in the correctly oriented captured frame. Never a 3D position.
4. AI output is a proposal. Identity is only committed after a user decision; later AI output never overrides it.
5. Identity, visibility and movement are independent states. Not rediscovered never means removed.
6. Missing provider confidence stays `null`. Never invent numbers or present confidence as calibrated probability.
7. Only provider adapters know the provider. Do not invent JEV payloads; use the verified official contract.
8. Demo/mock results always display **Demo**.
9. No automatic retry of paid requests. Retry is explicit.
10. Never delete reference images or history to free storage.

## Security and privacy invariants (PRD-SEC-007) — never weaken

- Provider credentials are server secrets. Never in the client bundle, URLs, logs or exports.
- The proxy does not retain images and enforces an aggregate budget server-side.
- Logs, traces and error reports never contain image data or base64 payloads.
- Imports are validated (schema, references, sizes, paths, formats) before touching the database, and roll back on failure. Reject `../` paths.
- Names and notes render as plain text. Imported data is never executed or treated as instructions.

## UI conventions

- Large touch targets (min 44 × 44 CSS px), primary action in thumb reach.
- Never use colour as the only signal; the first user is colour-blind. Always pair with label, icon and number.
- Every image box has an equivalent entry in a text list. Keyboard and screen-reader support.
- Say **No change detected**, never "has not moved".

## Conventions

- Everything in English: UI, code, comments, docs, commits.
- Conventional Commits (`feat`, `fix`, `docs`, `test`, `chore`, `refactor`).
- Do not commit secrets, `.env` files, real household photos or exported archives.
- Test camera features over HTTPS on real devices (iPhone Safari, Android Chrome).
