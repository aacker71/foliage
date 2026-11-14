export const meta = {
  name: 'three-pass-review',
  description: 'Owner-mandated triple adversarial review of one PR: correctness, seams, scope-law. All three must approve.',
  whenToUse: 'Every product-code PR before auto-merge is armed. args: { pr: <number> }',
  phases: [{ title: 'Review' }, { title: 'Synthesize' }],
}

const pr = args?.pr
if (!pr) return { error: 'args.pr required' }

const LENSES = [
  ['adversarial-correctness', 'Pass 1 — ADVERSARIAL CORRECTNESS'],
  ['seams-dependencies', 'Pass 2 — SEAMS AND DEPENDENCIES'],
  ['scope-law', 'Pass 3 — SCOPE COMPLETENESS AND LAW'],
]

const VERDICT = {
  type: 'object', additionalProperties: false,
  required: ['pass', 'verdict', 'findings'],
  properties: {
    pass: { type: 'string' },
    verdict: { type: 'string', enum: ['APPROVE', 'NEEDS-FIX'] },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'where', 'what'],
      properties: { severity: { type: 'string', enum: ['critical','major','minor'] },
        where: { type: 'string' }, what: { type: 'string' }, fix: { type: 'string' } } } },
    evidence: { type: 'string', description: 'What you executed/re-derived, not read' },
  },
}

phase('Review')
const verdicts = await parallel(LENSES.map(([key, title]) => () =>
  agent(
`Adopt the reviewer persona: read <repo>/.promptx/personas/agent-code-reviewer.md and <repo>/.claude/agents/reviewer.md, then run EXACTLY ONE pass of <repo>/.promptx/review-protocol.md: "${title}" — that section is your entire mandate; do not duplicate the other passes.
PR: #${pr} of aacker71/foliage. Diff: \`gh pr diff ${pr}\`. Repo read-only at <repo> (isolated worktrees for any execution). Set pass to "${key}".`,
    { label: key, phase: 'Review', model: 'sonnet', effort: 'high', schema: VERDICT },
  )
))

phase('Synthesize')
const got = verdicts.filter(Boolean)
const blocked = got.filter(v => v.verdict === 'NEEDS-FIX')
return {
  pr,
  passes: got.map(v => ({ pass: v.pass, verdict: v.verdict, findings: v.findings.length })),
  merge: blocked.length === 0 && got.length === 3 ? 'ARM' : 'BLOCK',
  blockers: blocked.flatMap(v => v.findings.filter(f => f.severity !== 'minor').map(f => `${v.pass}: ${f.where} — ${f.what}`)),
  minors: got.flatMap(v => v.findings.filter(f => f.severity === 'minor').map(f => `${v.pass}: ${f.where} — ${f.what}`)),
}
