---
name: job-status
description: Summarize the job tracker — pipeline counts, today's applications, open questions. Use when the user asks for job search status or runs /job-status.
---

# Job status

1. `python3 scripts/tracker.py stats`
2. `python3 scripts/tracker.py list --status ready needs_input blocked`
3. `python3 scripts/tracker.py list --status shortlisted --min-score 0` (top 10 only)

Report: counts by status, applied today vs. the daily cap, and every outstanding
question from `needs_input` rows grouped so that duplicates show once. Suggest
adding the answers to `profile/answers.yaml`. No browser needed.
