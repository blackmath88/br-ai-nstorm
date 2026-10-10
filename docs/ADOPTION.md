# Adoption — Brainstorm as a reusable problem-space form

Answers [issue #4](https://github.com/blackmath88/br-ai-nstorm/issues/4): how a
repository opts into a Brainstorm problem space with near-zero setup, while the
richer event / provenance / conflict model stays available when a problem
actually needs it.

## 1. Product boundary

**Brainstorm is a semantic projection over source material, not a second
repository.** A repository keeps its facts: briefs, documents, issues, code.
Brainstorm adds only what it uniquely owns: questions, approaches, assumptions,
tensions and conflicts, the relations between them, who said what, what was
reviewed, and the history of all of it. When a repository document is the
source of a statement, Brainstorm holds a line-anchored *reference* to it, never
an editable copy. Observing the repository is Observstory's job, and deciding
what happens next is Weavr's. Brainstorm answers *"what are we thinking about?"*

## 2. Adoption ladder

| Level | What you get | What it costs | Command |
|---|---|---|---|
| **0 · off** | nothing | nothing | — |
| **1 · static** | a read-only HTML view of every declared problem space, each item linked to its source lines; a portable event log | one manifest file; no backend, no MCP, no LLM, no keys | `npm run brainstorm -- build <repo>` |
| **2 · shared room** | the full model: participants, contributions, curation, conflicts, orchestration modes, MCP, State / Map / Timeline | a running room (Node or Cloudflare Worker) | `npm run brainstorm -- push <repo> --url … --token …` |
| **3 · integrated** | Observstory supplies repository evidence; Weavr consumes intent | per-tool wiring | not built; nothing in Levels 1–2 depends on it |

Each level uses the same manifest, the same extractor and the same projection.
Moving up a level changes where the event log lives, not what it says.

## 3. The minimum declaration

One file at the repository root, `brainstorm.config.json`. It sits beside other
tool declarations such as `observstory.config.json`, and its presence is how
other tools discover that a repository has problem spaces.

```json
{
  "version": 1,
  "repository": "owner/name",
  "problemSpaces": [
    {
      "id": "basel-38",
      "brief": "challenges/basel-38/BRIEF.md",
      "sources": ["challenges/basel-38/BRAINSTORM.md"]
    }
  ]
}
```

- `id`: becomes the problem id in a room. Lowercase letters, digits and dashes.
- `brief`: optional. Read for the title and the tagline or description. **Never
  imported as contributions**, because the challenge's own wording stays in the
  repository.
- `sources`: the Markdown documents whose content becomes reviewable contributions.
- Optional per space: `title`, `shortTitle`, `description`. Optional at the top: `title`, `sourceUrlBase` (for forges other than GitHub).
- One repository can declare many problem spaces.
- Paths must be relative, inside the repository, and Markdown. `..`, absolute paths and other file types are rejected.

JSON rather than YAML: it needs no parser dependency and matches the sibling
tools. `npm run brainstorm -- init <repo>` proposes a manifest from the
repository layout (every `BRAINSTORM.md` or `*.brainstorm.md`, with a sibling
`BRIEF.md` when there is one). It prints the proposal, and writes it only with
`--write`.

## 4. Source, provenance and synchronisation

Extraction is deterministic: the same file always gives the same units, in the
same order. Each unit is a paragraph, a quote or a list item, anchored to its
exact line range. A short lead-in ("Potential actors:") is folded into the list
or quote it introduces. A short enumeration becomes one unit, unless its items
are questions. Code blocks, tables, and lead-ins too slight to stand alone
("Potentially:") are skipped and counted, never silently lost. A unit's kind
comes from the **author's own section heading** ("Open questions" → question,
"Risks / assumptions" → assumption, "Ideas" → approach, …). A trailing `?`
always means question. Nothing is summarised or rewritten, and no model is
involved.

Every imported contribution carries:

| field | value |
|---|---|
| `authoredBy` | `repo:<owner/name>`: the repository, not a person and never an AI |
| `submittedBy` | the participant who ran the import |
| `source` | `repo_import` |
| `sourceDetail` | `owner/name@<rev>:path#L5-L7 · § Section · <link to those lines>` |
| `endorsement` | `participant_review_required`: inclusion means "the document says so", never "the group agrees" |

**The five sync rules** (`server/adoption/plan.ts`), which stop the
repository and the room from becoming two competing versions of the same fact:

1. **Content-addressed identity.** A unit's id is a hash of (problem, path,
   text). Re-importing unchanged text is a no-op at any revision. Moving a line
   is a no-op too.
2. **Add-only.** Changed text arrives as a new contribution. The old one is
   reported as **stale** and left alone: not edited, not superseded, not
   removed. Supersession is a human act. A file missing from an import is
   reported as missing, and what came from it is *not* marked stale.
   Overlapping imports are harmless to state: replay keeps the first
   `ProblemCreated` and the first `ContributionAdded` for an id. *Known
   limitation:* the raw log still records the duplicate events, so the
   activity feed can list them twice. Preventing that needs an
   expected-version append on the repository port, which has not been built.
3. **Imported text cannot be edited in the room.** Its author is the
   repository, so no participant passes the author-only edit rule. A
   correction is made in the repository and arrives with the next import.
4. **Nothing is endorsed by importing it.**
5. **The server never fetches a repository.** The CLI reads files locally and
   sends only the files the manifest names. Anything else in the request body
   is ignored. Limits: 64 files, 256 Ki characters each, 2 Mi characters per
   import, 24 spaces.

What is imported **once** is the problem itself (title, description, the
first three open questions as "think next" prompts). What is **re-derived on
every import** is the set of units. What is **never derived** is anything
relational: relations, conflicts and evaluations come only from participants
and curation in the room.

## 5. Zero-infrastructure mode

```bash
npm run brainstorm -- build ../hack-am-rhein            # writes ../hack-am-rhein/.brainstorm/
npm run brainstorm -- build ../hack-am-rhein --out site # or anywhere
```

Outputs:

- `brainstorm.html`: self-contained (inline CSS, no scripts), light and dark,
  readable on a phone. Problem spaces are grouped by kind, and every card links to
  its source lines at the exact revision.
- `brainstorm.snapshot.json`: the event log a room would hold for this
  revision, plus the import report. It is portable and diffable, and later tools
  can read it.

A repository can commit the HTML, publish it with its docs, or just open it.

## 6. When to move to a shared room

Move from Level 1 to Level 2 when **any** of these is true:

- more than one person wants to *respond* to the material: relate it, dispute it, add to it;
- a tension in the documents needs to become an explicit, reviewable conflict;
- participants want their own AI tools to read and contribute (MCP);
- you need to know what changed since someone last looked, and what happened to their contributions.

Stay at Level 1 while the documents are written by one person or one tight
team, and the view is for reading.

To move up: `npm run brainstorm -- preview <repo> --url <room> --token <t>` shows
what would be added and what has gone stale, without writing. `push` imports.
Run `push` again after the documents change. It is safe to repeat.

## 7. Field test: `hack-am-rhein`

The repository separates challenge truth (`BRIEF.md`) from interpretation
(`BRAINSTORM.md`), which is exactly the split the manifest encodes. The
manifest `init` proposed is in
[`examples/hack-am-rhein/brainstorm.config.json`](../examples/hack-am-rhein/brainstorm.config.json):
four problem spaces, each with a brief and one source.

Measured against the repository at `a4124eda19a1`:

| problem space | imported units | skipped |
|---|---|---|
| `basel-38` | 24 | 3 code blocks, 4 lead-ins (counted, not imported) |
| `life-sciences` | 14 | 1 code block, 1 lead-in |
| `rhine-manufacturing` | 14 | 1 code block |
| `sponge-city` | 11 | 1 code block, 1 lead-in |

Pushed into a local room, the four spaces appear as problem tabs beside the
seeded ones. Pushing again added nothing (63 unchanged). Editing one line in
`basel-38/BRAINSTORM.md` and previewing showed exactly `+1 added, 1 stale`.

To adopt it there: copy the example manifest to the repository root, then use
any level above. Nothing in `hack-am-rhein` has to change.

## 8. Non-goals and anti-duplication rules

- Brainstorm is not required for every repository. Level 0 is a valid answer.
- README files, issues and docs are not copied into the room as canonical state.
  Imported units are quoted references that need review.
- Lightweight adoption does not require MCP, OAuth, Cloudflare, Durable Objects
  or an LLM.
- Imported text cannot be edited in the room, so nobody has to keep two copies
  of a fact in sync.
- The importer never supersedes, merges or deletes. It reports what is stale.
- No AI does the extraction. AI judgement enters only through the room's
  orchestration modes, as proposals a human reviews.
- Repository observability is not Brainstorm's job (it belongs to Observstory),
  and neither is orchestration of what happens next (Weavr).

## Answers to the issue's questions

1. **Minimum declaration:** one JSON file, or one `init` command that proposes it.
2. **Several problem spaces per repository:** yes, one entry each.
3. **Referencing without copying:** a line-anchored `sourceDetail` with a link to those lines. The unit text is a quote for reading, not an editable copy (rule 3).
4. **Imported once vs. re-derived:** see §4.
5. **No competing versions of the same fact:** content-addressed identity, add-only imports, no editing of imported text in the room.
6. **Static view without a backend:** `build`.
7. **When to move up:** §6.
8. **Discovery:** the presence of `brainstorm.config.json`, and `/health` on a room.
9. **Same schemas and projections at every level:** yes. The static view renders the same projection from the same events.
10. **Field-test path:** §7.
