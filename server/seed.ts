import { ensureProblem } from './store.js'

export async function ensureSeedData() {
  await ensureProblem({
    id: 'campus-ai',
    title: 'How could universities jointly run an open AI service?',
    description: 'A cross-institutional problem spanning governance, product ownership, infrastructure, funding, trust and adoption.',
    createdAt: '2026-08-18T08:00:00.000Z',
    createdBy: 'person:achim',
  })
}
