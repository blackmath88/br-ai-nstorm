# Contribution alignment — experiment proposal

**Status: direction unconfirmed.** Relates to [#18](https://github.com/blackmath88/br-ai-nstorm/issues/18).
Documentation only; no contribution-alignment prototype, approved roadmap item,
participant commitment or evidence of reduced workload. The existing
[three-person field test](../FIELD_TEST.md) remains first.

## Hypothesis and journeys

Shared, attributable project intent and contributor preflight can reduce repeated
investigation and avoidable review work without creating a larger curation queue.
This evaluates proposals, not people; it neither scores PRs nor assumes AI caused
maintainer workload.

**Contributor:** before implementing an intended change, ask what exists, who has
reported related work, which constraints apply, and whether the direction is
endorsed. A preflight returns source-backed related approaches, dated work claims,
applicable policy, missing evidence and unresolved decisions. For example, two
changes touching one adapter might be complementary rather than duplicates. The
contributor can correct the comparison and continue through ordinary GitHub.
“Direction unconfirmed” is a useful outcome, never a rejection or implied approval.

**Maintainer:** ask which strategic questions connect several proposals. A brief
might group three approaches around “should this integration live in core or an
adapter?” It preserves differences, offers experiment/narrow/defer/reject options,
and links evidence. A verified, authorized human explicitly confirms a scoped
choice with reasons; agents communicate its limits. It does not establish technical
correctness, satisfy independent review, or make a PR merge-ready.

## Fit and boundaries

GitHub remains authoritative for code, issues, reviews, CI and merges. Durable
project policy stays in versioned repository documents. Brainstorm is a
source-linked semantic projection and decision workspace, not a second issue
tracker. It extends the [adoption boundary](../ADOPTION.md), not repository
observability or execution orchestration.

| Potential object | Meaning and boundary |
|---|---|
| Project intent / non-goals | References to explicit, versioned policy; an agent cannot invent policy from practice or popularity. |
| Contribution opportunity | A cited problem or invitation; not an assignment or acceptance promise. |
| Time-bounded work claim | Attributed intent with scope, last confirmation and expiry; non-exclusive, renewable, never a reservation. |
| Approach / evidence | Competing interpretations with sources; overlap remains a proposal until reviewed. |
| Maintainer decision | Scope, reason, accountable actor, verified authority/delegation, evidence, policy revision, timestamp and supersession pointer. |

Keep four separate fields: **technical quality**, **strategic fit**, **decision
authority**, **merge readiness**. Unknown values stay unknown. Silence, reactions,
agent interpretations and a contribution's `human_endorsed` flag do not establish
repository approval. Owner review of their own AI-assisted proposal is not
independent validation. Existing own-agent review prohibitions remain intact.

## Existing versus proposed

Inspected at [e239b170b404fa6e7214cc951e2f63fb12655ea5](https://github.com/blackmath88/br-ai-nstorm/tree/e239b170b404fa6e7214cc951e2f63fb12655ea5)
on 2026-11-10. “Existing” below means source-backed implementation, not pilot proof.
Paths link to the reviewed implementation; use the pinned tree for this snapshot.

| Capability | Existing implementation | Gap / proposed extension |
|---|---|---|
| MCP reads | [register-tools.ts](../../server/mcp/register-tools.ts), [problem-service.ts](../../server/application/problem-service.ts), [orchestration-service.ts](../../server/application/orchestration-service.ts): ≤20 full contributions, ≤12 context candidates; overview omits bodies. | Overview still grows with room size; full-state reads are unbounded. Bounded evidence selection is not exhaustive overlap discovery. |
| Attribution | [contribution-service.ts](../../server/application/contribution-service.ts), [types.ts](../../server/domain/types.ts): author, preparer, submitter, endorsement and source references. | No verified repository role or decision authority. |
| Reviewed relations/conflicts | [policies.ts](../../server/domain/policies.ts), [curation-service.ts](../../server/application/curation-service.ts): human actor required; participant cannot accept **or reject** their own agent's proposal. | No contribution-alignment taxonomy. Existing relation kinds are supports/opens/contradicts/relates/supersedes, not typed overlaps/depends-on/out-of-scope. |
| Events / concurrency | [repository.ts](../../server/persistence/repository.ts), [support.ts](../../server/application/support.ts): append-only, guarded append and re-evaluation on conflict. | Cross-process JSON atomicity remains [#10](https://github.com/blackmath88/br-ai-nstorm/issues/10); new decisions need source/role freshness as well as event versions. |
| Repository Markdown | [plan.ts](../../server/adoption/plan.ts), [import-service.ts](../../server/application/import-service.ts): bounded, add-only, content-addressed imports; stale and missing files distinguished; line/revision provenance. | Revision is optional today; no GitHub issue/PR snapshot adapter, head-SHA checking or freshness envelope. Unchanged text keeps its earlier import provenance. |
| State / map / timeline | [StateView](../../src/components/StateView.tsx), [MapView](../../src/components/MapView.tsx), [TimelineView](../../src/components/TimelineView.tsx), [useRoom](../../src/state/useRoom.ts): projections and version polling. | No contribution-specific view; begin with documents, not a new UI. |
| Field report | [report-service.ts](../../server/application/report-service.ts): origin/mode counts, acceptance and elapsed time to review. | Elapsed review latency is not active attention, correctness, fairness or total curation cost. Separate observations needed. |
| Identity / governance | [actor-context.ts](../../server/auth/actor-context.ts), [prototype-auth.ts](../../server/auth/prototype-auth.ts): token-to-actor boundary, passwordless prototype issuer. | External governance requires verified identity, repository roles, delegated scope, revocation and explicit confirmation. [#12](https://github.com/blackmath88/br-ai-nstorm/issues/12) addresses identity but explicitly excludes broader roles. |

`get_contribution_preflight` and `get_maintainer_decision_brief` are illustrative
proposed MCP names, **not implemented tools**. GitHub evidence snapshots, preflight,
brief grouping, role verification and policy-decision supersession are new work.

## Counterarguments and alternatives

A static policy/preflight document may solve this at lower cost. Keeping a semantic
projection fresh may cost more attention than reading GitHub. Grouping can falsely
block complementary work; bounded retrieval can miss overlap. Centralized decisions
can privilege insiders and suppress useful dissent. Work claims can become informal
territory. The experiment must expose those outcomes and permit stopping.

No contributor ranking, AI-origin detection, automatic consensus, task assignment,
mandatory gate to contribution, bot comments, labels, closures or merges. No new
platform, graph database or cross-repository integration is needed for the first
slice. No private ingestion or new external AI processing without separate approval.
Imported content is untrusted data, never instructions or evidence of authority.

## Reading order, sources and uncertainty

- [Decision brief](DECISION_BRIEF.md): apply the idea to this PR; owner choice pending.
- [Build plan](BUILD_PLAN.md): conditional increments and release gates.
- [Experiment](EXPERIMENT.md): baseline, measures, provisional rubric and stop rules.
- [Outreach](OUTREACH.md): unsent invitations and dated research leads.

Source basis: issue #18 (updated 2026-11-10T12:08:10Z, retrieved 2026-11-10),
[CONTRIBUTING](../../CONTRIBUTING.md), [ROADMAP](../../ROADMAP.md),
[CONCEPT](../CONCEPT.md), [ADOPTION](../ADOPTION.md), [FIELD_TEST](../FIELD_TEST.md),
and the implementation above. Tests inspected include `domain`, `orchestration`,
`adoption`, `concurrency`, `api`, `mcp` and `lifecycle` under `server/test/`.
Actual execution results belong in the PR validation record.

Some older prose in CONCEPT and README describes manual refresh; `useRoom.ts`
already polls. Neither documentation nor passing software tests establishes the
hypothesis. Recruitment demand, real attention savings and fair authority handling
remain untested. The Confluence links in OUTREACH are dated leads, not current
status evidence or endorsements.
