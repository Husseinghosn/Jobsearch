// Run: node --test "automation/tests/*.spec.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOf, reportPathOf, reportUrlOf, channelScorecard, verdict, batchAttention, renderMarkdown } from '../digest.mjs';

test('cell parsers', () => {
  assert.equal(scoreOf('4.2/5'), 4.2);
  assert.equal(scoreOf('—'), null);
  assert.equal(reportPathOf('[12](../reports/012-acme-2026-11-07.md)'), 'reports/012-acme-2026-11-07.md');
  assert.equal(reportPathOf('—'), null);
  assert.equal(reportUrlOf('# x\n\n**URL:** https://jobs.lever.co/acme/1\n'), 'https://jobs.lever.co/acme/1');
  assert.equal(reportUrlOf('no url'), null);
});

const ROWS = [
  { id: 1, status: 'Applied', notes: '' },
  { id: 2, status: 'Rejected', notes: '' }, // reached Interview before rejection (ledger)
  { id: 3, status: 'Responded', notes: 'channel: referral' },
  { id: 4, status: 'Interview', notes: '' }, // referral via contacts.tsv
  { id: 5, status: 'SKIP', notes: '' }, // never counted
  { id: 6, status: 'Evaluated', notes: '' }, // not applied yet
  { id: 7, status: 'Rejected', notes: '' }, // cold, rejected without interview
];
const LEDGER = [
  '1\t2026-10-01\tEvaluated\tApplied\tset-status\t',
  '2\t2026-10-01\tEvaluated\tApplied\tset-status\t',
  '2\t2026-10-05\tApplied\tInterview\tset-status\t',
  '2\t2026-10-09\tInterview\tRejected\tset-status\t',
  '7\t2026-10-02\tApplied\tRejected\tset-status\t',
].join('\n');
const CONTACTS = [
  { type: 'internal-referral', tracker: '4' },
  { type: 'recruiter', tracker: '1' }, // a recruiter is not a referral
  { type: 'internal-referral', tracker: null },
];

test('channelScorecard splits referral vs cold using the highest stage ever reached', () => {
  const card = channelScorecard(ROWS, LEDGER, CONTACTS);
  assert.deepEqual(
    { applied: card.referral.applied, responded: card.referral.responded, interviewed: card.referral.interviewed },
    { applied: 2, responded: 2, interviewed: 1 });
  assert.deepEqual(
    { applied: card.cold.applied, responded: card.cold.responded, interviewed: card.cold.interviewed },
    { applied: 3, responded: 2, interviewed: 1 }); // #1 applied, #2 interview→rejected, #7 rejected
  assert.equal(card.cold.interviewRate, '33%');
  assert.equal(card.referral.responseRate, '100%');
});

test('verdict follows the 4-week decision rule', () => {
  const mk = (ra, ri, ca, ci) => ({ referral: { applied: ra, interviewed: ri }, cold: { applied: ca, interviewed: ci } });
  assert.match(verdict(mk(2, 1, 10, 0)), /Not enough data/);
  assert.match(verdict(mk(0, 0, 25, 0)), /targeting or the CV/);
  assert.match(verdict(mk(0, 0, 40, 2)), /Working/); // 5% cold
  assert.match(verdict(mk(5, 1, 20, 0)), /Working/); // 20% referral
  assert.match(verdict(mk(2, 0, 40, 1)), /Below target/);
});

test('batchAttention surfaces gated, failed and paused rows only', () => {
  const state = [
    'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
    '1\thttps://a\tcompleted\t2026-11-07T07:41\t2026-11-07T07:45\t1\t4.2\t-\t0',
    '2\thttps://b\tneeds_confirmation\t2026-11-07T07:41\t2026-11-07T07:44\t-\t-\tagency https://b - rerun with the agency\t0',
    '3\thttps://c\tfailed\t2026-11-06T07:41\t2026-11-06T07:50\t-\t-\ttimeout\t2',
    '4\thttps://d\tpaused_rate_limit\t2026-11-07T07:42\t-\t-\t-\tusage limit\t1',
  ].join('\n');
  const rows = batchAttention(state);
  assert.deepEqual(rows.map((r) => r.status), ['needs_confirmation', 'paused_rate_limit', 'failed']);
  assert.equal(rows[0].detail, 'agency https://b - rerun with the agency');
});

test('renderMarkdown produces every section and the apply command', () => {
  const md = renderMarkdown({
    today: '2026-11-07', minScore: 4, maxApply: 10,
    toApply: [{ id: 9, company: 'Acme', role: 'Backend Engineer', score: '4.4/5', pdf: '✅', reportPath: 'reports/009-acme.md', url: 'https://jobs.lever.co/acme/9' }],
    byCompany: new Map([[9, { connections: [{ name: 'Jane Roe', title: 'Staff Engineer' }] }]]),
    connectionsLoaded: true,
    attention: [], followups: [], drafts: undefined, closing: null,
    card: channelScorecard(ROWS, LEDGER, CONTACTS), warnings: ['closing-soon: boom'],
  });
  for (const h of ['## 1. Apply today', '## 2. Needs you', '## 3. Follow-ups due', '## 4. Closing soon', '## 5. Scorecard', '## Warnings']) {
    assert.ok(md.includes(h), `missing ${h}`);
  }
  assert.ok(md.includes('/career-ops apply https://jobs.lever.co/acme/9'));
  assert.ok(md.includes('**You know:** Jane Roe (Staff Engineer)'));
});
