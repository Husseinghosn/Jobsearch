# Jobsearch automation (Windows)

This repo is [career-ops](https://github.com/career-ops-hq/career-ops) v1.39 (MIT, unmodified)
plus this `automation/` folder. The folder wires career-ops into one unattended daily run on
Windows and adds a morning digest with a referral-vs-cold scorecard.

**Everything outside `automation/` is upstream.** Don't edit it: `npm run update` replaces it.
Your changes go in `automation/` (declared in `config/local-paths.txt`, so updates never touch it)
or in your own user-layer files (`modes/_custom.md`, `portals.yml`, `config/profile.yml`).

## What runs by itself, and what you do

| Stage | Who | Cost |
|---|---|---|
| Scan company boards (Greenhouse, Lever, Ashby APIs). Filters: title, location, salary, posted ≤ 7 days | daily task | zero tokens |
| Rank new postings 0–5 with a one-line reason | daily task | small LLM call each (max 40/day) |
| Queue only rank ≥ 3.5, best first, **max 15/day** (`automation/select-batch.mjs`) | daily task | zero tokens |
| Full evaluation, tailored CV PDF (fact-checked against `cv.md`), tracker row | daily task | LLM (max 15/day) |
| Match your LinkedIn connections to each company | daily task (digest) | zero tokens, offline |
| Draft follow-up messages | Mon + Thu task | LLM, drafts only |
| Morning digest `output\today.md` + Windows notification | daily task | zero tokens |
| Back up your data to your private `career-data` repo | daily task | — |
| **Ask for referrals** (Claude drafts with `/career-ops contacto`) | **you send** | — |
| **Fill the application form** (`/career-ops apply <url>` fills it in a Playwright browser) | **you review + click Submit** | — |
| **Log replies** (`/career-ops reply-watch`, or paste the email) | **you confirm** | — |

Expect about **20–30 minutes a day**: 3–5 applications at 2–4 minutes each on Greenhouse
(longer on Lever, Ashby and Workday), 1–3 referral messages, and logging replies.

### Why the line is drawn there

| Lever | Best evidence | Strength |
|---|---|---|
| Referrals | Fed study (62k applicants): about 2.2× interview odds. Vendor data: 7–11× hire rate | strong |
| Tailoring | Kickresume controlled test: 18% vs 10% response. Huntr (1.39M applications): 5.75% vs 2.68% | moderate |
| Applying early | ERE (6,600 hires): early applicants do better; size unclear | moderate on direction |
| Volume (auto-apply) | User reports: 0.4–2% response | weak, but consistent |

Submitting stays with you for three reasons:

- career-ops has no way to submit, and its maintainers reject PRs that add one.
- LinkedIn's User Agreement (§8.2) bans automation.
- The evidence says the submit click is not the bottleneck.

## One-time setup

1. **Make this repo private** on GitHub (Settings → General → Danger Zone → Change visibility).
   Then turn off GitHub Actions (Settings → Actions → General → Disable actions). Upstream
   ships 28 workflows, including scheduled ones, and you don't need them.
   Make sure the default branch is named **`main`**: `npm run update` only commits there.
2. **Install:**
   - Node.js 22.13+ ([nodejs.org](https://nodejs.org))
   - Git for Windows ([git-scm.com](https://git-scm.com/download/win)), which provides the Git Bash the batch runner needs
   - Claude Code ([code.claude.com](https://code.claude.com)); sign in once by running `claude`
3. **Clone and install** (PowerShell):
   ```powershell
   git clone https://github.com/husseinghosn/Jobsearch.git $HOME\Jobsearch
   cd $HOME\Jobsearch
   npm install
   npx playwright install chromium
   ```
4. **Keep your data outside the code**, in its own private repo (upstream's recommended backup
   pattern). Create an empty **private** repo named `career-data` on GitHub, then:
   ```powershell
   mkdir $HOME\career-data
   git -C $HOME\career-data init -b main
   git -C $HOME\career-data remote add origin https://github.com/husseinghosn/career-data.git
   Set-Content -NoNewline .career-ops-data "$HOME\career-data"   # git-ignored marker
   ```
   After each run, `daily.ps1` commits and pushes this folder. It skips the push if a staged
   file looks like an API key. If you've never committed with git on this PC, set your
   identity first:
   `git config --global user.name "Your Name"` and `git config --global user.email you@example.com`.
5. **Playwright for Claude** (`apply` uses it to fill forms): run `claude`, then type
   `/plugin install playwright@claude-plugins-official`.
6. **Onboard:** in `claude`, type `/career-ops`. It interviews you and writes `cv.md`,
   `config/profile.yml`, `portals.yml` and `modes/_profile.md` into your data root. Choose
   `spend_tier: standard`. Give it your real CV: the fact-checker blocks any claim not
   found in `cv.md`.
7. **House rules:** copy `automation\seed\_custom.md` to `$HOME\career-data\modes\_custom.md`.
   This sets the 5-a-day cap, referral-before-cold and never-guess rules.
8. **Filters:** merge `automation\seed\portals-filters.yml` into `$HOME\career-data\portals.yml`
   (edit the lines marked EDIT). These filters are the main control on cost and noise.
9. **LinkedIn connections** (optional, recommended): LinkedIn → Settings → Data privacy →
   Get a copy of your data → Connections. Save the file as `$HOME\career-data\data\Connections.csv`.
10. **Dry run** (no tokens spent, nothing written):
    ```powershell
    powershell -NoProfile -ExecutionPolicy Bypass -File automation\daily.ps1 -DryRun
    ```
    Then a small real run: `... -File automation\daily.ps1 -MaxEvaluations 2`. Check that
    `$HOME\career-data\data\logs\daily-<date>.log`, `$HOME\career-data\output\today.md`, the
    PDFs in `output\` and the new rows in `data\applications.md` look right.
11. **Schedule it:**
    ```powershell
    powershell -NoProfile -ExecutionPolicy Bypass -File automation\install-schedule.ps1
    ```
    This registers `\career-ops\daily` (07:40 every day) and `\career-ops\followup-sweep`
    (Mon/Thu 08:10) for your user, with no admin rights. A run missed while the PC was off
    starts at the next logon.

## Your daily routine

1. Open `$HOME\career-data\output\today.md`, or run `claude` and say **"today"**.
2. Referral asks first: for each company where the digest says *You know: …*, run
   `/career-ops contacto <company>` and send the message yourself.
3. Applications: `/career-ops apply <url>` for the top 3–5. Review the fields it flags, attach
   anything extra, then **click Submit yourself**. Say "submitted" so it marks the row Applied
   and schedules the follow-up.
4. Follow-ups: review `output\followup-drafts-<date>.md` and send the ones you agree with.
5. Replies: paste employer emails and say **"log reply"**.

**Tracker dashboard:**

- Run `npm --prefix web ci` once, then `npm run ui` any time. It opens `http://127.0.0.1:3000`
  with Today, Pipeline, Follow-ups and Analytics pages. Upstream labels it alpha.
- Alternative: `npm run serve:dashboard`, a terminal UI that needs Go 1.26+.
- Either way, the tracker itself is `$HOME\career-data\data\applications.md`.

## The 4-week check (bottom of `today.md`)

The scorecard splits **referral** from **cold** applications. A referral is a contact saved
as `internal-referral` for that tracker #, or `channel: referral` in the row's notes. The
`_custom.md` rules tag these for you.

- **20+ applications and 0 interviews:** the problem is targeting or the CV, not volume.
  Revisit target roles and run `/career-ops ats`.
- **Cold interview rate ≥ 5%, or referral ≥ 15%:** it's working. Raise caps only while quality holds.
- **Otherwise:** shift time toward referrals and tighten `portals.yml` before adding volume.

## Knobs

| What | Where | Default |
|---|---|---|
| Evaluations per day | `install-schedule.ps1 -MaxEvaluations N` (or `daily.ps1 -MaxEvaluations`) | 15 |
| Ranking calls per day / rank bar | `daily.ps1 -RankLimit 40 -MinRank 3.5` | 40 / 3.5 |
| Posting age | `daily.ps1 -SinceDays 7` and `max_posting_age_days` in `portals.yml` | 7 |
| Digest score bar | `node automation/digest.mjs --min-score 4.0` | 4.0 |
| Applications per day | `modes/_custom.md` house rule | 5 |
| Run time | `install-schedule.ps1 -DailyAt 06:50` | 07:40 |

## Security note: read this once

The evaluate step uses upstream's `batch-runner.sh`, which starts one `claude -p` worker per
posting with `--dangerously-skip-permissions`. Upstream tracks this as known debt (#2876).
A malicious job posting could try to make a worker run commands as your user, so the
exposure is limited three ways:

- only filtered postings from company job boards are evaluated
- at most 15 a day
- the batch prompt treats posting text as untrusted data

If you'd rather not accept that, skip the evaluate step (`-MaxEvaluations 0`) and run
`/career-ops pipeline` interactively each morning instead (about 15 extra minutes a day).

## Troubleshooting

- **Nothing in `today.md` / task "failed":** read `$HOME\career-data\data\logs\daily-<date>.log`.
  Task Scheduler throws console output away, so the log is the only record.
- **`node: command not found` in the evaluate step:** the wrong `bash` ran (the WSL
  launcher). Set `CAREER_OPS_BASH` to `C:\Program Files\Git\bin\bash.exe` and re-run
  `install-schedule.ps1`.
- **Rows stuck as `paused_rate_limit`:** you hit a Claude usage limit. The next day's run
  continues; to resume now, run `"C:\Program Files\Git\bin\bash.exe" batch/batch-runner.sh --resume-paused`.
- **`needs_confirmation` rows** (agency postings, closed postings, missing job descriptions): listed
  under "Needs you" in the digest, with the exact way to resume.
- **Onboarding error in the log:** `daily.ps1` refuses to run until `node doctor.mjs` reports
  onboarding complete.

## Updating career-ops

`npm run update` pulls the latest upstream release, replaces system files only, and commits on
`main`. It never touches `automation/`, your data root, or system files you edited.
Check first with `npm run update:check`.

## Tests

```powershell
node --test "automation/tests/*.spec.mjs"
```
