// Smoke test: fetch the real ESPN scoreboard and run the parser. Writes nothing.
// Usage: node test-parse.js
const { parseScoreboard, ESPN_BASE } = require('./importCore');

(async () => {
  const res = await fetch(`${ESPN_BASE}/scoreboard?dates=20260611-20260719&limit=500`);
  if (!res.ok) { console.error('ESPN HTTP', res.status); process.exit(1); }
  const sb = await res.json();
  const p = parseScoreboard(sb, {}, {});
  console.log({
    totalEvents: (sb.events || []).length,
    live: p.liveCount,
    liveScores: p.liveScores,
    finishedResults: Object.keys(p.results).length,
    withScorers: Object.keys(p.scorers).length,
    withOdds: Object.keys(p.odds).length,
    knockoutWinners: Object.fromEntries(
      Object.entries(p.knockoutWinners).map(([k, v]) => [k, v.length])
    ),
  });
})();
