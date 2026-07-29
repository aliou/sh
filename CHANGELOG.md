# @aliou/sh

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
