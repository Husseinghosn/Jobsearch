---
name: find-jobs
description: Search job sites in Chrome for roles matching config/search.yaml, score them, and add them to the tracker. Use when the user says "find jobs", "search for jobs", or runs /find-jobs.
---

# Find jobs

Requires Claude in Chrome (`claude --chrome`). Follow `CLAUDE.md` hard rules.

1. Read `config/search.yaml` and `profile/profile.yaml`. If profile.yaml is missing, stop.
2. Open a **new tab**. For each site in `sites`, for each title × location:
   - Build `{query}` as `"<title>" <location>` URL-encoded; fill `{location}` if used.
   - Load the URL, read the results. Paginate until you have
     `limits.max_new_jobs_per_run` new candidates total or results run out.
3. For each candidate, open the posting and read the full description. Prefer the
   company's own ATS URL (greenhouse/lever/ashby/workday) over aggregator links.
4. Score per the rubric in `CLAUDE.md`. Check exclusions first.
5. Record every candidate:
   ```
   python3 scripts/tracker.py add --url "<url>" --company "<c>" --title "<t>" \
     --location "<l>" --source "<site>" --score <n> \
     --status <shortlisted|found|skipped|suspicious> --notes "<one-line reason>"
   ```
   `shortlisted` if score >= `filters.min_score_to_shortlist`, else `found`
   (or `skipped` on exclusion). If the tool reports `duplicate`, move on.
6. Finish with `python3 scripts/tracker.py list --status shortlisted` and a short
   summary: how many found, shortlisted, skipped, and why the top 3 fit.

Don't apply in this skill. If `apply.mode` is `assisted` or `auto`, offer to run
`/apply-job` on the shortlist.
