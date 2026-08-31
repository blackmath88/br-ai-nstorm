# br-ai-nstorm

A prototype for **AI-mediated collective problem solving**.

The visible product is simple:

- one shared problem,
- contributions from people,
- orchestration prompts,
- evaluation and provenance,
- a canonical current-state view,
- optional map and timeline views,
- and a clipboard-based “aperture” to any external LLM.

The deeper experiment is whether **independently controlled AI conversations can contribute bounded, interoperable objects to a shared problem memory**.

## Why React

The first concept was a single HTML file. This repo moves to React/Vite because the concept now needs:

- several synchronized views over one canonical state,
- reusable components,
- structured provenance,
- import/export workflows,
- per-user perspectives,
- and eventually persistence/multi-user support.

D3 is deliberately used only for the exploratory relationship map.

## Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Core views

### State
The canonical default. Questions, approaches, evidence, assumptions, tensions, and synthesis are explicit categories so people can understand the problem at a glance.

### Map
An exploratory D3 relationship view. Position is **not canonical** and is explicitly described as such.

### Timeline
A diachronic view of how the problem state evolved.

## Clipboard aperture

`Think with my AI` exports an interchange package.

Paste it into ChatGPT, Claude, Mistral, etc. Think privately there. Ask the model to return only the specified `contributionPackage` JSON. Then paste that JSON back using `Import AI result`.

The private reasoning process stays outside the shared problem space. Only bounded contributions are imported.

## Prototype philosophy

Do not build the full Open Cognitive Bubbles protocol yet.

This repo tests a smaller question:

> Can a shared problem state become more useful when people can take that state into their own AI environment and return structured contributions?

## Next steps

1. Add local persistence.
2. Add participant switching.
3. Add contribution review before publishing.
4. Add evaluation states (`promising`, `needs evidence`, `contradicted`, `tested`, etc.).
5. Add explicit provenance/source cards.
6. Add a minimal backend and real multi-user rooms.
7. Only then test richer aperture permissions and ATProto-style record exchange.
