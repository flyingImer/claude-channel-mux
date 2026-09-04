---
name: harness-refresh
description: Explicitly refresh this room's orchestration harness against the plugin's generic harness (harness/ in claude-channel-mux). Use when the owner says "refresh harness", "/harness-refresh", or after a harness version bump. Prints the version state and the changelog delta; the orchestrator then derives the delta per G0.
---
Resolve `<orch-dir>`: the harness dir recorded for this room (`/ccm harness` shows it; it is `<cwd>/.ccm-harness/<name>`). Then run:

```
bash <plugin>/harness/harness-sync.sh --refresh <orch-dir>
```

where `<plugin>` is the claude-channel-mux checkout or installed plugin dir. Follow the printed instruction: derive ONLY the delta in this effort's conventions (G0), write `vN <commit>` to `<orch-dir>/generic-version`, add a derivation note, and file deviations to the operator's private inbox (see G0 §Versioning). Never copy the generic docs into the effort; reference the source.
