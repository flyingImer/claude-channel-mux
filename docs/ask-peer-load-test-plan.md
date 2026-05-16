# ask_peer Load Test Plan

Goal: verify CCM daemon remains a lightweight async control plane under concurrent multi-room peer handoffs.

## Preconditions

- Run against a test daemon or a production cutover with `CHANNEL_DAEMON_ALLOWED_CHANNELS` restricted to test Slack/Telegram rooms.
- Use `CHANNEL_DAEMON_SELF_TEST_PREFIX` for bot-authored test messages.
- Keep `ask_peer` async-only: the daemon must route handoffs and return immediately; it must not wait for peer LLM answers.
- Use conservative limits first:
  - `CCM_ASK_PEER_RATE_LIMIT=12`
  - `CCM_ASK_PEER_RATE_WINDOW_MS=60000`
  - `CCM_ASK_PEER_MAX_INFLIGHT_PER_ROOM=4`
  - `CCM_ASK_PEER_INFLIGHT_TTL_MS=600000`

## Scenarios

1. Single room, two agents, sequential handoffs
   - Send 5 Claude -> Codex handoffs.
   - Send 5 Codex -> Claude handoffs.
   - Expected: each tool call returns a `handoff:<uuid>` immediately; peer replies are visible in the room and include the handoff id.

2. Single room queue gate
   - Set `CCM_ASK_PEER_MAX_INFLIGHT_PER_ROOM=2`.
   - Send 3 handoffs before peer replies include handoff ids.
   - Expected: first 2 are accepted; the 3rd is rejected with `ask_peer queue is full` and writes `ask_peer_denied` to `audit.jsonl`.

3. Single room rate gate
   - Set `CCM_ASK_PEER_RATE_LIMIT=2` and `CCM_ASK_PEER_RATE_WINDOW_MS=60000`.
   - Send 3 same-direction handoffs within the window.
   - Expected: first 2 are accepted; the 3rd is rejected with `rate limit exceeded` and writes `ask_peer_denied`.

4. Multi-room concurrency
   - Prepare 10 allowed test rooms or test threads.
   - In each room, start Claude and Codex slots.
   - Send 5 concurrent handoffs per room.
   - Expected: daemon CPU stays low, no synchronous wait accumulation, accepted handoffs return quickly, and queue/rate denials are deterministic.

5. Restart resilience
   - Send handoffs, then restart daemon before replies land.
   - Expected: no hidden answer waiters are lost because none exist; visible peer replies still appear if native sessions continue. In-memory in-flight gates reset, which is acceptable until a persistent queue is explicitly added.

## Evidence to collect

- `audit.jsonl` entries:
  - `ask_peer_sent`
  - `ask_peer_denied`
  - `ask_peer_replied` with `correlation: explicit_handoff_id` or `single_inflight_same_thread_fallback`
- Slack/Telegram visible transcript with identity headers and handoff ids.
- For Telegram, confirm unsupported reaction warnings do not fail the turn and valid peer reply anchors do not produce avoidable main-room fallback.
- Daemon logs without tool-call timeout storms.
- `systemctl --user show ccm-daemon.service -p MainPID -p ActiveState -p SubState`.
- Optional: process CPU/RSS sampled during the run.

## Pass criteria

- No `ask_peer` call waits for a peer answer.
- No hidden peer answer payload is delivered to the asking agent.
- Accepted handoffs include `handoff:<uuid>` in tool result, peer prompt, and audit metadata.
- A peer reply without the id only clears in-flight state when exactly one handoff is pending for that peer session in the same thread.
- Queue and rate denials are deterministic and auditable.
- Daemon remains responsive while peer LLM turns are still running.
