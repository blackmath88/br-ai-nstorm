# Concept

## Product wrapper

**br-ai-nstorm** is a living map of collective problem solving.

A group works on a problem. The product shows:

- what the group currently understands,
- which questions remain open,
- which approaches are emerging,
- what evidence supports them,
- what assumptions are untested,
- where contradictions exist,
- what changed since a participant last looked,
- what happened to a participant’s own contributions,
- and what they might usefully think about next.

The UI should answer, in one eyesight:

> Where are we now?

## Underlying research idea

The deeper system is **Open Cognitive Bubbles**:

- each participant can have their own AI-extended thinking environment,
- the shared problem space does not need to own that private context,
- a governed aperture exports only a bounded context package,
- the participant thinks privately with any AI,
- and only a bounded reviewed contribution returns to shared memory.

## Canonical versus derived views

The canonical structure is semantic:

- problem,
- questions,
- approaches,
- evidence,
- assumptions,
- contradictions,
- synthesis.

The map is derived.

The timeline is derived.

This prevents the force-directed map from becoming the system’s ontology.

## What is intentionally faked

As of v0.3 this list is shorter than it was, and the remaining entries are
narrower. See [ADR-003](./architecture/ADR-003-v0.3-shared-room.md) for the
boundaries.

- **the session issuer, and only the issuer** — identity is genuinely resolved
  server-side from a bearer token; what is fake is how a principal is
  established, in one removable file;
- **permissions beyond authorship** — a participant may edit only their own
  contributions, but there is no sharing or visibility model yet;
- **persistence technology** — a local append-only JSON log, disposable by
  design, behind a repository port;
- **distributed repositories and ATProto**;
- **background orchestration** — no live push; the client refreshes.

No longer faked: attribution, event history, conflict objects, the curation
queue, the review boundary, and the MCP transport.

The clipboard JSON round-trip remains as the universal fallback for external
cognitive environments; MCP is now the direct path for the same contract.
