# Interchange schemas

These are intentionally **Lexicon-like**, but are not yet formal ATProto Lexicons.

## Context package

`ai.bridgework.brainstorm.contextPackage`

Purpose: transport a bounded snapshot of one shared problem into an external AI environment.

Contains:

- problem identity,
- shared semantic state,
- provenance,
- participant-specific updates,
- orchestration prompts,
- optional private draft,
- aperture rules,
- system prompt,
- expected output schema.

## Contribution package

`ai.bridgework.brainstorm.contributionPackage`

Purpose: return bounded contributions from an external AI conversation.

Minimal example:

```json
{
  "$type": "ai.bridgework.brainstorm.contributionPackage",
  "schemaVersion": "0.1",
  "problemId": "campus-ai",
  "participantId": "person:achim",
  "contributions": [
    {
      "kind": "question",
      "content": "Who would hold Product Owner authority across institutions?",
      "confidence": "high",
      "relationTo": ["q1"],
      "endorsement": "participant_review_required"
    }
  ],
  "privateProcessDisclosed": false
}
```

## Future formal records

Potential future record types:

- `ai.bridgework.brainstorm.problem`
- `ai.bridgework.brainstorm.contribution`
- `ai.bridgework.brainstorm.relation`
- `ai.bridgework.brainstorm.evaluation`
- `ai.bridgework.brainstorm.synthesis`

Only formalize these after the interaction model proves valuable.
