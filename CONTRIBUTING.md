# Contributing

Cipher uses local checks instead of GitHub Actions.

```bash
npm install
make install-hooks
make test
make build
make smoke
```

Use Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ops:`, or `data:`.

Do not commit secrets, private keys, `.env` files with real values, or generated credentials. The pre-commit hook requires `gitleaks`.
