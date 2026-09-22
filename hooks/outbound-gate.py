#!/usr/bin/env python3
"""G9 HARD-tier: outbound gate (PreToolUse hook on Bash).

Blocks a command that makes an artifact visible to an outside audience unless a close-out
record exists for the outbound ref. Generic: the EFFORT declares what is "public" and where
records live, in a JSON manifest at $CLAUDE_OUTBOUND_MANIFEST:
  {"public_patterns": ["gh pr edit"],   # regex on the command; ADDITIONAL matches on top of
                                          # the built-in generic ones below (rarely needed)
   "private_remotes": ["^/", "^\\.\\./", "^backup$"],   # regex on a git-push remote's name
                                          # OR resolved URL/path; matches are NEVER gated
   "closeout_dir": "/abs/path/closeouts",   # must contain <sha>.md (or <sha>-*.md) for the outbound ref
   "ref_cmd": "git rev-parse HEAD",         # how to resolve the outbound ref (default HEAD of cwd)
   "override_token": "/abs/path/OWNER-OVERRIDE",   # if present: allow + log correction event
   "correction_log": "/abs/path/correction-log.md"}
A close-out record is the reconciliation close-out (G1 v2): audited base sha, dispositioned
findings, delta-only-fixes verification. The gate checks EXISTENCE + that it names the base
line ("audited base:"); content quality is the validator's job, not this gate's.
Blocking contract: exit 2 + reason on stderr. Missing manifest = block (a room that can push
must declare its outbound surface). Malformed stdin = not this guard's call (exit 0).
v3 (2026-09-08): patterns match the COMMAND SURFACE, not the whole text: heredoc bodies are
removed, quoted strings containing whitespace are blanked (a refspec keeps its quotes), the
text is split into pipeline stages, and stages headed by text-only commands (echo, printf,
cat, grep, sed, awk, tee, jq, head, tail, wc, less, python*) never match. The outbound ref is
resolved in the repo the matching stage acts on (`git -C <dir>` or a preceding `cd <dir>`),
and for `git push <remote> <src>[:dst]` from `<src>`; close-out records may be named by a
sha prefix of >= 12 hex chars.
v4 (2026-09-22): public-facing detection no longer depends on effort-specific branch-name
patterns (a manifest that only listed known PR branch names let a push to any OTHER branch
through with no close-out). `git push`, `gh pr create|edit`, and `gt submit` are now public
BY DEFAULT, generically, regardless of what `public_patterns` lists: for `gh pr create|edit`
and `gt submit` that is unconditional (both always talk to a hosted forge, never a local
path); for `git push <remote> ...` the REMOTE is resolved (as a registered git remote name, or
taken literally if it already looks like a URL/path) and treated as public unless it resolves
to a local filesystem path, i.e. no `scheme://` and no `user@host:` syntax. An effort can still
mark a specific local-looking remote as public via `public_patterns`, or a specific non-local
remote as exempt via `private_remotes` (matched against both the remote's name/token and its
resolved URL). `public_patterns` from v3 keeps working as an ADDITIONAL match, checked first.
Self-test: hooks/outbound-gate-selftest.sh.
"""
import glob, json, os, re, subprocess, sys, datetime

HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n.*?\n[ \t]*\2[ \t]*(?=\n|$)", re.S)
TEXT_ONLY = {"echo", "printf", "cat", "grep", "rg", "sed", "awk", "tee", "jq", "head", "tail", "wc",
             "less", "more", "python", "python3", "true", "false", "test", "[", "ls", "stat", "wc"}
BUILTIN_PREFIX = {"sudo", "env", "nohup", "time", "command", "exec"}
# (v4) generic, effort-agnostic public-action shapes -- no branch/remote name baked in.
GIT_PUSH_RE = re.compile(r"\bgit(?:\s+-C\s+\S+)?\s+push\b")
GH_PR_RE = re.compile(r"\bgh\s+pr\s+(?:create|edit)\b")
GT_SUBMIT_RE = re.compile(r"\bgt\s+submit\b")

def surface(cmd):
    s = HEREDOC_RE.sub("<<HEREDOC_BODY", cmd)
    s = re.sub(r"'[^'\n]*\s[^'\n]*'", "''", s)                 # single-quoted strings with whitespace
    s = re.sub(r'"(?:\\.|[^"\\\n])*\s(?:\\.|[^"\\\n])*"', '""', s)  # double-quoted strings with whitespace
    return s

def stages(s):
    return [t.strip() for t in re.split(r"\n|;|&&|\|\||\|", s) if t.strip()]

def head_word(stage):
    words = [w for w in stage.split() if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w)]
    while words and words[0] in BUILTIN_PREFIX: words = words[1:]
    return words[0] if words else ""

def resolve_dir(stage, idx, st, base):
    m = re.search(r"\bgit\s+-C\s+(\S+)", stage)
    d = m.group(1) if m else None
    if not d:
        for prev in reversed(st[:idx + 1]):
            m = re.match(r"^cd\s+(\S+)", prev)
            if m: d = m.group(1); break
    d = os.path.expanduser(d.strip("'\"")) if d else base
    return d if os.path.isabs(d) else os.path.join(base, d)

def is_local_remote(url):
    """True when a git-push remote token/URL points at a local filesystem path: no
    scheme:// (except file://) and no scp-like user@host: syntax. Bare path syntax
    ('/abs/...', './rel', 'plain-name-that-is-a-path') is what git itself treats as a
    local remote, so that is the default here too."""
    if re.match(r"^[A-Za-z][A-Za-z0-9+.\-]*://", url):
        return url.startswith("file://")
    if re.match(r"^[\w.\-]+@[\w.\-]+:", url):
        return False
    return True

def resolve_remote(stage, repo_dir):
    """For a `git push <remote> ...` stage, return (token, resolved_url_or_path). The
    token is looked up as a registered git remote name first; if that fails (already a
    literal URL/path, or an unregistered name), the token itself stands in as the URL."""
    m = re.search(r"\bgit(?:\s+-C\s+\S+)?\s+push\s+(?:-\S+\s+)*(\S+)", stage)
    if not m:
        return None, None
    token = m.group(1).strip("'\"")
    try:
        url = subprocess.check_output(f"git remote get-url {token}", shell=True, text=True,
                                       stderr=subprocess.DEVNULL, cwd=repo_dir).strip()
    except Exception:
        url = token
    return token, url

def public_stage(cmd, m):
    """Return (stage, index, all_stages) for the first stage that counts as a public-facing
    action, else None. `m` is the effort's manifest dict (public_patterns / private_remotes
    default to []); an empty dict {} exercises the built-in generic detection alone."""
    pats = m.get("public_patterns", [])
    private_pats = m.get("private_remotes", [])
    st = stages(surface(cmd))
    for i, stage in enumerate(st):
        if head_word(stage) in TEXT_ONLY: continue
        norm = re.sub(r"\bgit\s+-C\s+\S+\s+", "git ", stage)   # `git -C dir push` matches like `git push`
        if any(re.search(p, norm) for p in pats):
            return stage, i, st
        if GIT_PUSH_RE.search(stage):
            repo_dir = resolve_dir(stage, i, st, os.getcwd())
            token, url = resolve_remote(stage, repo_dir)
            if (
                token is not None
                and is_local_remote(url)
                and not any(re.search(p, token) or re.search(p, url) for p in private_pats)
            ):
                continue  # local-path remote, not manifest-flagged private: not public
            return stage, i, st
        if GH_PR_RE.search(stage) or GT_SUBMIT_RE.search(stage):
            return stage, i, st  # always public: both always talk to a hosted forge
    return None

def resolve_sha(stage, repo_dir, ref_cmd):
    m = re.search(r"\bgit\b(?:\s+-C\s+\S+)?\s+push\s+(?:-\S+\s+)*\S+\s+([^\s:]+)(?::\S+)?", stage)
    cmds = ([f"git rev-parse {m.group(1)}"] if m else []) + [ref_cmd]
    for c in cmds:
        try:
            out = subprocess.check_output(c, shell=True, text=True, stderr=subprocess.DEVNULL, cwd=repo_dir).strip()
            if re.fullmatch(r"[0-9a-f]{40}", out): return out
        except Exception:
            pass
    return ""

def records_for(cdir, sha):
    hits = []
    for r in glob.glob(os.path.join(cdir, "*.md")):
        pre = re.match(r"^([0-9a-f]{12,40})", os.path.basename(r))
        if pre and sha.startswith(pre.group(1)): hits.append(r)
    return hits

def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if data.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command", "") or ""
    mpath = os.environ.get("CLAUDE_OUTBOUND_MANIFEST")
    if not mpath:
        # CCM room: resolve the room's harness dir via the daemon-written session file.
        sid = data.get("session_id")
        state = os.environ.get("CCM_STATE_DIR") or os.path.expanduser("~/.config/claude-channel-mux")
        sf = os.path.join(state, "harness", f"{sid}.json") if sid else None
        if not sf or not os.path.exists(sf):
            sys.exit(0)  # not a harness room: nothing to gate
        info = json.load(open(sf))
        if not info.get("dir"):
            sys.exit(0)  # harness pending/unset: gate inactive (SessionStart hint covers it)
        mpath = os.path.join(info["dir"], "outbound.json")
        if not os.path.exists(mpath):
            if public_stage(cmd, {}):
                print(f"outbound gate: harness `{info.get('name')}` has no outbound.json yet; gate inactive "
                      f"(migration). Derive {mpath} per G9 to arm it.", file=sys.stderr)
            sys.exit(0)
    elif not os.path.exists(mpath):
        if public_stage(cmd, {}):
            print("BLOCKED by outbound gate: CLAUDE_OUTBOUND_MANIFEST is set but the file is missing.", file=sys.stderr)
            sys.exit(2)
        sys.exit(0)
    m = json.load(open(mpath))
    hit = public_stage(cmd, m)
    if not hit:
        sys.exit(0)  # not a public-facing action per the built-in rule + the effort's own declaration
    stage, idx, st = hit
    repo_dir = resolve_dir(stage, idx, st, os.getcwd())
    sha = resolve_sha(stage, repo_dir, m.get("ref_cmd", "git rev-parse HEAD"))
    cdir = m.get("closeout_dir", "")
    recs = records_for(cdir, sha) if sha and cdir else []
    ok = any("audited base:" in open(r, errors="ignore").read() for r in recs)
    if ok:
        sys.exit(0)
    tok = m.get("override_token")
    if tok and os.path.exists(tok):
        log = m.get("correction_log")
        if log:
            with open(log, "a") as f:
                f.write(f"\n## {datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")} OUTBOUND-OVERRIDE ref={sha[:12]} cmd={cmd[:120]!r} (owner token present; G4 correction event)\n")
        print(f"outbound gate: owner override token present; action allowed and logged.", file=sys.stderr)
        sys.exit(0)
    print(f"BLOCKED by outbound gate: '{stage[:80]}' is a public-facing action but no close-out record "
          f"for ref {sha or '?'} (repo {repo_dir}) was found in {cdir or '?'} (needs a file named by that sha "
          f"or a >=12-char prefix of it, .md, containing 'audited base:'). Complete the reconciliation "
          f"close-out, or the owner places the override token.", file=sys.stderr)
    sys.exit(2)

if __name__ == "__main__":
    main()
