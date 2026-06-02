#!/usr/bin/env python3
"""List high-token Claude Code sessions and, for ONE explicitly selected session,
surface redacted user prompts + per-prompt quality signals so the skill can write
a content-layer prompt review (`session_reviews` in the insights JSON).

This is the Claude Code counterpart of session_drilldown.py (Codex). Both follow
the same opt-in privacy model so the two platforms review symmetrically.

Pure python3 standard library, offline, no network.

Window (by record timestamp, local tz): --since / --days / --date (default 1 day).

PRIVACY (standing local authorization — ADR 0015, amends 0005 / 0013 D5):
  - The user (data owner) has granted STANDING authorization to read their OWN
    prompts on their OWN machine by default — no per-run approval gate.
  - --include-user-prompts surfaces prompt text for ONE session: the one named by
    --session-id, or (if none given) the single highest-token session in the
    window. Still single-session — there is NO all-sessions dump.
  - Text is still redacted (secrets, home dir, absolute paths, emails, IPs, long
    tokens) and truncated. Output stays LOCAL; nothing is exfiltrated.
  - INVIOLABLE: assistant replies, thinking, tool_result content, system/developer
    prompts and file contents are never read or emitted. The shareable scorecard
    stays aggregate (zero prompt text).
"""
import argparse
import datetime
import importlib.util
import json
import os
import re
from collections import Counter
from pathlib import Path

# Reuse the SINGLE source of truth for prompt-quality vocabulary / extraction so
# "what counts as structured / file-ref / constraint / correction" never drifts
# between the global aggregate (collect_claude_behavior.py) and this drilldown.
_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "cb", str(_HERE / "collect_claude_behavior.py"))
_cb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cb)

user_text = _cb.user_text
FILE_REF_RE = _cb.FILE_REF_RE
LIST_RE = _cb.LIST_RE
CONSTRAINT_WORDS_EN = _cb.CONSTRAINT_WORDS_EN
CONSTRAINT_WORDS_ZH = _cb.CONSTRAINT_WORDS_ZH
CORRECTION_STARTS_EN = _cb.CORRECTION_STARTS_EN
CORRECTION_STARTS_ZH = _cb.CORRECTION_STARTS_ZH


def prompt_flags(text):
    """Per-prompt boolean signals (same predicates as the global aggregate)."""
    low = text.lower()
    return dict(
        len=len(text),
        structured=bool("```" in text or LIST_RE.search(text)),
        file_ref=bool(FILE_REF_RE.search(text)),
        constraint=bool(any(w in low for w in CONSTRAINT_WORDS_EN)
                        or any(w in text for w in CONSTRAINT_WORDS_ZH)),
        correction=bool(low.startswith(CORRECTION_STARTS_EN)
                        or any(text.startswith(w)
                               for w in CORRECTION_STARTS_ZH)),
    )


_HOME = str(Path.home())
REDACTORS = [
    (re.compile(r"sk-[A-Za-z0-9_-]{12,}"), "sk-REDACTED"),
    (re.compile(r"ghp_[A-Za-z0-9]{12,}"), "ghp_REDACTED"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "xox-REDACTED"),
    (re.compile(r"AKIA[0-9A-Z]{12,}"), "AKIA-REDACTED"),
    (re.compile(r"(?i)(api[_-]?key|token|secret|password|authorization)"
                r"\s*[:=]\s*\S+"), r"\1=REDACTED"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "<email>"),
    (re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b"), "<ip>"),
]


def redact(text, char_limit):
    """Strip secrets / home dir / emails / IPs and truncate. Never reverses the
    skill's obligation to paraphrase — this is a safety net, not a license to
    quote verbatim."""
    text = text.replace(_HOME, "~")
    for rgx, repl in REDACTORS:
        text = rgx.sub(repl, text)
    # collapse remaining deep absolute paths to their basename-ish tail
    text = re.sub(r"(?:/[\w.\-]+){3,}", lambda m: "/…/" + m.group(0).rsplit("/", 1)[-1], text)
    text = text.strip()
    if len(text) > char_limit:
        text = text[:char_limit].rstrip() + " …[truncated]"
    return text


def repo_of(cwd):
    return Path(cwd).name if cwd else "(unknown)"


def parse_window(args, tz):
    today = datetime.datetime.now(tz).date()
    if args.date:
        d = datetime.date.fromisoformat(args.date)
        return d, d, args.date
    if args.since:
        d = datetime.date.fromisoformat(args.since)
        return d, today, f"{args.since} 至 {today.isoformat()}"
    n = args.days if args.days and args.days > 0 else 1
    start = today - datetime.timedelta(days=n - 1)
    return start, today, f"{start.isoformat()} 至 {today.isoformat()}"


def parse_ts(rec, tz):
    ts = rec.get("timestamp")
    if not isinstance(ts, str):
        return None
    try:
        return datetime.datetime.fromisoformat(
            ts.replace("Z", "+00:00")).astimezone(tz)
    except ValueError:
        return None


def collect_sessions(projects_dir, start, end, tz, want_id):
    """Group transcript records by sessionId within the window. Returns
    {sid: session_dict}. Prompt *flags* are always gathered; prompt *text* only
    when want_id matches (we keep it transiently for the caller to redact)."""
    sessions = {}
    root = Path(projects_dir)
    if not root.exists():
        return sessions
    for path in root.rglob("*.jsonl"):
        for line in path.open(errors="ignore"):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            sid = rec.get("sessionId") or rec.get("session_id")
            if not sid:
                continue
            dt = parse_ts(rec, tz)
            if dt is not None:
                d = dt.date()
                if (start and d < start) or (end and d > end):
                    continue
            s = sessions.get(sid)
            if s is None:
                s = sessions[sid] = dict(
                    session_id=sid, repo=None, tokens=0, tool_calls=0,
                    prompts=0, first=None, last=None, models=set(),
                    flags=Counter(), len_sum=0, _texts=[])
            cwd = rec.get("cwd")
            if s["repo"] is None and cwd:
                s["repo"] = repo_of(cwd)
            if dt is not None:
                if s["first"] is None or dt < s["first"]:
                    s["first"] = dt
                if s["last"] is None or dt > s["last"]:
                    s["last"] = dt
            rtype = rec.get("type")
            if rtype == "user":
                text = (user_text(rec.get("message") or {}) or "").strip()
                if not text:
                    continue  # tool_result-only message — not a human prompt
                s["prompts"] += 1
                fl = prompt_flags(text)
                s["len_sum"] += fl["len"]
                for k in ("structured", "file_ref", "constraint", "correction"):
                    if fl[k]:
                        s["flags"][k] += 1
                if want_id and (want_id == "*" or sid == want_id):
                    s["_texts"].append((dt, text, fl))
            elif rtype == "assistant":
                msg = rec.get("message") or {}
                u = msg.get("usage") or {}
                s["tokens"] += (int(u.get("input_tokens", 0) or 0)
                                + int(u.get("output_tokens", 0) or 0)
                                + int(u.get("cache_read_input_tokens", 0) or 0)
                                + int(u.get("cache_creation_input_tokens", 0) or 0))
                model = msg.get("model")
                if model:
                    s["models"].add(model)
                for c in (msg.get("content") or []):
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        s["tool_calls"] += 1
    return sessions


def session_summary(s):
    n = s["prompts"] or 1
    fl = s["flags"]
    span = None
    if s["first"] and s["last"]:
        span = round((s["last"] - s["first"]).total_seconds() / 60, 1)
    return dict(
        session_id=s["session_id"],
        repo=s["repo"] or "(unknown)",
        tokens=s["tokens"],
        tool_calls=s["tool_calls"],
        prompts=s["prompts"],
        models=sorted(s["models"]),
        first=s["first"].isoformat() if s["first"] else None,
        last=s["last"].isoformat() if s["last"] else None,
        span_minutes=span,
        prompt_signals=dict(
            avg_len=round(s["len_sum"] / n, 1),
            structured_ratio=round(fl["structured"] / n, 4),
            file_ref_ratio=round(fl["file_ref"] / n, 4),
            constraint_ratio=round(fl["constraint"] / n, 4),
            correction_rate=round(fl["correction"] / n, 4),
        ),
    )


def main():
    ap = argparse.ArgumentParser(
        description="List Claude Code sessions; opt-in surface redacted prompts "
                    "for one selected session (content-layer prompt review).")
    ap.add_argument("--projects-dir",
                    default=os.path.expanduser("~/.claude/projects"))
    ap.add_argument("--since", default="")
    ap.add_argument("--days", type=int, default=1)
    ap.add_argument("--date", default="")
    ap.add_argument("--repo", default="", help="filter by cwd-basename substring")
    ap.add_argument("--session-id", default="",
                    help="exact session id to drill into")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--include-user-prompts", action="store_true",
                    help="emit redacted prompts for one session (--session-id, "
                         "or the top-token session if none given)")
    ap.add_argument("--prompt-char-limit", type=int, default=1200)
    ap.add_argument("--output", default="")
    a = ap.parse_args()

    tz = datetime.datetime.now().astimezone().tzinfo
    tzname = datetime.datetime.now(tz).strftime("%Z") or "local"
    start, end, label = parse_window(a, tz)

    # Standing local authorization (ADR 0015): when prompts are requested without a
    # specific id, auto-select the single highest-token session. Still one session,
    # never an all-sessions dump. We don't yet know that id, so gather all texts
    # transiently and keep only the winner's below.
    want = "*" if (a.include_user_prompts and not a.session_id) else \
        (a.session_id if a.include_user_prompts else None)
    sessions = collect_sessions(a.projects_dir, start, end, tz, want)

    rows = list(sessions.values())
    if a.session_id:
        rows = [s for s in rows if a.session_id in s["session_id"]]
    if a.repo:
        rl = a.repo.lower()
        rows = [s for s in rows if rl in (s["repo"] or "").lower()]
    rows.sort(key=lambda s: (s["tokens"], s["tool_calls"]), reverse=True)
    if a.include_user_prompts:
        rows = rows[:1]  # one session only: the selected / top-token one
        # drop any transiently-gathered text for non-selected sessions
        keep = rows[0]["session_id"] if rows else None
        for s in sessions.values():
            if s["session_id"] != keep:
                s["_texts"] = []
    elif a.top > 0:
        rows = rows[:a.top]

    out = dict(
        platform="Claude Code",
        generated_for=label,
        timezone=tzname,
        source="~/.claude/projects/**/*.jsonl (本地解析)",
        includes_user_prompts=bool(a.include_user_prompts),
        prompt_scope="one selected session" if a.include_user_prompts else "none",
        sessions=[session_summary(s) for s in rows],
    )

    if a.include_user_prompts and rows:
        s = rows[0]
        prompts = []
        for i, (dt, text, fl) in enumerate(sorted(
                s["_texts"], key=lambda x: (x[0] or datetime.datetime.min
                                            .replace(tzinfo=tz)))):
            prompts.append(dict(
                idx=i,
                timestamp=dt.isoformat() if dt else None,
                signals={k: fl[k] for k in
                         ("len", "structured", "file_ref",
                          "constraint", "correction")},
                preview=redact(text, a.prompt_char_limit),
            ))
        out["selected_session"] = session_summary(s)
        out["selected_session"]["prompts"] = prompts

    blob = json.dumps(out, indent=2, ensure_ascii=False)
    if a.output:
        Path(a.output).write_text(blob, encoding="utf-8")
        print(f"wrote {a.output}")
        print(f"  sessions={len(out['sessions'])} window={label} "
              f"prompts={'yes' if a.include_user_prompts else 'no'}")
    else:
        print(blob)


if __name__ == "__main__":
    main()
