# Live score updater (Cloud Function)

`liveScores` runs **every minute** via Cloud Scheduler and pushes live/finished
match data from the ESPN unofficial API into Firebase Realtime DB. It is **live
only**: each run does a single lightweight scoreboard read and returns
immediately (no standings fetch, no DB write) whenever nothing is in progress
and nothing has just finished — so idle minutes cost ~nothing.

The older `scripts/import-scores.js` GitHub Action (every 5 min) is kept as a
backup for standings/odds/finals and can be removed once this is proven in a
live match.

## What it writes

- `scores/{id}` — updated live for in-progress matches (no result set yet, so
  the UI keeps showing them as LIVE)
- `results/{id}`, `scorers/{id}`, `cards/{id}` — on full time (scorers/cards
  imported once, then locked via `eventsImported/{id}`)
- `odds/{id}`, `standings/{group}`, knockout winners, `results/golden_boot_leader`,
  `config/prevRanks` — standings + rank snapshot only refresh when a match just
  finished

## Deploy

Requires the **Blaze** (pay-as-you-go) plan — scheduled functions use Cloud
Scheduler. At this volume it stays within the free tier. Credentials come from
the function's default service account (no `FIREBASE_SERVICE_ACCOUNT` secret).

```bash
cd functions
npm install
cd ..
firebase login          # one-time, as a project editor/owner
firebase deploy --only functions
```

Watch it:

```bash
firebase functions:log --only liveScores
```

Expected log lines: `{"skipped":"idle","live":0}` when nothing is on,
`{"wrote":N,"live":1,...}` during a match.

## Local smoke test (parsing only, no Firebase)

`node test-parse.js` fetches the real ESPN scoreboard and runs the parser,
printing live/finished counts. Safe to run anytime; writes nothing.
