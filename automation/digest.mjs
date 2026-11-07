#!/usr/bin/env node
/**
 * automation/digest.mjs — the morning digest: what to do today, in one file.
 *
 * Fork-local (declared in config/local-paths.txt, never touched by the updater).
 * Zero LLM tokens. Read-only over career-ops data; the only writes are the digest
 * itself: output/today.md plus a dated copy in output/digests/.
 *
 * Sections:
 *   1. Apply today   — Evaluated rows scoring >= --min-score, best first, with the
 *                      report, PDF flag and who you already know there (linkedin-join)
 *   2. Needs you     — batch rows that stopped at a gate (needs_confirmation),
 *                      failed, or paused on a rate limit
 *   3. Follow-ups    — overdue / due today (followup-cadence) + latest drafts file
 *   4. Closing soon  — postings whose deadline is near (closing-soon)
 *   5. Scorecard     — referral vs cold: applications, response rate, interview rate
 *
 * Every section is loaded independently; one failing source becomes a warning
 * line in the digest instead of failing the whole run.
 *
 * Usage:
 *   node automation/digest.mjs [--min-score 4.0] [--max-apply 10] [--today YYYY-MM-DD]
 *                         [--stdout] [--json]
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot, resolveTrackerPath } from '../path-resolver.mjs';
import { parseStatusLogStages, recoverFunnelStages } from '../funnel-stages.mjs';
import { parseContacts } from '../contacts.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const CHECKOUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// funnel-stages.mjs ranks: Applied 1, Responded/Rejected 2, Assessment 3,
// Interview 4, Offer 5, Hired 6.
export const STAGE = Object.freeze({ APPLIED: 1, RESPONDED: 2, INTERVIEW: 4 });

/** '4.2/5' → 4.2; anything unparseable → null. */
export function scoreOf(cell) {
  const m = /(\d+(?:\.\d+)?)\s*\/\s*5/.exec(String(cell ?? ''));
  return m ? Number(m[1]) : null;
}

/** '[12](../reports/012-acme-2026-11-07.md)' → 'reports/012-acme-2026-11-07.md' (or null). */
export function reportPathOf(cell) {
  const m = /\(([^)]+\.md)\)/.exec(String(cell ?? ''));
  return m ? m[1].replace(/^(\.\.\/)+/, '') : null;
}

/** The posting URL from a report's `**URL:** https://…` header line (or null). */
export function reportUrlOf(reportText) {
  const m = /^\*\*URL:\*\*\s*(https?:\/\/\S+)/m.exec(String(reportText ?? ''));
  return m ? m[1] : null;
}

const pct = (n, d) => (d === 0 ? '—' : `${Math.round((100 * n) / d)}%`);

/**
 * Referral vs cold scorecard. Pure, unit-tested.
 * An application is a REFERRAL when data/contacts.tsv holds an `internal-referral`
 * contact pointing at its tracker #, or its Notes carry the tag `channel: referral`.
 * Everything else that reached Applied is COLD.
 *
 * @param {Array<{id:number,status:string,notes?:string}>} rows - tracker rows
 * @param {string} statusLogText - status-log.tsv contents
 * @param {Array<{type:string,tracker:string|null}>} contacts - parseContacts().contacts
 */
export function channelScorecard(rows, statusLogText, contacts) {
  const statusByNum = new Map(rows.map((r) => [Number(r.id), r.status]));
  const reached = recoverFunnelStages(statusByNum, parseStatusLogStages(statusLogText));

  const referralNums = new Set(
    contacts.filter((c) => c.type === 'internal-referral' && c.tracker && /^\d+$/.test(c.tracker))
      .map((c) => Number(c.tracker)),
  );
  for (const r of rows) if (/\bchannel:\s*referral\b/i.test(r.notes || '')) referralNums.add(Number(r.id));

  const blank = () => ({ applied: 0, responded: 0, interviewed: 0 });
  const card = { referral: blank(), cold: blank() };
  for (const [num, stage] of reached) {
    if (stage < STAGE.APPLIED) continue;
    const bucket = referralNums.has(num) ? card.referral : card.cold;
    bucket.applied++;
    if (stage >= STAGE.RESPONDED) bucket.responded++;
    if (stage >= STAGE.INTERVIEW) bucket.interviewed++;
  }
  for (const b of Object.values(card)) {
    b.responseRate = pct(b.responded, b.applied);
    b.interviewRate = pct(b.interviewed, b.applied);
  }
  return card;
}

/** The 4-week decision rule from automation/README.md, applied to the scorecard. */
export function verdict(card) {
  const total = card.referral.applied + card.cold.applied;
  const interviews = card.referral.interviewed + card.cold.interviewed;
  if (total < 20) return `Not enough data yet (${total}/20 applications). Keep going; don't change strategy on noise.`;
  if (interviews === 0) return '20+ applications and no interviews: the problem is targeting or the CV, not volume. Revisit target roles and run `/career-ops ats` on your CV before applying more.';
  const coldOk = card.cold.applied > 0 && card.cold.interviewed / card.cold.applied >= 0.05;
  const refOk = card.referral.applied > 0 && card.referral.interviewed / card.referral.applied >= 0.15;
  if (coldOk || refOk) return 'Working (cold ≥5% or referral ≥15% interview rate). Raise the daily cap only as far as tailoring quality holds.';
  return 'Below target. Shift effort toward referrals and tighter targeting before adding volume.';
}

function runJson(script, args, env) {
  const out = execFileSync(process.execPath, [join(CHECKOUT_ROOT, script), ...args], {
    cwd: CHECKOUT_ROOT, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function readIf(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

/** batch-state.tsv rows that need a human, newest first. */
export function batchAttention(stateText) {
  const out = [];
  for (const line of String(stateText).split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#') || line.startsWith('id\t')) continue;
    const [id, url, status, startedAt, completedAt, , , error] = line.split('\t');
    if (['needs_confirmation', 'failed', 'paused_rate_limit'].includes(status)) {
      out.push({ id, url, status, when: completedAt && completedAt !== '-' ? completedAt : startedAt, detail: error && error !== '-' ? error : '' });
    }
  }
  return out.sort((a, b) => String(b.when).localeCompare(String(a.when)));
}

function parseArgs(argv) {
  const out = { minScore: 4.0, maxApply: 10, today: new Date().toISOString().slice(0, 10), stdout: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`Missing value for ${a}`); return v; };
    if (a === '--min-score') out.minScore = Number(val());
    else if (a === '--max-apply') out.maxApply = Number(val());
    else if (a === '--today') out.today = val();
    else if (a === '--stdout') out.stdout = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.today)) throw new Error('--today must be YYYY-MM-DD');
  return out;
}

export function buildDigest({ root, opts, env = process.env }) {
  const warnings = [];
  const load = (label, fn, fallback) => {
    try { return fn(); } catch (err) {
      warnings.push(`${label}: ${String(err.stderr || err.message).trim().split('\n')[0]}`);
      return fallback;
    }
  };

  const rows = load('tracker', () => runJson('tracker.mjs', ['query', '--json'], env), []);
  const trackerPath = load('tracker path', () => resolveTrackerPath(root), join(root, 'data/applications.md'));
  const statusLog = readIf(join(dirname(trackerPath), 'status-log.tsv'));
  const contacts = load('contacts', () => parseContacts(readIf(join(root, 'data/contacts.tsv'))).contacts, []);
  const connections = existsSync(join(root, 'data/Connections.csv'))
    ? load('linkedin-join', () => runJson('linkedin-join.mjs', ['--tracker-only'], env).targets || [], [])
    : null;
  const cadence = load('followup-cadence', () => runJson('followup-cadence.mjs', ['--json'], env), null);
  const closing = load('closing-soon', () => runJson('closing-soon.mjs', ['--today', opts.today], env), null);
  const attention = batchAttention(readIf(join(CHECKOUT_ROOT, 'batch', 'batch-state.tsv')));

  const byCompany = new Map((connections || []).map((t) => [t.tracker?.num, t]));
  const toApply = rows
    .filter((r) => r.status === 'Evaluated' && (scoreOf(r.score) ?? 0) >= opts.minScore)
    .sort((a, b) => scoreOf(b.score) - scoreOf(a.score) || String(b.date).localeCompare(String(a.date)))
    .map((r) => {
      const report = reportPathOf(r.report);
      return { ...r, reportPath: report, url: report ? reportUrlOf(readIf(join(root, report))) : null };
    });

  const followups = (cadence?.entries || [])
    .filter((e) => ['overdue', 'urgent'].includes(e.urgency) || (e.daysUntilNext !== null && e.daysUntilNext <= 0));
  const outDir = join(root, 'output');
  const drafts = existsSync(outDir)
    ? readdirSync(outDir).filter((f) => /^followup-drafts-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().pop() : undefined;

  const card = channelScorecard(rows, statusLog, contacts);

  return { today: opts.today, minScore: opts.minScore, maxApply: opts.maxApply, toApply, byCompany,
    connectionsLoaded: connections !== null, attention, followups, drafts, closing, card, warnings };
}

export function renderMarkdown(d) {
  const L = [];
  L.push(`# Job search — ${d.today}`, '');
  L.push(`**Today:** apply to up to 5 of these, send referral asks first where you know someone, clear the follow-ups.`, '');

  L.push(`## 1. Apply today (score ≥ ${d.minScore})`, '');
  if (d.toApply.length === 0) {
    L.push('_Nothing new above the bar. That is normal on some days — do not lower the bar to fill the list._', '');
  } else {
    for (const r of d.toApply.slice(0, d.maxApply)) {
      L.push(`- **${r.company}** — ${r.role} · **${r.score}** · PDF ${r.pdf === '✅' ? 'ready' : 'missing'} · tracker #${r.id}`);
      if (r.reportPath) L.push(`  - Report: \`${r.reportPath}\``);
      L.push(r.url
        ? `  - Apply: \`/career-ops apply ${r.url}\` (fills the form, stops before Submit)`
        : '  - Apply: `/career-ops apply <posting URL>` (no URL in the report)');
      const t = d.byCompany.get(Number(r.id));
      if (t?.connections?.length) {
        const names = t.connections.slice(0, 3).map((c) => `${c.name}${c.title ? ` (${c.title})` : ''}`).join(', ');
        L.push(`  - **You know:** ${names} → ask for a referral before applying: \`/career-ops contacto ${r.company}\``);
      } else if (t?.secondDegreeSearch) {
        L.push(`  - No direct connection. 2nd-degree search: ${t.secondDegreeSearch}`);
      }
    }
    if (d.toApply.length > d.maxApply) L.push(`- …and ${d.toApply.length - d.maxApply} more (\`node tracker.mjs query --status Evaluated --min-score ${d.minScore}\`)`);
    if (!d.connectionsLoaded) L.push('', '_Tip: export your LinkedIn connections to `data/Connections.csv` to see who you know at each company._');
    L.push('');
  }

  L.push('## 2. Needs you', '');
  if (d.attention.length === 0) L.push('_Nothing blocked._', '');
  else {
    for (const a of d.attention.slice(0, 15)) L.push(`- \`${a.status}\` ${a.url}${a.detail ? ` — ${a.detail}` : ''}`);
    if (d.attention.some((a) => a.status === 'paused_rate_limit')) L.push('', 'Rate-limited rows resume with `batch/batch-runner.sh --resume-paused`; failed rows with `--retry-failed`.');
    L.push('');
  }

  L.push('## 3. Follow-ups due', '');
  if (d.followups.length === 0) L.push('_None due._', '');
  else {
    for (const f of d.followups.slice(0, 15)) L.push(`- **${f.company}** — ${f.role} (${f.status}, ${f.daysSinceApplication}d since applying, follow-up #${f.followupCount + 1} due ${f.nextFollowupDate})`);
    L.push('', d.drafts ? `Drafted messages: \`output/${d.drafts}\` (review, then send yourself).` : 'Draft them with `/career-ops followup`.', '');
  }

  L.push('## 4. Closing soon', '');
  const closingRows = [...(d.closing?.overdue || []), ...(d.closing?.closingSoon || [])];
  if (closingRows.length === 0) L.push('_Nothing closing in the next 7 days._', '');
  else {
    for (const c of closingRows.slice(0, 10)) {
      const when = c.daysOverdue !== undefined ? `closed ${c.daysOverdue}d ago` : `closes ${c.closes} (${c.daysLeft}d)`;
      L.push(`- **${c.company || '?'}** — ${c.role || ''} · ${when}`);
    }
    L.push('');
  }

  L.push('## 5. Scorecard — referral vs cold', '');
  L.push('| Channel | Applied | Any response | Interview+ |', '|---|---|---|---|');
  for (const [name, b] of Object.entries(d.card)) L.push(`| ${name} | ${b.applied} | ${b.responseRate} | ${b.interviewRate} |`);
  L.push('', `**Verdict:** ${verdict(d.card)}`, '');
  L.push('_Referral = an `internal-referral` contact saved for that tracker # (via `/career-ops contacto`), or `channel: referral` in the row notes._', '');

  if (d.warnings.length) { L.push('## Warnings', ''); for (const w of d.warnings) L.push(`- ${w}`); L.push(''); }
  return L.join('\n');
}

if (isMainModule(import.meta.url)) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(1); }
  if (opts.help) {
    console.log('Usage: node automation/digest.mjs [--min-score 4.0] [--max-apply 10] [--today YYYY-MM-DD] [--stdout] [--json]');
    process.exit(0);
  }
  const root = getCareerOpsRoot();
  const d = buildDigest({ root, opts });
  if (opts.json) {
    console.log(JSON.stringify({ ...d, byCompany: undefined, toApply: d.toApply.length, scorecard: d.card }, null, 2));
    process.exit(0);
  }
  const md = renderMarkdown(d);
  if (opts.stdout) { console.log(md); process.exit(0); }
  const outDir = join(root, 'output');
  mkdirSync(join(outDir, 'digests'), { recursive: true });
  writeFileSync(join(outDir, 'today.md'), md);
  writeFileSync(join(outDir, 'digests', `${opts.today}.md`), md);
  console.log(`Digest written: ${join(outDir, 'today.md')}`);
  // Stable one-line summary; daily.ps1 puts this line in the Windows notification.
  console.log(`Summary: ${d.toApply.length} to apply, ${d.followups.length} follow-ups, ${d.attention.length} need you${d.warnings.length ? `, ${d.warnings.length} warning(s)` : ''}`);
}
