---
"@aliou/sh": minor
---

Close parser fidelity and supply-chain gaps from the security audit. `${...}` operand scanning is quote/escape-aware, so quoted or escaped braces no longer swallow following source text; heredoc bodies and delimiters keep byte fidelity (CR is data, folding only on odd trailing backslash runs); operator words of parameter expansions, extglob patterns (now a structural `ExtGlob.word`), and arithmetic operands of indexed `let`/`declare` assignments are parsed structurally; `$'...'` and `$"..."` words become new `AnsiC`/`LocaleStr` AST nodes instead of flattened literals. Adjacent `Literal` parts merge at the AST level. The publish workflow now only runs for same-repository pushes to `main`, closing the `workflow_run`/`head_sha` trust gap, and the vitest/vite dev dependencies are bumped past their Dependabot alerts.
