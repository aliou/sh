# @aliou/sh

## 0.4.1

### Patch Changes

- 812d043: Preserve command ASTs and heredoc bodies through end of input for unterminated heredocs when error recovery is enabled.

## 0.4.0

### Minor Changes

- 4295a42: Close parser fidelity and supply-chain gaps from the security audit. `${...}` operand scanning is quote/escape-aware, so quoted or escaped braces no longer swallow following source text; heredoc bodies and delimiters keep byte fidelity (CR is data, folding only on odd trailing backslash runs); operator words of parameter expansions, extglob patterns (now a structural `ExtGlob.word`), and arithmetic operands of indexed `let`/`declare` assignments are parsed structurally; `$'...'` and `$"..."` words become new `AnsiC`/`LocaleStr` AST nodes instead of flattened literals. Adjacent `Literal` parts merge at the AST level. The publish workflow now only runs for same-repository pushes to `main`, closing the `workflow_run`/`head_sha` trust gap, and the vitest/vite dev dependencies are bumped past their Dependabot alerts.

### Patch Changes

- c8bdc26: Tokenize newlines as first-class tokens and make separator handling match bash. The tokenizer now emits a `newline` token instead of smuggling line breaks as `op ";"` tokens, and one parameterized skip helper replaces the three separator-skipping loops. As a result the parser now rejects inputs bash rejects — `foo; ; bar`, `foo\n; bar`, `;;` outside `case`, a `;` after `&` (except the `;;` case terminator), a stray `;` where a statement, loop condition, or case-item body was expected — and accepts linebreak positions bash allows, such as `! # c\nfoo`, `x() # c\n{ foo; }`, and `foo & ;; esac`. zsh's lax separators keep working (`foo; ; bar`, `a=(1;2)`, `$(foo; ; bar)` parse in zsh mode). Missing operator continuations (`foo && # c`, `foo && ; bar`, `foo &&` at EOF) now report `` `&&` must be followed by a statement `` anchored at the operator's position — including real outer positions for operators inside `$(...)` — matching mvdan/sh, instead of a deep "Expected a command word". The parser was also split into focused modules under `src/parser/` (clauses, iterators, case, decl-let, test-clause, redirects, commands, words, and a shared parser-state module); behavior is unchanged apart from the fixes above.

## 0.3.5

### Patch Changes

- b0aed19: Ship `CHANGELOG.md` in the npm tarball so pi can show the changelog when the extension updates.

## 0.3.4

### Patch Changes

- c240d09: Add MIT license (was UNLICENSED), with attribution to mvdan/sh (BSD 3-Clause, © Daniel Martí) from which this project is ported.

## 0.3.3

### Patch Changes

- ef11bec: Fix parsing of comments and line breaks inside operator continuations. A comment (or blank line) after `&&`, `||`, or `|` before the continued command on the next line no longer throws "Expected a command word" — e.g. `foo && # note\nbar` now parses as in bash and mvdan-sh. A literal `;` after an operator (`foo && ; bar`) and an operator with no right-hand side at end of input still error.

## 0.3.2

### Patch Changes

- f603a63: Lower the minimum Node version back to 22 (`engines.node`). The 0.3.x dist
  contains no Node 24-only APIs, the full test suite passes on Node 22, and
  type-checking now targets `@types/node@^22` so new code can't silently rely on
  Node 24 stdlib additions. The Nix dev shell provides Node 22 (with pnpm pinned
  to run on it), CI checks both Node 22 and 24, and the published build is
  produced on 22.

## 0.3.1

### Patch Changes

- 8ad6f38: Attach redirects written after compound commands (`fi`, `done`, `}`, `)`, `esac`, `]]`, function bodies, coproc) to the compound AST node instead of a phantom word-less `SimpleCommand` statement. Covers `while read x; do ...; done < files`, `{ a; b; } > out`, `if foo; then bar; fi <<EOF`, and fd/multi-redirect shapes; nested compounds, function/coproc bodies, elif chains, and `time` blocks each keep redirects at the correct nesting level.
- 5fdee45: Fix parsing of commands that open multiple heredocs on one line (`cat << A << B`) or place a separator after a heredoc opener (`cmd << EOF && next`): heredoc bodies are now queued per command line and assigned to their redirects in opener order instead of throwing an unexpected-token parse error.
- 3952fa2: Fix heredoc commands swallowing the statement that follows the delimiter line: a heredoc as the last command of an if/for/while body no longer throws, and a command after the delimiter now parses as its own statement instead of merging into the heredoc-opening command.

## 0.3.0

### Minor Changes

- dae89a6: Raise the minimum Node version from 22 to 24 (`engines.node`). Also migrate git hooks from husky to lefthook, bump Biome to 2.5 with grit-QL plugins, and update pnpm to 11.

### Patch Changes

- 9b6c5e4: Parse `{varname}` file descriptor redirects in Bash and Zsh, and reject them in POSIX and mksh.
- b07ada4: Refresh the bundled sh-ast skill: document source positions, `recoverErrors`, lazy `parseStmtsSeq`/`parseWordsSeq`, `splitBraces`/`BraceExp`, `ExtGlob`, and the select/coproc/time clauses. Drop stale limitations.

## 0.2.2

### Patch Changes

- 63b3cc5: Fix top-level word scanning for escaped characters.

## 0.2.1

### Patch Changes

- edc6432: Sync parser behaviors with mvdan/sh v3.13.x:

  - `#` is no longer treated as a comment inside `[[ ]]` test clauses.
  - Arithmetic literals now support bash integer base syntax (e.g. `16#FF`, `2#1010`).
  - Empty command lists in blocks, subshells, and clause bodies are rejected in POSIX/Bash/mksh (Zsh still allows them).
  - Declaration commands with brace patterns in variable names (e.g. `declare {a,b}_c=value`) parse correctly.

## 0.2.0

### Minor Changes

- 5ef2b75: Add agent skill for AST usage

  New `skills/sh-ast/SKILL.md` provides documentation and examples for agents
  using the parser programmatically: extracting commands, analyzing pipelines,
  finding variables, checking for unsafe patterns, and traversing the AST.

## 0.1.0

### Minor Changes

- 0f1209b: Initial release.
