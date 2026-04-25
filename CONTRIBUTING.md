# Contributing

Thanks for contributing to awesome-context-engine.

## Development Setup

1. Install dependencies:

```bash
npm install
```

2. Build the project:

```bash
npm run build
```

3. Run the CLI locally:

```bash
node dist/cli.js help
```

## Contribution Guidelines

- Keep changes focused and minimal.
- Preserve safe, explicit behavior in CLI flows.
- Do not introduce destructive file operations.
- Maintain idempotent behavior for init/index/sync.
- Prefer clear naming and small, composable functions.

## Cross-Platform Requirements

Changes must remain compatible with macOS, Ubuntu/Linux, and Windows.

- Prefer Node.js and npm script entrypoints over shell-specific tooling
- Avoid introducing OS-specific path assumptions
- Use `path` utilities in code for path handling
- If adding scripts, ensure they run in a standard `npm run` context

## Pull Request Checklist

- Code builds successfully with `npm run build`.
- New behavior is validated with a direct CLI run.
- README/docs are updated when user-facing behavior changes.
- No secrets or credentials are committed.

## Reporting Issues

When opening an issue, include:

- expected behavior
- actual behavior
- command used
- relevant output
- environment details (OS, Node version)

## Code of Conduct

Be respectful, constructive, and collaborative in all project interactions.
