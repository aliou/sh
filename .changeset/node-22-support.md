---
"@aliou/sh": patch
---

Lower the minimum Node version back to 22 (`engines.node`). The 0.3.x dist
contains no Node 24-only APIs, the full test suite passes on Node 22, and
type-checking now targets `@types/node@^22` so new code can't silently rely on
Node 24 stdlib additions. The Nix dev shell provides Node 22 (with pnpm pinned
to run on it), CI checks both Node 22 and 24, and the published build is
produced on 22.
