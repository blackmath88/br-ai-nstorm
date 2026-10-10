# Field test — three people, three AI clients, one problem

The README's next validation, made runnable. The test is meant to show whether
this design works with real people, so the protocol says in advance what
counts as a negative result.

## What the session tests

1. The same shared state is understood consistently across clients.
2. Contributions stay attributable: who said it, which AI drafted it, who accepted it.
3. Conflicts become more visible rather than flattened.
4. Curation proposals are worth reviewing.
5. Taking part through an AI client (MCP) is materially better than the clipboard JSON round-trip.
6. **The cost model:** proposals made by participants' own AIs are accepted about
   as often as the server curator's. If they are not, `participant` orchestration
   only saves money by making curation worse.

## Setup (once, ~15 minutes)

**The room.** Either run it locally (`npm run dev:server` + `npm run dev`) or
deploy the Worker (`npm run deploy`; see
[CLOUDFLARE_DEMO.md](architecture/CLOUDFLARE_DEMO.md)). For hypothesis 6 the
server curator must be available, which means the Node runtime with
`OPENAI_API_KEY` and `OPENAI_MODEL` set. The demo Worker has no key, so
`api` mode is unavailable there.

**The problem.** Use a seeded one, or import a real one:

```bash
npm run brainstorm -- push ../hack-am-rhein --url <room> --token <facilitator token>
```

**The check.** Run this right before people arrive. It writes only to a throwaway problem:

```bash
npm run smoke -- --url <room>
```

**The clients.** Each participant connects their own AI to `<room>/mcp` with
their own token. On the Worker the tokens are `demo-achim`, `demo-kai`,
`demo-lea` and `demo-mara`. On Node, get one from
`POST /api/auth/session {"participantId":"Lea"}`.

*Claude Code:*

```bash
claude mcp add --transport http brainstorm <room>/mcp --header "Authorization: Bearer demo-lea"
```

*Clients that only speak stdio* (e.g. a desktop app's config file): bridge with
`mcp-remote`. Pass the header through an environment variable so the space in
`Bearer …` survives every platform's argument handling:

```json
{
  "mcpServers": {
    "brainstorm": {
      "command": "npx",
      "args": ["mcp-remote", "<room>/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer demo-lea" }
    }
  }
}
```

Client configuration formats change faster than this document. Check your
client's current docs if a field name has moved.

*Without an MCP client:* the room's "Think with my AI" button exports a
context package to paste into any chat, and "Import AI result" brings the
answer back. That is the baseline for hypothesis 5.

**What to tell participants' AIs.** Nothing special. The tool descriptions
carry the protocol: start with `get_problem_overview`, call
`get_contribution_context` before contributing, attach `proposals` in
participant mode, and never review or judge anything the person hasn't decided.

## Session protocol (~75 minutes)

| Phase | Minutes | Orchestration | What happens |
|---|---|---|---|
| Orientation | 10 | — | Everyone asks their AI "where is this problem now?" using only the overview. Compare answers aloud (hypothesis 1). |
| Round A | 25 | `participant` | Contribute through your AI; review others' proposals in the room. Close at least one conflict with a note. |
| Round B | 20 | `api` (Node with key) or `deterministic` | Same task. Switch the mode in the Curation tab with a reason, so the switch is on record. |
| Round C | 10 | `participant` | One person uses only the clipboard aperture, no MCP (hypothesis 5). |
| Debrief | 10 | — | Open the Report tab together; answer the questions below. |

The room checks for other people's changes every few seconds, so nobody
needs to press Refresh.

## Reading the result

Open **Report** (or call `get_field_report`). Compare these numbers:

- **Proposals by origin.** If participants' own AI has an acceptance rate
  well below the server AI's, and enough proposals were reviewed for the
  difference to mean something, hypothesis 6 is in trouble. The report shows
  each rate with how many reviews it is based on, so a single review can't
  pass for a finding.
- **Proposals by the mode they were made under:** Round A against Round B.
- **Median review time.** If proposals sit unreviewed, curation is too noisy or too slow.
- **Participants.** Channels used (`mcp`, `external_llm`, `direct`), contributions their AI drafted, and how many reviews each person did.
- **Conflicts:** accepted, resolved and dismissed, with the notes on each in the State view.

Record a **negative result** for any of these:

- two clients described the problem's state in incompatible ways (H1);
- any contribution's attribution was disputed (H2);
- a real disagreement was resolved without anyone writing down how (H3: the room requires a note, so this would mean the note was empty of meaning);
- most proposals were rejected, or left unreviewed (H4);
- the clipboard participant contributed as well as the MCP participants (H5);
- participant-AI acceptance clearly trailed server-AI acceptance (H6).

## Debrief questions

1. Did your AI's summary of the problem match what you saw in the room?
2. Which proposal did you reject, and why?
3. Did closing a conflict feel like a decision, or like tidying up?
4. Would you have contributed the same things without an AI?
5. In participant mode, did you notice your AI doing curation work? Did it cost you anything you cared about?

## Keeping the data

Every event is in the log. Export it for analysis with
`GET <room>/api/problems/<id>/events`, together with the report from
`GET <room>/api/problems/<id>/report`. Nothing in the log can be edited
after the fact, so the export is the record of the session.
