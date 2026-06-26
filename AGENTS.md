# Repository Guidelines

## Project Structure & Module Organization

This repository is currently empty, so keep the initial structure simple and predictable as code is added. Place application source under `src/`, automated tests under `tests/`, and static or generated assets under `assets/` when needed. Keep environment examples, setup notes, and architecture decisions at the repository root or in `docs/`.

Suggested layout:

```text
src/        Application code
tests/      Unit and integration tests
assets/     Images, fixtures, or other non-code resources
docs/       Design notes and contributor documentation
```

## Build, Test, and Development Commands

No build system is configured yet. When one is introduced, document the exact commands in the project README and keep this guide in sync. Prefer standard command names for the chosen ecosystem, for example:

```bash
npm install     # install JavaScript dependencies
npm run dev     # start the local development server
npm test        # run the test suite
npm run build   # produce a production build
```

Avoid adding ad hoc scripts that are not checked into version control or documented.

## Coding Style & Naming Conventions

Follow the conventions of the language and framework selected for the project. Use consistent indentation across each file type, prefer descriptive names, and keep modules focused on one responsibility. Use `kebab-case` for file and directory names unless the framework requires another pattern. Use `PascalCase` for UI components or classes and `camelCase` for functions and variables.

Add a formatter and linter early, such as Prettier and ESLint for JavaScript or the standard formatter for the chosen language.

## Testing Guidelines

Add tests alongside each meaningful feature. Use `tests/` for repository-level tests and mirror the source structure where practical, such as `tests/browser/session.test.*` for `src/browser/session.*`. Name tests after behavior, not implementation details.

Tests should be repeatable from a single command such as `npm test`, `pytest`, or the equivalent for the selected stack.

## Commit & Pull Request Guidelines

This directory has no Git history available, so use clear, imperative commit messages such as `Add browser session manager` or `Fix tab cleanup on shutdown`. Keep commits focused and avoid mixing unrelated changes.

Pull requests should include a short description, the commands run for verification, linked issues when applicable, and screenshots or recordings for UI changes. Note any configuration, migration, or follow-up work reviewers need to understand.

## Security & Configuration Tips

Do not commit secrets, local credentials, API keys, or machine-specific configuration. Provide safe defaults through example files such as `.env.example`, and document required variables before relying on them in code.
