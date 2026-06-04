<claude-mem-context>
# Memory Context

# claude-mem status

This project has no memory yet. The current session will seed it; subsequent sessions will receive auto-injected context for relevant past work.

Memory injection starts on your second session in a project.

`/learn-codebase` is available if the user wants to front-load the entire repo into memory in a single pass (~5 minutes on a typical repo, optional). Otherwise memory builds passively as work happens.

Live activity: http://localhost:37777
How it works: `/how-it-works`

This message disappears once the first observation lands.
</claude-mem-context>

# Repo Practice: GitHub Pushes

- Use GitHub account `flyingImer` for this repo.
- Repo-local git author should remain `flyingImer <flyingImer@users.noreply.github.com>`.
- Commits normally go directly to `main` with short imperative summary messages; this repo has historically not used PRs for routine changes.
- Do not run bare `git push origin main` unless the SSH identity has been verified. `origin` is `git@github.com:flyingImer/claude-channel-mux.git`, and the default SSH key may authenticate as the wrong account.
- Before pushing, run `gh auth status` and confirm the active account is `flyingImer`.
- If the remote is SSH or identity is uncertain, push via HTTPS using the active `gh` token, targeting `https://github.com/flyingImer/claude-channel-mux.git main` with a temporary `GIT_ASKPASS` that returns username `x-access-token` and password from `gh auth token -h github.com`.
- After pushing, verify with `git ls-remote https://github.com/flyingImer/claude-channel-mux.git refs/heads/main`.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.
