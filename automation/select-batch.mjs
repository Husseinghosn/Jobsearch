#!/usr/bin/env node
/**
 * automation/select-batch.mjs — queue only the best-ranked pending postings for evaluation.
 *
 * Fork-local (declared in config/local-paths.txt, never touched by the updater).
 *
 * Why this exists: upstream `sync-batch-input.mjs` appends EVERY pending row of
 * data/pipeline.md to batch/batch-input.tsv. In an unattended daily run that means
 * paying a full LLM evaluation for every posting the scanner found. This script
 * is the same sync with a gate in front of it:
 *
 *   1. drop rows already queued or processed (batch-input.tsv / batch-state.tsv)
 *   2. keep rows whose `rank:` annotation (written by rank-pipeline.mjs) >= --min-rank
 *   3. order by rank, then newest `posted:` date (apply-early evidence), then file order
 *   4. append at most --max rows
 *
 * Parsing, URL safety, dedupe and row format are reused from sync-batch-input.mjs,
 * so the rows it writes are byte-compatible with what batch-runner.sh expects.
 *
 * Usage:
 *   node automation/select-batch.mjs [--min-rank 3.5] [--max 15] [--include-unranked]
 *                               [--dry-run] [--json]
 *                               [--pipeline <path>] [--input <path>] [--state <path>]
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parsePending, urlsFromTsv, maxTsvId, planBatchRows } from '../sync-batch-input.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const CHECKOUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = Object.freeze({ minRank: 3.5, max: 15, includeUnranked: false });

/** `rank: 4.2/5 — reason` → 4.2, or null when the row was never ranked. */
export function rankOf(notes) {
  const m = /(?:^|\|\s*)rank:\s*(\d+(?:\.\d+)?)\s*\/\s*5/.exec(notes || '');
  return m ? Number(m[1]) : null;
}

/** `posted: 2026-11-05` → '2026-11-05', or '' when the scanner had no date. */
export function postedOf(notes) {
  const m = /(?:^|\|\s*)posted:\s*(\d{4}-\d{2}-\d{2})/.exec(notes || '');
  return m ? m[1] : '';
}

/**
 * Pure selection step (no I/O) so it can be unit-tested.
 * @param {Array<{url:string, company:string, notes:string}>} pending - from parsePending()
 * @param {Set<string>} existingUrls - URLs already in batch-input.tsv / batch-state.tsv
 * @param {{minRank?:number, max?:number, includeUnranked?:boolean}} [opts]
 */
export function selectEntries(pending, existingUrls, opts = {}) {
  const { minRank, max, includeUnranked } = { ...DEFAULTS, ...opts };
  const seen = new Set();
  const fresh = [];
  let alreadyQueued = 0;
  pending.forEach((e, index) => {
    if (existingUrls.has(e.url) || seen.has(e.url)) { alreadyQueued++; return; }
    seen.add(e.url);
    fresh.push({ ...e, index, rank: rankOf(e.notes), posted: postedOf(e.notes) });
  });

  const unranked = fresh.filter((e) => e.rank === null);
  const belowMin = fresh.filter((e) => e.rank !== null && e.rank < minRank);
  const eligible = fresh.filter((e) => (e.rank === null ? includeUnranked : e.rank >= minRank));

  eligible.sort((a, b) =>
    (b.rank ?? -1) - (a.rank ?? -1)
    || (b.posted || '').localeCompare(a.posted || '')
    || a.index - b.index);

  const selected = eligible.slice(0, Math.max(0, max));
  return {
    pending: pending.length,
    alreadyQueued,
    unranked: unranked.length,
    belowMin: belowMin.length,
    eligible: eligible.length,
    deferred: eligible.length - selected.length,
    selected,
  };
}

function parseArgs(argv) {
  const out = { ...DEFAULTS, dryRun: false, json: false, pipeline: null, input: null, state: null };
  const need = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--min-rank': out.minRank = Number(need(i, a)); i++; break;
      case '--max': out.max = Number(need(i, a)); i++; break;
      case '--include-unranked': out.includeUnranked = true; break;
      case '--dry-run': out.dryRun = true; break;
      case '--json': out.json = true; break;
      case '--pipeline': out.pipeline = need(i, a); i++; break;
      case '--input': out.input = need(i, a); i++; break;
      case '--state': out.state = need(i, a); i++; break;
      case '--help': case '-h': out.help = true; break;
      default: throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (!Number.isFinite(out.minRank) || out.minRank < 0 || out.minRank > 5) throw new Error('--min-rank must be between 0 and 5');
  if (!Number.isInteger(out.max) || out.max < 0) throw new Error('--max must be a non-negative integer');
  return out;
}

const USAGE = `Usage: node automation/select-batch.mjs [--min-rank 3.5] [--max 15] [--include-unranked] [--dry-run] [--json]
                                   [--pipeline <path>] [--input <path>] [--state <path>]
  Queues the top-ranked pending postings from data/pipeline.md into batch/batch-input.tsv.`;

if (isMainModule(import.meta.url)) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    process.exit(1);
  }
  if (args.help) { console.log(USAGE); process.exit(0); }

  const root = getCareerOpsRoot();
  const pipelineFile = args.pipeline ? resolve(args.pipeline)
    : existsSync(join(root, 'data/pipeline.md')) ? join(root, 'data/pipeline.md') : join(root, 'pipeline.md');
  const inputFile = args.input ? resolve(args.input) : join(CHECKOUT_ROOT, 'batch', 'batch-input.tsv');
  const stateFile = args.state ? resolve(args.state) : join(CHECKOUT_ROOT, 'batch', 'batch-state.tsv');

  const pending = existsSync(pipelineFile) ? parsePending(readFileSync(pipelineFile, 'utf-8')) : [];

  const existingUrls = new Set();
  let startId = 1;
  for (const f of [inputFile, stateFile]) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf-8');
    for (const u of urlsFromTsv(text, 1)) existingUrls.add(u);
    startId = Math.max(startId, maxTsvId(text) + 1);
  }

  const result = selectEntries(pending, existingUrls, args);
  const rows = planBatchRows(result.selected, existingUrls, startId);

  if (!args.dryRun && rows.length > 0) {
    if (!existsSync(inputFile)) {
      mkdirSync(dirname(inputFile), { recursive: true });
      writeFileSync(inputFile, '# batch-input.tsv — generated by automation/select-batch.mjs\n# id<tab>url<tab>source<tab>notes\n');
    }
    appendFileSync(inputFile, rows.map((r) => r.row).join('\n') + '\n');
  }

  const summary = {
    pipeline: pipelineFile,
    input: inputFile,
    dryRun: args.dryRun,
    minRank: args.minRank,
    max: args.max,
    pending: result.pending,
    alreadyQueued: result.alreadyQueued,
    unranked: result.unranked,
    belowMin: result.belowMin,
    deferred: result.deferred,
    queued: rows.map((r) => ({ id: r.id, url: r.url, company: r.company, rank: r.rank, posted: r.posted })),
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('=== select-batch: pipeline.md -> batch-input.tsv ===');
    console.log(`Pending: ${result.pending} | already queued/processed: ${result.alreadyQueued} | unranked: ${result.unranked} | below ${args.minRank}: ${result.belowMin} | over cap (left for tomorrow): ${result.deferred}`);
    for (const r of rows) console.log(`  + [${r.rank ?? 'unranked'}] ${r.company || '?'}  ${r.url}`);
    console.log(rows.length === 0 ? 'Nothing to queue.'
      : `${args.dryRun ? '(dry-run) would queue' : 'Queued'} ${rows.length} posting(s) for evaluation.`);
  }
}
