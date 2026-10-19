# Architecture Decision Records

Lightweight log of architecture decisions whose rationale isn't obvious from the code. Nygard-lite — one file per decision, minimal ceremony.

## When to write one

Write an ADR when **both** hold:

- The decision is **deliberate** and likely to be **re-questioned or re-flagged later** ("this looks wrong / accidental / like duplication" — but it isn't).
- Its **rationale isn't visible in the code** — a future reader (or agent) staring at the diff couldn't reconstruct *why* without the context.

This is the "this looks wrong but is deliberate" bar. It is **not** a log of every choice. Routine, self-evident, or convention-following decisions don't need one. When in doubt, ask: *would someone reasonably try to "fix" this later and undo a deliberate trade-off?* If yes, record it.

## Folders

- `stack/`: the ADRs stack ships. A stack update changes them, and the project never edits them.
- `project/`: the project's own ADRs. A new ADR of the project goes here.
- Each folder numbers its ADRs from `0001`, so a citation names the folder: `stack ADR 0003`, `project ADR 0003`.

## Format

- One file per decision: `NNNN-kebab-title.md`, zero-padded sequential number within its folder (`0001-…`, `0002-…`). `0000-template.md` is the template, not a decision.
- Copy `0000-template.md` into the folder to start.
- Sections: **Title**, **Status**, **Context**, **Decision**, **Consequences**, and **Rejected** when a declined option is likely to be proposed again.
- **Status**: `Proposed` · `Accepted` · `Superseded` (note the superseding ADR).

No status-lifecycle ceremony, no RFC process. Keep each one short.
