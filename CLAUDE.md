# LUCKY BREAKS — Claude Project Rules

## Commit and push after every change
After making ANY code change, always commit and push to GitHub immediately.
Do not wait to be asked. Steps every time:
1. `git add` the changed files
2. `git commit` with a clear message
3. `git pull --rebase origin main` (in case the sync bot pushed)
4. `git push origin main`

The live site (luckybreaks.xyz) deploys from GitHub. Changes that are not pushed do not appear on the live site.

## No em dashes
Never use em dashes ( — ) in any UI copy or commit messages. Use colons or commas instead.
