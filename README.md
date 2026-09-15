# @aliou/sh

Shell parser and typed AST for TypeScript. Handles POSIX, Bash, mksh, and zsh syntax. Zero runtime dependencies, ~66 KB bundled.

## Install

```bash
npm install @aliou/sh
```

Requires Node.js 22+.

## Quick start

```typescript
import { parse } from "@aliou/sh";

const { ast } = parse('echo "hello $USER" | grep hello');
// ast.type === "Program"
// ast.body[0].command.type === "Pipeline"
```

`parse` returns a `Program` whose body holds `Statement` nodes. Every statement wraps a `Command`:

| Command | Shell syntax |
|---|---|
| `SimpleCommand` | words, assignments, redirects |
| `Pipeline` | `a \| b` |
| `Logical` | `a && b`, `a \|\| b` |
| `IfClause`, `WhileClause`, `ForClause`, `SelectClause`, `CaseClause` | control flow |
| `FunctionDecl` | `foo() {}`, `function foo {}` |
| `Subshell`, `Block` | `( ... )`, `{ ... }` |
| `TestClause`, `ArithCmd` | `[[ ... ]]`, `(( ... ))` |
| `CoprocClause`, `TimeClause` | `coproc`, `time` |
| `DeclClause` | `declare`, `local`, `export`, `readonly`, `typeset`, `nameref` |
| `LetClause` | `let i++ j=2` |
| `CStyleLoop` | `for (( ; ; ))` |

Words hold typed parts: `Literal`, `SglQuoted`, `DblQuoted`, `ParamExp`, `CmdSubst`, `ArithExp`, `ProcSubst`, `BraceExp`, `ExtGlob`. Every node carries `pos` and `end` (`offset`, `line`, `col`) pointing into the source.

## Example: flag dangerous commands

Each node's `type` field narrows the union, so a generic walker can catch specific commands wherever they appear — pipelines, `&&` chains, subshells, command substitutions:

```typescript
import { parse, type SimpleCommand } from "@aliou/sh";

function findRmRf(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];

  const cmd = node as SimpleCommand;
  if (cmd.type === "SimpleCommand") {
    const [name, ...args] = (cmd.words ?? [])
      .map((w) => (w.parts[0].type === "Literal" ? w.parts[0].value : ""))
      .filter(Boolean);
    if (name === "rm" && args.some((a) => a.startsWith("-") && a.includes("r") && a.includes("f"))) {
      return [`rm ${args.join(" ")}`];
    }
  }

  return Object.values(cmd).flatMap((v) =>
    Array.isArray(v) ? v.flatMap(findRmRf) : findRmRf(v),
  );
}

const { ast } = parse("deploy.sh && rm -rf ./scratch; cp -r dist/ b/ || (rm -rf b/ && exit 1)");
findRmRf(ast); // ["rm -rf ./scratch", "rm -rf b/"]
```

This kind of check is the project's main use case: inspect or rewrite commands before handing a script to something that executes it.

## Options

```typescript
interface ParseOptions {
  dialect?: "posix" | "bash" | "mksh" | "zsh"; // default: "bash"
  keepComments?: boolean; // default: false
  recoverErrors?: boolean; // default: false
}
```

Set `recoverErrors: true` to get a partial AST plus an `errors` array instead of a thrown exception. Useful for analyzing incomplete or broken scripts (editors, linters).

## Lazy parsing

For large scripts, stream top-level nodes without building the whole AST:

```typescript
import { parseStmtsSeq, parseWordsSeq } from "@aliou/sh";

for (const stmt of parseStmtsSeq(source)) { /* one statement at a time */ }
for (const word of parseWordsSeq(source)) { /* one word at a time */ }
```

## Other exports

- `splitBraces(word)` — expand `{a,b}` / `{1..5}` brace expansion into a word. The parser does not emit brace expansions by default.
- `NO_POS` — sentinel position for nodes you build by hand.
- Full TypeScript types for every AST node.

## Supported syntax

- Simple commands, pipelines, `&&`, `||`, background (`&`), semicolons
- Quoting: `'...'`, `"..."`, backslash continuations
- Parameter expansion: `$var`, `${var:-default}`, `${var/pat/repl}`, slices, indirection
- Command substitution: `$(cmd)`, `` `cmd` ``
- Arithmetic: `$((expr))`, `((expr))`, C-style `for (( ; ; ))`
- Process substitution: `<(cmd)`, `>(cmd)`
- Heredocs (`<<`, `<<-`) and herestrings (`<<<`)
- Redirects: `>`, `>>`, `<`, `>&`, `<&`, `<>`, `>|`, `&>`, `&>>`, plus `{varname}` fd redirects (Bash/zsh)
- Assignments and appends: `FOO=bar`, `FOO+=bar`, command-scoped env
- Arrays: `arr=(a b c)`, `arr=([0]=x [1]=y)`
- Control flow: `if/elif/else/fi`, `while/until`, `for/in`, `select/in`, `case/esac`
- Functions, subshells, blocks, `[[ ]]`, `(( ))`, `coproc`, `time`, `!`
- Extended globs `@(foo)`, `*(bar)` (Bash/mksh)
- Comments (with `keepComments: true`)

## Status

Work in progress. Covers the Bash subset needed for AST-based command analysis (classification, variable-mutation tracking, guardrail enforcement). It is not a complete POSIX/Bash parser; edge cases in less common dialect features may be missing.

## Development

Requires [Nix](https://nixos.org/) for the dev shell:

```bash
nix develop
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome
pnpm build       # rolldown + declarations
```

## License

UNLICENSED
