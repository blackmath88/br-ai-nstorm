/**
 * Populates the local event log with a scripted multi-participant story.
 *
 *   npm run demo          — add the scenario (refuses if it has already run)
 *   npm run demo:reset    — delete the log and rebuild seed + scenario
 *
 * Everything is written through the real application services, so this is also
 * a smoke test of the whole write path.
 */
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildServices } from '../container.js'
import { days, hasRun, hours, runDemoScenario, steppedClock } from './scenario.js'

const dataFile = resolve(process.env.BRAINSTORM_DATA_FILE ?? 'server/data/memory.json')
const shouldReset = process.argv.includes('--reset')

async function main(): Promise<void> {
  if (shouldReset) {
    await rm(dataFile, { force: true })
    console.log(`Deleted ${dataFile}`)
  }

  // Spread the story over the last week so the timeline reads as history and
  // the "since you were here" feed has something in it.
  const clock = steppedClock(days(7), hours(3))

  const services = await buildServices({ clock })

  if (await hasRun(services)) {
    console.error(
      'The demo scenario is already in this log.\n' +
        'Run `npm run demo:reset` to wipe it and start over, or point\n' +
        'BRAINSTORM_DATA_FILE at a different file.',
    )
    process.exit(1)
  }

  const report = await runDemoScenario(services)

  console.log('\nDemo scenario written.\n')
  for (const problem of report.perProblem) {
    console.log(
      `  ${problem.problemId.padEnd(22)} ${String(problem.contributions).padStart(2)} contributions · ` +
        `${problem.conflicts} open conflict(s) · ${problem.pending} awaiting review`,
    )
  }
  console.log(
    `\n  ${report.contributions} contributions added · ${report.proposalsRaised} proposals raised by the curator\n` +
      `  ${report.proposalsAccepted} accepted · ${report.proposalsRejected} rejected · ${report.proposalsPending} left pending\n` +
      `  ${report.superseded} superseded · ${report.evaluations} evaluations\n`,
  )

  // Warn rather than pretend: if the curator's thresholds move, a surface can
  // quietly come out empty and the demo stops demonstrating anything.
  const thin: string[] = []
  if (report.conflictsOpen === 0) thin.push('no accepted conflicts — the State conflict band will be empty')
  if (report.proposalsPending === 0) thin.push('no pending proposals — the Curation queue will be empty')
  if (report.proposalsRejected === 0) thin.push('nothing rejected — the Curation history will show only acceptances')
  if (report.superseded === 0) thin.push('nothing superseded — the State superseded section will be hidden')
  if (thin.length > 0) {
    console.log('Thin spots (the curator may have shifted):')
    for (const line of thin) console.log(`  ! ${line}`)
    console.log('')
  }

  console.log('What to look at:')
  console.log('  State     campus-ai opens with an accepted, unresolved conflict above the columns,')
  console.log('            and a superseded contribution kept at the bottom.')
  console.log(`  Curation  ${report.proposalsPending} pending, plus ${report.proposalsAccepted} accepted and ${report.proposalsRejected} rejected in history.`)
  console.log('  Timeline  the whole story, with the curator named on proposals and people on decisions.')
  console.log('  Traces    sign in as each of Achim, Kai, Lea, Mara — each sees a different "your traces".')
  console.log('  Empty     research-onboarding is left untouched, so the quiet-problem states are visible.\n')

  console.log('Try it:')
  console.log('  npm run dev:server        # then npm run dev in another terminal')
  console.log('  BRAINSTORM_PARTICIPANT=Lea npm run mcp')
  console.log("  TOKEN=$(curl -s -X POST localhost:8787/api/auth/session \\")
  console.log("    -H 'content-type: application/json' -d '{\"participantId\":\"Kai\"}' | jq -r .token)")
  console.log('  curl -s localhost:8787/api/problems/campus-ai/curation -H "authorization: Bearer $TOKEN"\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
