# Commands

## Root commands

### `pnpm dev`

Starts the local Postgres container, then runs `turbo dev` from the repository
root. It uses port `5432` when available and otherwise selects the next free
port, passing the matching database URL to the backend.

Turbo will start every workspace that exposes a `dev` script. That means this
is the broad monorepo entry point.

Today it starts:

- `apps/mobile`
- `apps/docs`

### `pnpm dev:mobile`

Runs `turbo -F mobile dev`.

This starts only the Expo mobile app.

### `pnpm dev:docs`

Runs `turbo -F docs dev`.

This starts only the MkDocs documentation site.

### `pnpm build:docs`

Builds the static documentation site in `apps/docs/site`.

## Why `dev` and `dev:mobile` differ

`pnpm dev` is the monorepo default.

`pnpm dev:mobile` is the app-specific shortcut.

As the repository grows, `pnpm dev` becomes the command for running the whole
developer surface, while filtered commands stay useful when you only want one
target.
