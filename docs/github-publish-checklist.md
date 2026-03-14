# GitHub Publish Checklist

## Safe working directory

Work only from:

- `C:\Users\glebg\AppData\Local\Canvid\Movion`

Do not initialize or publish from:

- `C:\Users\glebg\AppData\Local\Canvid`
- `C:\Users\glebg\AppData\Local\Canvid\canvid-local-fork`

## Before first push

1. Review `git status --short` from the `Movion` directory only.
2. Confirm no personal media, exports, logs, or `.env` files are present.
3. Read `.gitignore`, `PRIVACY.md`, and `SECURITY.md`.
4. Confirm branding and README are acceptable for public release.

## Recommended GitHub flow

1. Create an empty GitHub repository named `movion`.
2. Do not add a README, `.gitignore`, or license on GitHub.
3. In the local `Movion` directory, run:

```powershell
git add .
git commit -m "Prepare public Movion open-source edition"
git remote add origin https://github.com/<your-org-or-user>/movion.git
git push -u origin main
```

## Safety rules

- Never run `git add .` from `C:\Users\glebg\AppData\Local\Canvid`.
- Never commit `node_modules`, `dist`, `output`, logs, recordings, exports, or local env files.
- Keep API keys only in local environment variables or ignored `.env` files.
- If a secret was ever committed in another repo, rotate it before any public release.

## After first push

1. Enable GitHub secret scanning and Dependabot alerts.
2. Check the repository file list in the web UI before announcing it.
3. Add branch protection once the default branch is stable.
4. Publish a short roadmap and mark a few issues as `good first issue`.
