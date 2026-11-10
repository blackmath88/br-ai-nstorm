# Conditional build plan

This is a proposal, not a delivery commitment. [Concept and boundaries](README.md)
apply throughout. Preserve [ROADMAP](../../ROADMAP.md) and field test #8 priority.
Stage A's [owner decision](DECISION_BRIEF.md) precedes any implementation. Each
approved package gets a small PR, executed checks and an explicit release decision;
no delivery estimates are assumed.

## Smallest useful slice

After owner approval: A plus a document-shaped B, for one local public/synthetic
case bundle. Compare its preflight with a hand-written static checklist before
building MCP, UI, a role system or an adapter. Keep output advisory; no canonical
strategic decisions or external shared room. Stage B replay can be manually
moderated without treating proposed tool names as working software.

## Packages and release gates

| Increment / dependency | Reuse and smallest addition | Acceptance tests and gate |
|---|---|---|
| **A · Offline evidence bundle**; owner scope decision | Reuse `server/adoption/{manifest,markdown,plan}.ts`, `server/application/import-service.ts`, `scripts/brainstorm.ts` and static view. Add a validated snapshot envelope for policy sections and issue/PR excerpts, separate from contribution identity. Current Markdown extraction skips tables/code; retain explicit source excerpts and omission notices rather than silently losing policy. | Extend `server/test/adoption.test.ts`: repeat import is idempotent; changed/missing/partial sources differ; URLs, policy revisions, retrieval dates and head SHAs round-trip; moved unchanged text retains identity but gets a new observation; oversize/path traversal/malicious instruction fixtures cannot trigger fetches or actions. Gate: replayable local bundle, no network or repository writes by the new slice. |
| **B · Contributor preflight**; A | Reuse `problem-service.ts`, `orchestration-service.ts`, `curation/participant.ts` candidate ranking and qualified provenance. New application read assembles policy, related work/claims, evidence limits and unanswered questions. Start with a document output; only later register illustrative `get_contribution_preflight` in `server/mcp/register-tools.ts`. | Extend `orchestration.test.ts` / `mcp.test.ts`: bounds and schemas, missing-source abstention, stale-head warnings, genuine/complementary/unrelated cases, injection text kept as data, no approval from endorsement/popularity/silence, no writes. Gate: human checks citations and can choose “direction unconfirmed”; no unexplained verdict or score. |
| **C · Maintainer brief**; B and useful replay result | Reuse `curation-service.ts` review boundary, State/Map/Timeline projections, report counts. Add editable grouping of related questions with alternatives and affected proposals; no new tracker. Illustrative `get_maintainer_decision_brief` remains read-only. | Human assesses false/missed overlap, dissent retention, provenance and one strategic question spanning several approaches; splitting/correcting groups remains possible. Preserve own-agent accept/reject denial in `orchestration.test.ts`; report instrumentation must not equate elapsed latency with attention. Gate: no consequential unsupported scope/approval claims, and comparison includes curation cost. |
| **D · Verified authority and decisions**; C, explicit governance design; coordinate #12 | Reuse `auth/actor-context.ts`, `domain/policies.ts`, `domain/events.ts`, `domain/projections.ts`, `application/support.ts`, `persistence/repository.ts`. Add verified stable identity → repository role → explicit delegated scope, evidence-bound human confirmation and reasoned decision supersession. Do not promote contribution endorsement into authority. | Extend `api.test.ts`, `concurrency.test.ts`, `lifecycle.test.ts`: spoofed identity, unauthorized decisions, expired/revoked roles or delegation, wrong repository/scope, replayed confirmation, concurrent decisions, stale policy/head and supersession cycles. Recheck authority on mutation; stale confirmation requires renewed human confirmation, never an automatic retry of changed intent. Gate: all denial paths and independent review preserved before any external shared pilot. |
| **E · Optional read-only GitHub ingestion**; A; D before shared use | Keep fetching outside existing importer; preserve its no-fetch contract. Evaluate overlap with #15 before adding a narrow adapter. Allowlisted public repository, bounded pages/bytes/rate/cost, least-privilege authentication, fork/base/head provenance; no background ingestion needed initially. | Fixture adapter tests: pagination cutoff, unavailable/edited source, head change, revoked credentials, secret redaction, redirects outside allowlist, partial retrieval and idempotent replay. Reject mutation operations; no automatic comments, labels, assignments, closures or merges. Gate: owner separately authorizes ingestion; a manual bundle remains supported. |
| **F · Opt-in pilot / evaluation**; B–D gates, E only if used, separate recruitment approval | Reuse `report-service.ts` / Report view for context only. Use private recording templates from EXPERIMENT for active time, correctness and fairness. | Moderated dry run of consent, role revocation, stale/concurrent writes, correction and deletion; freeze case set/rubric before sessions. Gate: explicit owner go/no-go, verified roles, human confirmation, read-only integration, privacy readiness and no critical errors; publish only reviewed de-identified aggregate findings. |

All application filenames above are under `server/application/` unless qualified;
test filenames are under `server/test/`. HTTP and MCP remain thin adapters calling
the same services. No new dependency, database or AI provider is presumed.

## Evidence and decision contracts to design before coding

Each evidence item must carry source URL/anchor, repository, source kind, captured
excerpt, snapshot/retrieval date, source update date where available, policy commit
revision, and PR base/head SHA where applicable (explicit `not applicable` otherwise).
Record included scope, omissions, retrieval failures and content digest. The bundle
has a stable ID and schema version. No mutable branch name substitutes for a policy
revision. Import timestamps alone do not prove source freshness.

New observations must preserve earlier snapshots while updating freshness separately
from content-addressed contribution identity. Mark evidence **current as checked**,
**stale**, **partial**, or **unknown**, with check date and reason. Revalidate policy,
PR head and roles before a consequential decision; offline material stays “as of
snapshot,” never current by assumption. An unavailable check blocks confirmation.

A work claim records accountable actor, proposed scope, source, last confirmation
and expiry. Expiry removes any suggestion of ongoing activity, not contribution
history; it never grants exclusivity. For early replay these can be fixture fields,
not new canonical domain types.

A decision records question/scope, option, reason, responsible verified actor,
delegation evidence and expiry, explicit confirmation, policy revision, evidence IDs,
PR head(s), event version, timestamp and supersedes pointer. A subsequent decision
retains the earlier reason. Policy changes must still be made in repository docs.
Strategic authority is separate from independent validation: an owner may decide
scope, but cannot independently validate their own AI proposal. Any different
self-assisted decision path needs separately approved policy, not a bypass of
`assertMayReview`.

Before external shared use, choose a supported single-writer/atomic storage path;
existing JSON cross-process writes are not a safe gate until #10 is resolved or the
single-writer topology is enforced and tested. Prototype passwordless identities
and shared demo tokens are unsuitable. Keep personal research records outside the
append-only public history; privacy rules are in [EXPERIMENT](EXPERIMENT.md).
