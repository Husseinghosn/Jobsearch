// Run: node --test "automation/tests/*.spec.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePending } from '../../sync-batch-input.mjs';
import { rankOf, postedOf, selectEntries } from '../select-batch.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'select-batch.mjs');

const PIPELINE = `# Pipeline

## Pending

- [ ] https://boards.greenhouse.io/a/jobs/1 | Alpha | Senior Backend Engineer | Remote | posted: 2026-11-01 | rank: 4.5/5 — strong Python/AWS match
- [ ] https://boards.greenhouse.io/b/jobs/2 | Beta | Backend Engineer | posted: 2026-11-06 | rank: 4.5/5 — same score, newer
- [ ] https://jobs.lever.co/c/3 | Gamma | Staff Engineer | rank: 3.9/5 — stretch on seniority
- [ ] https://jobs.lever.co/d/4 | Delta | Sales Engineer | rank: 2.0/5 — wrong function
- [ ] https://jobs.ashbyhq.com/e/5 | Epsilon | Platform Engineer | posted: 2026-11-07
- [ ] https://boards.greenhouse.io/a/jobs/1 | Alpha | Senior Backend Engineer | rank: 4.5/5 — duplicate line
- [ ] https://jobs.lever.co/f/6 | Zeta | Backend Engineer | rank: 3.5/5 — exactly at the bar
- [x] https://jobs.lever.co/g/7 | Eta | Done already | rank: 5.0/5 — processed

## Processed
`;

test('rankOf / postedOf read the labeled segments', () => {
  assert.equal(rankOf('posted: 2026-11-01 | rank: 4.5/5 — x'), 4.5);
  assert.equal(rankOf('rank: 3/5 — x'), 3);
  assert.equal(rankOf('note: rank: is not a rank'), null);
  assert.equal(rankOf(''), null);
  assert.equal(postedOf('posted: 2026-11-01 | rank: 4.5/5'), '2026-11-01');
  assert.equal(postedOf('rank: 4.5/5'), '');
});

test('selectEntries filters by rank, dedupes, orders by rank then recency, caps', () => {
  const pending = parsePending(PIPELINE);
  const existing = new Set(['https://jobs.lever.co/c/3']);
  const r = selectEntries(pending, existing, { minRank: 3.5, max: 2 });
  assert.deepEqual(r.selected.map((e) => e.company), ['Beta', 'Alpha']); // tie on 4.5 → newer first
  assert.equal(r.alreadyQueued, 2); // Gamma in batch + Alpha duplicate line
  assert.equal(r.unranked, 1); // Epsilon
  assert.equal(r.belowMin, 1); // Delta
  assert.equal(r.eligible, 3); // Beta, Alpha, Zeta (3.5 is inclusive)
  assert.equal(r.deferred, 1);
});

test('unranked rows are excluded unless asked for', () => {
  const pending = parsePending(PIPELINE);
  const r = selectEntries(pending, new Set(), { minRank: 4, max: 10, includeUnranked: true });
  assert.deepEqual(r.selected.map((e) => e.company), ['Beta', 'Alpha', 'Epsilon']);
});

test('max 0 queues nothing', () => {
  const r = selectEntries(parsePending(PIPELINE), new Set(), { max: 0 });
  assert.equal(r.selected.length, 0);
});

test('CLI appends batch rows, continues ids from batch-state, and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'select-batch-'));
  mkdirSync(join(dir, 'batch'));
  const pipeline = join(dir, 'pipeline.md');
  const input = join(dir, 'batch', 'batch-input.tsv');
  const state = join(dir, 'batch', 'batch-state.tsv');
  writeFileSync(pipeline, PIPELINE);
  writeFileSync(state, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n7\thttps://jobs.lever.co/c/3\tcompleted\t-\t-\t7\t3.9\t-\t0\n');
  const args = [SCRIPT, '--pipeline', pipeline, '--input', input, '--state', state, '--max', '2', '--json'];

  const first = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf-8' }));
  assert.deepEqual(first.queued.map((q) => [q.id, q.company]), [[8, 'Beta'], [9, 'Alpha']]);
  const lines = readFileSync(input, 'utf-8').trim().split('\n').filter((l) => !l.startsWith('#'));
  assert.deepEqual(lines.map((l) => l.split('\t').slice(0, 3)), [
    ['8', 'https://boards.greenhouse.io/b/jobs/2', 'pipeline'],
    ['9', 'https://boards.greenhouse.io/a/jobs/1', 'pipeline'],
  ]);

  // Second run picks the next eligible row (Zeta) and never re-queues the first two.
  const second = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf-8' }));
  assert.deepEqual(second.queued.map((q) => [q.id, q.company]), [[10, 'Zeta']]);
  const third = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf-8' }));
  assert.equal(third.queued.length, 0);
});

test('CLI --dry-run writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'select-batch-'));
  const pipeline = join(dir, 'pipeline.md');
  const input = join(dir, 'batch-input.tsv');
  writeFileSync(pipeline, PIPELINE);
  const out = JSON.parse(execFileSync(process.execPath,
    [SCRIPT, '--pipeline', pipeline, '--input', input, '--state', join(dir, 'none.tsv'), '--dry-run', '--json'],
    { encoding: 'utf-8' }));
  assert.deepEqual(out.queued.map((q) => q.company), ['Beta', 'Alpha', 'Gamma', 'Zeta']);
  assert.throws(() => readFileSync(input));
});

test('CLI rejects bad flags', () => {
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, '--max', '-1'], { stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, '--min-rank', '9'], { stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, '--bogus'], { stdio: 'pipe' }));
});
