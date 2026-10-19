# HomeTrace

**A visual memory for your home.** Register your belongings room by room, then see what you find again
and what looks different.

> **Status: pre-alpha, Phase 0.** The JEV contract is verified and an evaluation harness exists.
> No user-facing app flow yet. Read [`development/PRD.md`](development/PRD.md) and [`docs/phase0.md`](docs/phase0.md).

## What it is

A mobile-first web app that builds a visual inventory of the visible belongings in your home. You walk
through the home with a live camera preview, tap **Scan**, and review a frozen frame with marked objects.

When you revisit a named viewpoint, the previous image is shown as an adjustable transparent overlay over
the live video. You line up the camera using fixed features and tap **Ready — scan**. The app proposes
which items were found again, possibly moved, newly registered or not rediscovered. You decide uncertain
identity with **Same object? Yes / No / Skip**.

## What it will do (MVP)

| Area | Behaviour |
|---|---|
| Organisation | One home, multiple rooms, multiple named viewpoints per room |
| Camera | Live preview; analysis only starts after an explicit button press |
| Identity | AI proposes matches; the user always confirms |
| Revisits | Transparent reference overlay, 0–80 % opacity |
| Storage | IndexedDB on the device. No account, no login, no server database |
| Portability | ZIP export/import with versioned JSON and image files |
| AI | JEV Images, behind a provider adapter with a mock implementation |

It does not claim complete inventory, 3D positioning or that a hidden item has disappeared.

## Phases

0. Validate JEV discovery, boxes and identity matching against annotated fixtures.
1. Complete workflow prototype with clearly labelled demo detections.
2. JEV integration, private proxy, budgets and comparisons.
3. Stabilisation: recovery, accessibility, offline shell.

## Development

Requires Node ≥ 22.17 (`.nvmrc` pins 24).

```sh
nvm use
npm install
npm run dev            # local dev server; annotation tool at /phase0/annotate
npm run check          # type check
npm run lint           # svelte-check, warnings fail
npm test               # unit tests
npm run fixtures:demo  # re-render the synthetic Demo fixtures
npm run eval           # Demo provider on Demo fixtures; see docs/phase0.md
```

Provider access: put `OPEN_ROUTER_API_KEY=...` in `.env` (git-ignored). The verified JEV contract
and measured Demo results are in [`docs/jev-contract.md`](docs/jev-contract.md).

## Getting started (coding agents)

See [AGENTS.md](AGENTS.md) for rules and the planned layout. A good first prompt:

```text
Build HomeTrace according to development/PRD.md. Read the whole PRD first.
Begin with the Phase 0 feasibility checks and establish the actual JEV Images
API contract from official documentation. Do not invent API payloads or claim
that fixtures demonstrate real model performance.
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
