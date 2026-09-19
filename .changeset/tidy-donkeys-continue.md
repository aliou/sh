---
"@aliou/sh": patch
---

Fix parsing of comments and line breaks inside operator continuations. A comment (or blank line) after `&&`, `||`, or `|` before the continued command on the next line no longer throws "Expected a command word" — e.g. `foo && # note\nbar` now parses as in bash and mvdan-sh. A literal `;` after an operator (`foo && ; bar`) and an operator with no right-hand side at end of input still error.
