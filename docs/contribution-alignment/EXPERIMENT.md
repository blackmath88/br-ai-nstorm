# Experiment protocol — proposed, not started

See [concept](README.md) for the hypothesis and [build gates](BUILD_PLAN.md) for
technical prerequisites. This campaign does not replace field test #8.

## Stages and case selection

**A · Dogfood this documentation PR.** Prepare [DECISION_BRIEF](DECISION_BRIEF.md)
before implementation. Owner chooses experiment / narrow / defer / reject. Record
scope, reason, date and evidence in GitHub; no choice is recorded yet. Owner review
of this AI-assisted draft is not independent validation, nor evidence of savings.

**B · Offline replay, approximately 8–12 cases.** Prefer our public repository
material or synthetic cases. Include genuine overlap, complementary approaches,
unrelated proposals, expired work claims, and stale/ambiguous or partial evidence;
include a malicious instruction embedded in an excerpt. External research leads
must be refreshed and captured before use. Freeze URLs, snapshot dates, policy
commits, PR head SHAs, excerpts and omissions. Hide later outcomes during the task.
Two human assessors independently label expected coordination answers and evidence
before seeing generated outputs; record disagreement, then adjudicate or mark
indeterminate. Do not infer strategic approval without an explicit authorized source.
No external shared governance or live actions in replay.

**C · Small, opt-in moderated pilot.** Tentative recruitment goals: 2–3 maintainers
and 3–6 contributors, not commitments or a powered sample. Requires D's verified
identity/roles/delegation/revocation and confirmation gates, separate recruitment
approval, and consent below. GitHub integration, if used, stays read-only. People
may use no agent and retain the normal contribution path.

## Comparison

Compare GitHub plus existing documentation (baseline) with the same material plus
Brainstorm-assisted preflight/briefs. Also test a simple static policy/preflight
checklist: the new workspace must justify its overhead against that cheaper option.
Use matched task pairs, comparable complexity and identical snapshot scope. Assign
AB/BA order across participants where feasible; use different matched cases to
reduce recall, and record deviations, prior familiarity, tool/model versions and
facilitator help. Keep information access and time recording consistent. Do not
withhold policy from baseline or show it only to the assisted condition.

Freeze the rubric, cases, comparison allocation and quantitative gates before each
stage's sessions. Changes apply to a new version/cohort, never retroactively to
make results pass. Descriptive results only: this convenience sample cannot prove
causality, market demand or general effectiveness.

## Measures and rubric

**Primary:** total maintainer active attention minutes / correctly resolved
coordination questions. Include setup, import, curation, verification, correction,
facilitator work performed for maintainers, and final decision work. Count cost
spent on wrong/unresolved questions in the numerator. If none are correctly
resolved, report “no successful resolution,” not zero cost. Report one-off setup
separately **and** in the total; allocate shared costs by a predeclared equal share
across assigned questions, with raw totals visible. Also report per-person and
matched-task results, not just one pooled average.

| Measure | Recording / assessment |
|---|---|
| Correctly resolved question | Human answer consistent with captured evidence and explicit authority; “direction unconfirmed” counts only when uncertainty is the correct answer. Indeterminate labels are separate, not assumed correct. |
| Factual support | Split outputs into factual claims; mark supported / contradicted / unsupported / unverifiable with source anchor. Denominator includes all factual claims; uncertainty is not fabricated evidence. |
| Overlap | Human-labeled actual overlaps, false overlap assertions and missed overlaps; complementary and unrelated cases stay distinct. Report counts/denominators and disagreements. |
| Scope / approval / freshness | Count unsupported out-of-scope assertions, false approval/authority claims, stale guidance presented as current, and whether uncertainty was visible. |
| Consequential errors | Any answer that would wrongly block/direct work, authorize action, or misstate a binding decision; record impact and correction even if caught before use. |
| Contributor effort | Active minutes including preparation, checking sources and correcting the tool; do not shift maintainer savings onto contributors unnoticed. |
| Clarity / perceived fairness | Separate 1–5 ratings (1 unclear/unfair, 5 clear/fair), explanation, dissent and ability to challenge; never rank participants. |
| Operational burden | Pending curation count, time to verify each brief, setup/maintenance effort and corrections. Existing field-report latency is contextual, not an attention timer. |

Neither summary count nor number of generated links is a success measure.

## Provisional gates and stop rules

Issue #18 suggests 80% supported factual claims plus lower median attention. That
could leave one in five claims unsupported and hide harmful authority errors; it
is **not sufficient for progression**. Proposed gates below are engineering choices,
not validated statistical thresholds; the owner and assessors must freeze them
before sessions, with denominators and small-sample limitations recorded:

- **Zero unauthorized actions and zero fabricated authority/approval claims.** Any
  occurrence stops the session and blocks progression regardless of aggregate score.
- Zero consequential decision errors; any such error, privacy breach or incorrect
  contributor block pauses the stage for review and correction before further use.
- At least **95%** of factual claims supported by fixed evidence, with every
  unsupported/contradicted claim examined. Report raw counts; this cannot excuse a
  critical error. Zero stale guidance presented as current.
- Lower median matched-task attention per correctly resolved question than baseline,
  with no increase in consequential errors or unresolved-question count; show full
  cost totals and participant variation. A tiny median difference is inconclusive
  without a practically convincing pattern. No claim of statistical significance.
- If the static checklist performs as well or better, choose it. Stop or narrow if
  curation adds work, contributors are blocked incorrectly, time is merely shifted,
  or authority becomes unfairly centralized. A fairness concern triggers qualitative
  review even when every numerical gate passes.

An error caught in replay is a finding, not permission to proceed to a shared pilot.
Record held / negative / inconclusive for the main hypothesis, evidence reliability,
and fairness; proceed only by an explicit human decision.

## Consent, privacy and deletion

Before recruitment, name a research custodian and approved private storage, agree
who can access it (custodian plus consented assessors), and show participants the
purpose, tasks, data fields, AI processing if any, recipients and withdrawal route.
Get separate opt-ins for participation, recordings and quotations; recordings are
off by default. Declining or withdrawal has no effect on contribution acceptance.
Public issue text is not consent to publish judgments about its author.

Use participant/case codes. Keep consent records and the code-to-identity key separate
from observations. No personal pilot records, raw room logs, contact details or
recordings in public repository history; use synthetic fixtures for committed tests.
Do not apply FIELD_TEST's raw-log publication practice to this campaign. Only
reviewed, de-identified aggregates may be published with agreed disclosure scope.

Proposed retention, to confirm before sessions: delete raw observations, identity
keys and recordings within 30 days of the final session; on withdrawal, delete the
participant's identifiable records within 7 days, including working copies and
scheduled backup expiry. Provide a private export on request. Explain beforehand
that already published non-identifiable aggregates cannot reliably be reversed.
Do not start if the chosen storage cannot honor the agreed deletion policy.
No private-repository ingestion or new external AI processing without separate
explicit authorization and an updated consent notice.

## Recording templates (blank; completed records stay private)

**Session:** protocol version; consent reference; participant code/role; case pair;
condition/order; tool/model version; prior familiarity; facilitator help; start/end;
active minutes by setup/import/curation/verification/correction/decision; contributor
minutes; pauses; clarity/fairness ratings and notes; withdrawal/deletion date.

**Case / claim:** case ID; question; snapshot ID/date; URLs; policy revision; PR
head SHA or N/A; omissions/freshness; expected answer; assessor A/B labels;
disagreement/adjudication; output claim; supporting anchor; factual label;
overlap expected/predicted; authority/scope/staleness flags; consequential error;
correction effort; final correct/incorrect/unresolved/indeterminate outcome.

**Stage decision:** protocol version; sample/denominators; setup and total costs;
matched comparisons including static checklist; critical incidents; missing data;
limitations; held/negative/inconclusive; experiment/narrow/defer/reject; human
responsible; reason/date; next authorized scope. Leave blanks unknown, not zero.
