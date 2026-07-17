# Orca — Frontend

The web client for Orca, a no-code backtesting platform for traders. Build,
test, and optimize trading strategies against real market history — no coding
required.

## Tech stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Local development

Requires Node.js & npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
# Install dependencies
npm i

# Start the dev server (http://localhost:8080)
npm run dev
```

Environment variables are read from the repo-root `.env` (see `envDir` in
`vite.config.ts`). Copy `.env.example` to `.env` and fill in the values —
notably `VITE_DJANGO_API_URL` pointing at the backend API.

## Build

```sh
npm run build      # production build to dist/
npm run preview    # preview the production build locally
```

## Social share card

The Open Graph / Twitter card at `public/og-image.png` is generated from
`scripts/gen-og-image.mjs`. Re-run it after any branding or copy change:

```sh
node scripts/gen-og-image.mjs
```
