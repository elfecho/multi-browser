# Multi Browser

Desktop multi-account isolated browser manager built with Electron, React, Playwright, and SQLite.

## Development

```bash
npm install
npm run dev
```

## Commands

```bash
npm run dev     # start Vite and Electron for local development
npm run build   # build the renderer bundle
npm start       # run Electron against the built renderer
npm test        # run Node unit tests
```

Application data is stored under `data/` during development. Each account receives an isolated Chromium profile directory under `data/profiles/`.
