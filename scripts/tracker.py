#!/usr/bin/env python3
"""Job tracker backed by data/jobs.csv. Stdlib only.

Usage:
  tracker.py add --url URL --company C --title T [--location L] [--source S] [--score N] [--status found] [--notes ...]
  tracker.py update --url URL [--status S] [--score N] [--notes ...] [--question ...]
  tracker.py list [--status S ...] [--min-score N]
  tracker.py get --url URL
  tracker.py stats [--today]
"""
import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "jobs.csv"
FIELDS = ["id", "url", "company", "title", "location", "source", "score", "status",
          "found_at", "updated_at", "applied_at", "questions", "notes"]
STATUSES = {"found", "shortlisted", "ready", "applied", "skipped", "needs_input",
            "blocked", "failed", "suspicious"}


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


def norm_url(url):
    """Strip query/fragment so tracking params don't create duplicates."""
    p = urlsplit(url.strip())
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path.rstrip("/"), "", ""))


def key(company, title):
    return f"{company.strip().lower()}|{title.strip().lower()}"


def load():
    if not DB.exists():
        return []
    with DB.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save(rows):
    DB.parent.mkdir(parents=True, exist_ok=True)
    tmp = DB.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    tmp.replace(DB)


def find(rows, url):
    u = norm_url(url)
    return next((r for r in rows if r["url"] == u), None)


def check_status(s):
    if s and s not in STATUSES:
        sys.exit(f"invalid status {s!r}; choose from {sorted(STATUSES)}")


def cmd_add(a):
    check_status(a.status)
    rows = load()
    u = norm_url(a.url)
    dup = find(rows, u) or next((r for r in rows if key(r["company"], r["title"]) == key(a.company, a.title)), None)
    if dup:
        print(json.dumps({"duplicate": True, "existing": dup}))
        return
    rows.append({
        "id": str(max((int(r["id"]) for r in rows), default=0) + 1),
        "url": u, "company": a.company, "title": a.title, "location": a.location or "",
        "source": a.source or "", "score": str(a.score) if a.score is not None else "",
        "status": a.status, "found_at": now(), "updated_at": now(), "applied_at": "",
        "questions": "", "notes": a.notes or "",
    })
    save(rows)
    print(json.dumps({"added": True, "id": rows[-1]["id"]}))


def cmd_update(a):
    check_status(a.status)
    rows = load()
    r = find(rows, a.url)
    if not r:
        sys.exit(f"not found: {a.url}")
    if a.status:
        r["status"] = a.status
        if a.status == "applied":
            r["applied_at"] = now()
    if a.score is not None:
        r["score"] = str(a.score)
    if a.notes:
        r["notes"] = (r["notes"] + " | " if r["notes"] else "") + a.notes
    if a.question:
        r["questions"] = (r["questions"] + " | " if r["questions"] else "") + a.question
    r["updated_at"] = now()
    save(rows)
    print(json.dumps(r))


def cmd_list(a):
    rows = load()
    if a.status:
        rows = [r for r in rows if r["status"] in a.status]
    if a.min_score is not None:
        rows = [r for r in rows if r["score"] and int(r["score"]) >= a.min_score]
    rows.sort(key=lambda r: int(r["score"] or 0), reverse=True)
    for r in rows:
        print(f'{r["id"]:>4}  {r["score"] or "-":>3}  {r["status"]:<12} {r["company"][:24]:<24} {r["title"][:40]:<40} {r["url"]}')
    print(f"({len(rows)} jobs)")


def cmd_get(a):
    r = find(load(), a.url)
    print(json.dumps(r) if r else "null")


def cmd_stats(a):
    rows = load()
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    today = dt.date.today().isoformat()
    applied_today = sum(1 for r in rows if r["applied_at"].startswith(today))
    out = {"total": len(rows), "by_status": counts, "applied_today": applied_today}
    if a.today:
        out = {"applied_today": applied_today}
    print(json.dumps(out, indent=2))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("add")
    s.add_argument("--url", required=True); s.add_argument("--company", required=True)
    s.add_argument("--title", required=True); s.add_argument("--location")
    s.add_argument("--source"); s.add_argument("--score", type=int)
    s.add_argument("--status", default="found"); s.add_argument("--notes")
    s.set_defaults(fn=cmd_add)
    s = sub.add_parser("update")
    s.add_argument("--url", required=True); s.add_argument("--status")
    s.add_argument("--score", type=int); s.add_argument("--notes"); s.add_argument("--question")
    s.set_defaults(fn=cmd_update)
    s = sub.add_parser("list")
    s.add_argument("--status", nargs="*"); s.add_argument("--min-score", type=int)
    s.set_defaults(fn=cmd_list)
    s = sub.add_parser("get"); s.add_argument("--url", required=True); s.set_defaults(fn=cmd_get)
    s = sub.add_parser("stats"); s.add_argument("--today", action="store_true"); s.set_defaults(fn=cmd_stats)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
