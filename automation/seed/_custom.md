# Custom Instructions -- career-ops

<!-- Seeded from automation/seed/_custom.md. Copy to modes/_custom.md in your data root
     (setup step 7 in automation/README.md). This file is user-layer: updates never touch it. -->

## House Rules

- **Daily application cap: 5.** Before helping me start a 6th application in one day, tell me
  how many I've done today (`node tracker.mjs query --status Applied --since <today>`) and ask
  me to confirm. Quality beats volume; the cap is deliberate.
- **Referral before cold.** For any posting scoring 4.5/5 or higher where I have a connection
  there (`node linkedin-join.mjs --company "<company>"`), offer `contacto` *before* `apply` and
  suggest waiting up to 3 business days for a reply before applying cold.
- **Tag referrals so the scorecard works.** When I say someone referred me (or agreed to), save
  them via `contacto` with type `internal-referral` and the tracker #, and add the note through
  `node set-status.mjs --report <report#> <current state> --note "channel: referral"`.
- **Never guess an answer.** If a form question isn't answered by my CV, `config/profile.yml`,
  the report or something I said in this session, leave it blank and list it for me. Never
  invent years of experience, tools, numbers, salary, or work-authorization answers.
- **Cover letters only when they matter:** when the form requires one, or the score is 4.5+.
- **Record outcomes with real dates.** When I report a reply, rejection or interview, update it
  with `set-status.mjs ... --on YYYY-MM-DD` (ask me for the date if I don't give one).
- **LinkedIn is manual.** Draft messages and build search links only. Never log in, search,
  click or send on LinkedIn.
- **Never submit.** Fill, review, stop before Submit. I click it.

## Custom Workflows

- **"today"**: read `output/today.md`, then walk me through it in order:
  1. Referral asks.
  2. Applications, best score first, at most 5.
  3. Follow-ups.
  4. Anything under "Needs you".
- **"log reply"**: I paste an employer email. Run `node paste-reply.mjs` with it, then
  `node reply-watch.mjs`, and apply the status change only after I confirm.
