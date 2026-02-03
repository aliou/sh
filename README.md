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
- Assignments (`FOO=bar cmd`)
- Control flow: `if/elif/else/fi`, `while/until`, `for/in`, `select/in`, `case/esac`
- Functions (`foo() {}`, `function foo {}`)
- Subshells `()`, blocks `{}`
- `[[ ]]` test expressions, `(( ))` arithmetic commands
- `coproc`, `time`, negation (`!`)
- Comments, backslash line continuations, background (`&`), semicolons

## Install

### From a public GitHub repo (no registry needed)

The simplest approach. Requires the repo to be pushed to GitHub:

```bash
pnpm add github:aliou/sh
```

This clones the repo and runs the `prepack` script, which builds `dist/`. Pin a specific commit or tag:

```bash
pnpm add github:aliou/sh#v0.1.0
pnpm add github:aliou/sh#bbf1d86
```

### From a GitHub release tarball

Attach the built `.tgz` to a GitHub release, then:

```bash
pnpm add https://github.com/aliou/sh/releases/download/v0.1.0/aliou-sh-0.1.0.tgz
```

To create the tarball locally:

```bash
pnpm build && pnpm pack
# produces aliou-sh-0.0.1.tgz
```

### From npm (npmjs.com)

If published to npm:

```bash
pnpm add @aliou/sh
```

### From GitHub Packages

Requires a `GITHUB_TOKEN` for all consumers, even if the package is public. Probably not worth the friction unless the repo is private.

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

### Git hooks

- **pre-commit**: staged file formatting/linting (biome) + typecheck
- **pre-push**: tests

## Status

Work in progress. The parser covers the common Bash subset needed for AST-based command analysis (e.g., guardrail enforcement). Not yet a complete POSIX/Bash parser.

## License

UNLICENSED
