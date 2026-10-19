@AGENTS.md
@memory.md

## Claude Code specifics

- JEV Images is experimental and its docs could not be read during research. Look up the current official docs before writing the JEV adapter. Never infer payloads from third-party examples.
- Use plan mode before touching PRD-FEAT-004 (identity matching), PRD-FEAT-006 (comparison statuses) or PRD-FEAT-009 (import validation). These carry the data invariants.
- Start work on a feature by reading its section in `development/PRD.md`, then its acceptance criteria and the related `T##` scenarios. Finish by checking each criterion.
