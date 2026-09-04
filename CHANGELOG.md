# @aliou/sh

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
