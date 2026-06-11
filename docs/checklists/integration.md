# Worker Integration Checklist

- [ ] Worker Report, room id, session id, final message/transcript ref, and artifacts are captured in `reports/`.
- [ ] Unread inbox and open recall that could affect the output were processed first.
- [ ] Diff or artifact was inspected against the Stage Contract and non-goals.
- [ ] Required tests, review, or independent audit evidence exists.
- [ ] Output is marked consumed only after acceptance, integration, or explicit rejection/abandonment.
- [ ] Archive is requested only after consumption or rejection/abandonment is durable.
