# Legacy documents

Early artefacts from before the React + server architecture existed. They are
kept for provenance: they show where the idea started and what was dropped. **They
do not describe the current system.** For that, read the top-level
[README](../../README.md), [CONCEPT.md](../CONCEPT.md) and
[MILESTONES.md](../history/MILESTONES.md).

| File | What it was | Superseded by |
|---|---|---|
| `open_cognitive_bubbles_concept.json` | v0.1 concept for critical sparring: people selectively open parts of their AI-extended thinking to a shared problem | [CONCEPT.md](../CONCEPT.md) |
| `open-cognitive-bubbles-deep-concept-and-test-plan.json` | v0.2 deep concept, research framing and validation plan (2026-08-29) | [CONCEPT.md](../CONCEPT.md), [FIELD_TEST.md](../FIELD_TEST.md) |
| `br-ai-nstorm-project-update-v0.3.json` | Structured project-memory update: what changed, what was built, what was deferred (2026-08-29) | [MILESTONES.md](../history/MILESTONES.md) |
| `br-ai-nstorm-prototype.html` | Single-file clickable prototype that preceded the React app | `src/` (milestone `v0.1.0` onward) |

The prototype HTML is self-contained; open it directly in a browser.

## Retired branches

All earlier development branches were folded into `main` and removed. Each
meaningful stage is kept as a tag instead:

| Tag | Was | Stage |
|---|---|---|
| `v0.1.0` | `milestone/react-canonical-v0.1` | React canonical state |
| `v0.2.0` | `milestone/mcp-shared-memory-v0.2`, `prototype/mcp-shared-memory-v1` | MCP shared memory |
| `v0.3.0` | `milestone/real-shared-room-v0.3` (incl. `feature/cloudflare-demo`, PR #3) | Real Shared Room + Cloudflare demo |
| `v0.4.0` | `main` at `a96c2db` | Orchestration modes, remote MCP, adoption |
| `archive/v0.5-lifecycle` | `ccr-00e0be58-t5hpg7` | v0.5 work, now on `main` |
| `archive/demo-scenario` | `feature/demo-scenario` | Demo scenario + store fix, now on `main` |

```bash
git checkout v0.2.0   # inspect or run any stage
```
