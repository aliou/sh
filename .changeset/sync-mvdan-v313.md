---
"@aliou/sh": patch
---

Sync parser behaviors with mvdan/sh v3.13.x:

- `#` is no longer treated as a comment inside `[[ ]]` test clauses.
- Arithmetic literals now support bash integer base syntax (e.g. `16#FF`, `2#1010`).
- Empty command lists in blocks, subshells, and clause bodies are rejected in POSIX/Bash/mksh (Zsh still allows them).
- Declaration commands with brace patterns in variable names (e.g. `declare {a,b}_c=value`) parse correctly.
