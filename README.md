# @aliou/sh

TypeScript shell parser inspired by [mvdan/sh](https://github.com/mvdan/sh). Parses POSIX/Bash shell commands into a typed AST.

Zero dependencies. Single exported function. ~28 KB bundled.

## Usage

```typescript
import { parse } from "@aliou/sh";

const { ast } = parse('echo "hello $USER" | grep hello');
// ast.type === "Program"
// ast.body[0].command.type === "Pipeline"
```

The parser returns a `Program` node containing `Statement` nodes. Each statement wraps a `Command`, which is one of:

- `SimpleCommand` -- words, assignments, redirects
- `Pipeline`, `Logical` (`&&`, `||`)
- `IfClause`, `WhileClause`, `ForClause`, `SelectClause`, `CaseClause`
- `FunctionDecl`, `Subshell`, `Block`
- `TestClause` (`[[ ]]`), `ArithCmd` (`(( ))`), `CoprocClause`, `TimeClause`
- `DeclClause` (`declare`, `local`, `export`, `readonly`, `typeset`, `nameref`)
- `LetClause` (`let`), `CStyleLoop` (`for (( ; ; ))`)

Words contain typed parts: `Literal`, `SglQuoted`, `DblQuoted`, `ParamExp`, `CmdSubst`, `ArithExp`, `ProcSubst`.

### Example: extract command names

```typescript
import { parse, type SimpleCommand } from "@aliou/sh";

function extractCommandNames(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  const names: string[] = [];

  if (n.type === "SimpleCommand") {
    const cmd = n as unknown as SimpleCommand;
    if (cmd.words?.length) {
      const first = cmd.words[0];
      if (first.parts.length === 1 && first.parts[0].type === "Literal") {
        names.push(first.parts[0].value);
      }
    }
  }

  for (const val of Object.values(n)) {
    if (Array.isArray(val)) {
      for (const item of val) names.push(...extractCommandNames(item));
    } else if (val && typeof val === "object") {
      names.push(...extractCommandNames(val));
    }
  }
  return names;
}

const { ast } = parse("grep -rn npm package.json | head -5");
extractCommandNames(ast); // ["grep", "head"]
```

## Supported syntax

- Simple commands, pipelines, logical operators (`&&`, `||`)
- Single and double quotes, parameter expansion (`$var`, `${var:-default}`)
- Command substitution (`$(cmd)`, `` `cmd` ``), arithmetic expansion (`$((expr))`)
- Process substitution (`<(cmd)`, `>(cmd)`)
- Heredocs (`<<`, `<<-`), herestrings (`<<<`)
- All redirect operators (`>`, `>>`, `<`, `>&`, `<&`, `<>`, `>|`, `&>`, `&>>`)
- Assignments (`FOO=bar cmd`), append assignments (`FOO+=bar`)
- Array expressions (`arr=(a b c)`, `arr=([0]=x [1]=y)`)
- Declaration builtins as special forms (`declare`, `local`, `export`, `readonly`, `typeset`, `nameref`)
- `let` expressions (`let i++ j=2`)
- Control flow: `if/elif/else/fi`, `while/until`, `for/in`, `for ((...))`, `select/in`, `case/esac`
- Functions (`foo() {}`, `function foo {}`)
- Subshells `()`, blocks `{}`
- `[[ ]]` test expressions, `(( ))` arithmetic commands
- `coproc`, `time`, negation (`!`)
- Comments (optionally preserved via `keepComments` option), backslash line continuations, background (`&`), semicolons

## Install

```bash
pnpm add github:aliou/sh
```

## Development

Requires [Nix](https://nixos.org/) (provides Node 22 and pnpm):

```bash
nix develop

pnpm install     # install deps
pnpm test        # run tests (vitest)
pnpm typecheck   # tsc --noEmit
pnpm check       # biome format + lint
pnpm build       # rolldown + tsc declarations
```

Git hooks (via husky):
- **pre-commit**: staged file formatting/linting + typecheck
- **pre-push**: tests

## Status

Work in progress. Covers the Bash subset needed for AST-based command analysis (command classification, variable mutation tracking, guardrail enforcement). Not yet a complete POSIX/Bash parser -- notably missing: position tracking in AST nodes, extended globbing, and full arithmetic expression parsing.

## License

UNLICENSED
