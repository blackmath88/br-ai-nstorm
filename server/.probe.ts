import { readFileSync } from 'node:fs'
import { extractUnits, kindFor } from './adoption/markdown.js'
const r = extractUnits(readFileSync(process.argv[2], 'utf8'))
console.log('title:', r.title, 'skipped:', r.skipped)
for (const u of r.units) console.log(`${kindFor(u).padEnd(12)} L${u.startLine}-${u.endLine} [${u.headings.join(' > ')}] ${u.text.slice(0, 100)}`)
