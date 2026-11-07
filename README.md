# Jobsearch

A Claude Code project that uses **Claude in Chrome** to find jobs that match your
criteria, score them, track them, and fill out applications in your own browser.
You approve each submission unless you turn that off.

## How it works
```
/find-jobs   → searches sites in config/search.yaml, scores postings, writes data/jobs.csv
/apply-job   → opens shortlisted jobs, fills forms from profile/, stops before Submit for your OK
/job-status  → pipeline counts, today's applications vs. cap, unanswered questions
```
The rules the agent follows are in [`CLAUDE.md`](CLAUDE.md). It never invents
experience, never types passwords or solves CAPTCHAs, and logs every job it
touches.

## Setup (on your own computer; this does not run in the cloud)
1. Install [Claude Code](https://code.claude.com) and the
   [Claude in Chrome](https://claude.com/chrome) extension, and sign in to both.
2. Clone and fill in your details:
   ```bash
   git clone https://github.com/husseinghosn/jobsearch && cd jobsearch
   cp profile/profile.example.yaml profile/profile.yaml
   cp profile/answers.example.yaml profile/answers.yaml
   cp ~/path/to/resume.pdf profile/resume.pdf
   ```
   Then edit `config/search.yaml` with your target titles, skills, locations and salary floor.
3. Run `claude --chrome` in the repo, then `/find-jobs`.

Everything under `profile/` and `data/` is gitignored, so your personal data and
tracker stay local.

## Apply modes (`config/search.yaml → apply.mode`)
| mode | behavior |
|---|---|
| `review` | Builds a shortlist only. No forms are opened. |
| `assisted` (default) | Fills each form and waits for your yes before submitting. |
| `auto` | Submits without asking, but only on `auto_submit_hosts` (Greenhouse/Lever/Ashby by default) and only when score ≥ `auto_min_score`. Everything else falls back to assisted. |

## Read this before turning on `auto`
- **LinkedIn and Indeed prohibit automated activity** and do restrict accounts.
  They're commented out in `sites` by default. If you enable them, use them for
  search only.
- **Volume doesn't help.** Recruiters see your applications on the same ATS, and
  generic answers to custom questions hurt. Keep `max_applications_per_day` low
  and the score threshold high.
- **The agent is only as accurate as `profile.yaml`.** It won't claim a skill
  that isn't listed there. Questions it can't answer are recorded as
  `needs_input`, so add those answers to `answers.yaml` once and they get reused.
- A Claude in Chrome session needs your machine awake with Chrome open. It's not
  a background daemon.

## Tracker CLI
```bash
python3 scripts/tracker.py list --status shortlisted ready
python3 scripts/tracker.py update --url <url> --status skipped --notes "not a fit"
python3 scripts/tracker.py stats
```
