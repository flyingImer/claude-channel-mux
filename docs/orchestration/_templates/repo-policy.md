# Decision: Repo Policy

## Question

What repo, branch, author, push, and validation rules constrain this orchestration?

## Evidence Reviewed

- Root or nearest `AGENTS.md`
- Repo README/development docs
- `git remote -v`
- `git status --short`
- Branch protection or review policy when known

## Answer

- Remote: <remote-url-or-policy-ref>
- Coordination Branch: <branch>
- Target Integration Base: <branch-or-sha>
- Commit Author: <author policy>
- Push Transport / Account: <push policy>
- Validation Gate: <command>

## Rationale

This decision prevents orchestration bootstrap from silently assuming `main`, the wrong account, the wrong remote, or an insufficient validation gate.

## Constraints

- Do not push or create branches unless repo/user policy allows it.
- Do not use `main` as the coordination branch merely because it is the current default.
- Revisit this decision if the repo remote, branch policy, or release process changes.
