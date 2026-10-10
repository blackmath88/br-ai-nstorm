/**
 * Level-1 adoption: a read-only, self-contained HTML view of a repository's
 * problem spaces. No backend, no MCP, no LLM, no build step — one file a
 * repository can publish with its docs or open locally.
 *
 * It renders the same projection the shared room renders, from the same
 * events, so "graduating" to a shared room changes where the log lives, not
 * what it says.
 */
import type { ContributionKind, ContributionRecord, ProblemState } from '../domain/types.js'
import type { ImportPlan } from './plan.js'

const SECTIONS: Array<{ kind: ContributionKind; title: string }> = [
  { kind: 'question', title: 'Open questions' },
  { kind: 'claim', title: 'Framing & claims' },
  { kind: 'approach', title: 'Approaches' },
  { kind: 'evidence', title: 'Evidence' },
  { kind: 'assumption', title: 'Assumptions & risks' },
  { kind: 'contradiction', title: 'Tensions' },
  { kind: 'synthesis', title: 'Synthesis' },
]

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Location, link and section of an imported contribution. */
function source(c: ContributionRecord): { where: string; url?: string; section?: string } {
  const ref = c.provenance.sourceRef
  if (!ref) return { where: c.provenance.sourceDetail ?? '' }
  const lines = ref.startLine === ref.endLine ? `#L${ref.startLine}` : `#L${ref.startLine}-L${ref.endLine}`
  return {
    where: `${ref.path}${lines}`,
    ...(ref.url ? { url: ref.url } : {}),
    ...(ref.section ? { section: ref.section } : {}),
  }
}

function card(c: ContributionRecord): string {
  const s = source(c)
  const link = s.url
    ? `<a href="${escape(s.url)}" rel="noopener">${escape(s.where)}</a>`
    : `<span>${escape(s.where)}</span>`
  return `<li class="card">
  <p>${escape(c.content)}</p>
  <div class="meta">${link}${s.section ? ` · ${escape(s.section)}` : ''}</div>
</li>`
}

function space(state: ProblemState, report: ImportPlan['report']['spaces'][number] | undefined): string {
  const active = state.contributions.filter((c) => c.status === 'active')
  const sections = SECTIONS.map(({ kind, title }) => {
    const items = active.filter((c) => c.kind === kind)
    if (items.length === 0) return ''
    return `<section><h3>${escape(title)} <span class="count">${items.length}</span></h3><ul>${items.map(card).join('\n')}</ul></section>`
  }).join('\n')

  const stale = report?.stale.length
    ? `<p class="note">${report.stale.length} item(s) from an earlier import are no longer in the source. A participant decides whether to supersede them.</p>`
    : ''
  const missing = report?.missingFiles.length
    ? `<p class="note">Missing source files: ${report.missingFiles.map(escape).join(', ')}</p>`
    : ''

  return `<article id="${escape(state.problem.id)}">
  <header>
    <div class="kicker">Problem space · ${escape(state.problem.id)}</div>
    <h2>${escape(state.problem.title)}</h2>
    <p class="lede">${escape(state.problem.description)}</p>
  </header>
  ${missing}${stale}
  <div class="grid">${sections}</div>
</article>`
}

export function renderStaticView(input: {
  title: string
  states: ProblemState[]
  report: ImportPlan['report']
  generatedAt: string
}): string {
  const { title, states, report, generatedAt } = input
  const nav = states
    .map((s) => `<a href="#${escape(s.problem.id)}">${escape(s.problem.shortTitle || s.problem.title)}</a>`)
    .join('')
  const origin = report.repository
    ? `${escape(report.repository)}${report.revision ? ` @ ${escape(report.revision.slice(0, 12))}` : ''}`
    : 'local files'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root{--bg:#f4f1ea;--paper:#fbfaf6;--ink:#233137;--muted:#6b777c;--line:#e2ddd2;--accent:#647b78;--chip:#dcefeb}
@media (prefers-color-scheme:dark){:root{--bg:#161c1f;--paper:#1e262a;--ink:#e7ecec;--muted:#9aa7ab;--line:#2f3a3f;--accent:#9cc3bd;--chip:#24403c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:26px;letter-spacing:-.03em;margin:0}h1 span{color:var(--accent)}
.sub{color:var(--muted);font-size:13px;margin:4px 0 18px}
nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:22px}nav a{border:1px solid var(--line);background:var(--paper);color:var(--ink);text-decoration:none;font-size:12px;font-weight:700;padding:6px 10px;border-radius:999px}
.banner{border-left:4px solid var(--accent);background:var(--paper);padding:10px 12px;border-radius:0 10px 10px 0;font-size:13px;color:var(--muted);margin-bottom:26px}
article{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:20px;margin-bottom:22px}
.kicker{font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:var(--muted)}
h2{margin:4px 0 6px;font-size:22px;letter-spacing:-.02em}.lede{margin:0 0 14px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
h3{font-size:13px;margin:6px 0 8px}.count{font-weight:600;color:var(--muted)}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.card{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--bg)}
.card p{margin:0;font-size:13.5px}.meta{margin-top:6px;font-size:11px;color:var(--muted);overflow-wrap:anywhere}.meta a{color:var(--accent)}
.note{font-size:12px;color:var(--muted);background:var(--chip);border-radius:10px;padding:8px 10px}
footer{font-size:11px;color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <h1>br-<span>ai</span>-nstorm · ${escape(title)}</h1>
  <p class="sub">Read-only problem-space view of ${origin}, generated ${escape(generatedAt)}.</p>
  <nav>${nav}</nav>
  <p class="banner">Every item below is quoted from a repository document and linked to its lines. Inclusion means “the document says so”, not “the group agrees”. Kinds follow the document’s own section headings. To discuss, relate or dispute these items, open the problem space in a shared room.</p>
  ${states.map((s) => space(s, report.spaces.find((r) => r.problemId === s.problem.id))).join('\n')}
  <footer>Generated by <code>npm run brainstorm -- build</code>. Edit the source documents, not this file.</footer>
</div>
</body>
</html>
`
}
