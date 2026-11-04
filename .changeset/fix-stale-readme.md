---
"@aliou/sh": patch
---

Fix stale README claims: the bundle is ~73 KB (not ~66 KB), and extended globs (`@(foo)`, `*(bar)`) are supported in zsh as well as Bash and mksh. Clarify that `splitBraces` mutates the word in place and returns whether it changed. Apply the same extglob fix to the bundled sh-ast skill.
