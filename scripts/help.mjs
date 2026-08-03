console.log(`
When Did I Last — available commands
=====================================

Dev
  pnpm dev              Start Postgres + backend + web (turbo TUI)
  pnpm dev:backend      Start only the backend
  pnpm dev:web          Start only the web app
  pnpm dev:mobile       Start only the mobile app (Expo)
  pnpm dev:docs         Start only the docs site
  pnpm devstop          Stop Postgres (alias for db:down)
  pnpm setupenv         Generate local .env files

Build
  pnpm build            Build all apps
  pnpm build:web        Build the web app
  pnpm build:web:docker Build the web app Docker image
  pnpm build:backend    Build the backend
  pnpm build:backend:docker  Build the backend Docker image
  pnpm build:mobile     Build the mobile app
  pnpm install:android  Build and install the Android release APK

Database
  pnpm db:up            Start Postgres
  pnpm db:down          Stop Postgres
  pnpm db:restart       Restart Postgres

Quality
  pnpm lint             Lint all apps (pnpm lint:web / :backend / :mobile / :docs)
  pnpm typecheck        Typecheck all apps
  pnpm test             Run all tests (pnpm test:web / :backend / :mobile / :docs / :integration)
  pnpm format           Format all apps
  pnpm check            Typecheck + lint + test everything

--------------------------------------------------------------
Most useful for local development:

  pnpm setupenv         First-time setup: generate .env files
  pnpm dev               Start Postgres + backend + web
  pnpm devstop            Stop Postgres
`);
