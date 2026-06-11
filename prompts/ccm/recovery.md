# CCM Recovery Prompt

Use this after restart, crash, partial room creation, duplicate Orchestrators, stale worker state, archive failure, cleanup failure, or unsupported platform behavior.

1. Use `$recover-orchestration`.
2. Freeze new dispatch until state is reconstructed.
3. Read Git orchestration files first, then inspect CCM/platform/session facts.
4. Reconcile workers to the most advanced state proven by durable files and external facts.
5. Record a Recovery Note using `docs/orchestration/_templates/recovery-note.md` and update the next single action.
