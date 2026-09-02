---
"@aliou/sh": patch
---

Attach redirects written after compound commands (`fi`, `done`, `}`, `)`, `esac`, `]]`, function bodies, coproc) to the compound AST node instead of a phantom word-less `SimpleCommand` statement. Covers `while read x; do ...; done < files`, `{ a; b; } > out`, `if foo; then bar; fi <<EOF`, and fd/multi-redirect shapes; nested compounds, function/coproc bodies, elif chains, and `time` blocks each keep redirects at the correct nesting level.
