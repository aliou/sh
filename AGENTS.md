# Agents

Goal: TypeScript reimplementation of a shell parser/AST (mvdan/sh-style), targeting Node.js 22+.

## Dev env
- Nix: `nix develop`
- Node: 22+
- Package manager: pnpm (see `package.json#packageManager`)

## Common commands
- Install: `pnpm install`
- Format+lint: `pnpm check`
- Typecheck: `pnpm typecheck`
- Tests: `pnpm test`
- Build: `pnpm build`

## Git hooks (husky)
- pre-commit: staged formatting/linting + typecheck
- pre-push: tests
