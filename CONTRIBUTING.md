# Contributing

Thank you for helping improve Predatory Journal Watch.

## Before you start

- **Bug reports and ideas:** open an [issue](https://github.com/AllHailSeizure/predatory-journal-watch/issues) with enough detail to reproduce or explain the change you want.
- **Questions for moderators using the app:** see [README.md](README.md) and the [Privacy Policy](https://allhailseizure.github.io/predatory-journal-watch/privacy/).

## Pull requests

1. Fork the repository and create a branch from `master`.
2. Make focused changes; keep pull requests easy to review.
3. Open a pull request **against `master`** and describe what you changed and why.
4. Fix any feedback from reviewers or automated checks on the PR.

## Code style

- Match the existing TypeScript style in `src/server/`.
- Run **ESLint** and **Prettier** before you push:
  - `npm run lint` (or `npm run lint:fix`)
  - `npm run format`
- Do not edit `src/server/test-harness/` in this repository; that tree is synced from [devvit-app-template](https://github.com/AllHailSeizure/devvit-app-template).

By contributing, you agree that your contributions are licensed under the same [MIT License](LICENSE) as the project.