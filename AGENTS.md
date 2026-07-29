# Agents

Goal: TypeScript reimplementation of a shell parser/AST (mvdan/sh-style), targeting Node.js 24+.

## Dev env
- Nix: `nix develop`
- Node: 24+
- Package manager: pnpm (see `package.json#packageManager`)

## Common commands
- Install: `pnpm install`
- Lint: `pnpm lint`
- Format: `pnpm format`
- Typecheck: `pnpm typecheck`
- Tests: `pnpm test`
- Build: `pnpm build`

## Git hooks (lefthook)
- pre-commit: staged formatting/linting + typecheck
- pre-push: tests

## CI/CD
- **CI**: Runs on push to `main` and pull requests. Executes: check, typecheck, test, build.
- **Release**: Runs on push to `main` via changesets. If pending changesets exist, opens a "Version Packages" PR. Merging that PR publishes to npmjs.com.

## Publishing
This package is published to the public npm registry (npmjs.com) under `@aliou/sh`. Uses OIDC for authentication - no token secrets needed after initial manual publish.

Release workflow (using [changesets](https://github.com/changesets/changesets)):
1. Make code changes
2. Add a changeset: `pnpm changeset` (select bump type: patch/minor/major, write summary)
3. Commit the changeset file with your code and push/merge to `main`
4. The release workflow opens a "Version Packages" PR that bumps the version and updates CHANGELOG.md
5. Merge that PR to publish to npmjs.com
