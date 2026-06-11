# Guiding Principal Recall Checklist

Use this gate when creating or answering recall for human-context judgment.

- [ ] Recall is necessary because repo evidence is insufficient, stale, ambiguous, reader-facing, or materially conflicted.
- [ ] Recall packet points to Durable Intake, current Stage Contract, relevant `.done` inbox items, decisions, worker/audit evidence, and a specific question.
- [ ] Guiding Principal is not being used as a routine approval gate for worker dispatch, room control, integration, archive, or cleanup.
- [ ] Response distinguishes human-context judgment from Orchestrator execution policy.
- [ ] Response includes constraints and attribution for the Orchestrator sanity check.
- [ ] Orchestrator captures the response in `recall/` or `decisions/` before acting.
- [ ] New process-time Guiding Principal or human context is captured with `bun run orchestration:inbox -- <initiative-id> --kind inbox --from <actor> --source-ref <ref>` or an equivalent attributed file.
