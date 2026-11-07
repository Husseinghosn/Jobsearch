---
name: apply-job
description: Fill out and (with approval) submit applications for shortlisted jobs in Chrome using the user's profile. Use when the user says "apply", "apply to the shortlist", or runs /apply-job [url].
---

# Apply to jobs

Requires Claude in Chrome. Follow `CLAUDE.md` hard rules. They override this file.

## Pick targets
- If a URL was given, use it. Otherwise
  `python3 scripts/tracker.py list --status shortlisted ready`, highest score first.
- Check `python3 scripts/tracker.py stats --today`. Stop when `applied_today`
  reaches `limits.max_applications_per_day`.
- If `apply.mode: review`, stop: tell the user applying is disabled.

## For each job
1. Open the posting in a new tab and click through to the application form.
   - Login wall / account creation / CAPTCHA / 2FA → `update --status blocked
     --notes "<what>"`, tell the user, move to the next job.
2. Fill the fields from `profile/profile.yaml` and `profile/answers.yaml`:
   - Upload `profile.resume_path` to resume fields.
   - Cover letter (if `apply.tailor_cover_letter` and a field exists): ≤ 200 words,
     only claims backed by the profile, reference 2 specifics from the posting.
   - Any question you cannot answer from those files → don't guess. Record it with
     `update --question "<exact question>"`. Required → status `needs_input`, next job.
     Optional → leave blank.
3. Before submitting, re-read every filled field and fix anything wrong.
4. Decide whether to submit:
   - **assisted** (default): `update --status ready`. Show the user a compact
     summary (company, title, score, every free-text answer you wrote) and ask
     "Submit? (yes / edit / skip)". Submit only on an explicit yes.
   - **auto**: submit only if the page host is in `apply.auto_submit_hosts` **and**
     score >= `apply.auto_min_score`. Otherwise treat it as assisted.
5. After submit, confirm the confirmation page or message appeared. Then
   `update --status applied --notes "confirmation: <text or none seen>"`.
   No confirmation → `failed` with what happened.

## End
Print `python3 scripts/tracker.py stats` and list any `needs_input` questions so
the user can add answers to `profile/answers.yaml` once and reuse them.
