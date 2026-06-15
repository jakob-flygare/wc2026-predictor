// import-scores.js
// Fetches WC2026 results, scores, scorers, cards, and odds entirely from
// the ESPN unofficial API (no key required). Writes to Firebase Realtime DB.
// Runs as a GitHub Action every 5 minutes + on every push to main.

const admin = require('firebase-admin');

const DB_URL = process.env.FIREBASE_DATABASE_URL;
const SA     = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({ credential: admin.credential.cert(SA), databaseURL: DB_URL });
const db = admin.database();

// ── Team name normalisation ───────────────────────────────────────────────────
const TEAM_MAP = {
  // ESPN display name variations
  'United States':                  'USA',
  'Korea Republic':                 'South Korea',
  'Czech Republic':                 'Czechia',
  'Turkey':                         'Türkiye',
  'Bosnia and Herzegovina':         'Bosnia-Herzegovina',
  'Congo DR':                       'DR Congo',
  'Democratic Republic of Congo':   'DR Congo',
  "Cote d'Ivoire":                  'Ivory Coast',
  "Côte d'Ivoire":                  'Ivory Coast',
  'Curacao':                        'Curaçao',
};
const norm = name => TEAM_MAP[name] || name;

// ── Our group-stage matches (plain team names, no emoji) ──────────────────────
const OUR_MATCHES = [
  // Group A
  {id:1,  home:'Mexico',             away:'South Africa'},
  {id:2,  home:'South Korea',        away:'Czechia'},
  {id:25, home:'Czechia',            away:'South Africa'},
  {id:28, home:'Mexico',             away:'South Korea'},
  {id:53, home:'Czechia',            away:'Mexico'},
  {id:54, home:'South Africa',       away:'South Korea'},
  // Group B
  {id:3,  home:'Canada',             away:'Bosnia-Herzegovina'},
  {id:5,  home:'Qatar',              away:'Switzerland'},
  {id:26, home:'Switzerland',        away:'Bosnia-Herzegovina'},
  {id:27, home:'Canada',             away:'Qatar'},
  {id:49, home:'Switzerland',        away:'Canada'},
  {id:50, home:'Bosnia-Herzegovina', away:'Qatar'},
  // Group C
  {id:6,  home:'Brazil',             away:'Morocco'},
  {id:7,  home:'Haiti',              away:'Scotland'},
  {id:30, home:'Scotland',           away:'Morocco'},
  {id:31, home:'Brazil',             away:'Haiti'},
  {id:51, home:'Scotland',           away:'Brazil'},
  {id:52, home:'Morocco',            away:'Haiti'},
  // Group D
  {id:4,  home:'USA',                away:'Paraguay'},
  {id:8,  home:'Australia',          away:'Türkiye'},
  {id:29, home:'USA',                away:'Australia'},
  {id:32, home:'Türkiye',            away:'Paraguay'},
  {id:59, home:'Türkiye',            away:'USA'},
  {id:60, home:'Paraguay',           away:'Australia'},
  // Group E
  {id:9,  home:'Germany',            away:'Curaçao'},
  {id:11, home:'Ivory Coast',        away:'Ecuador'},
  {id:34, home:'Germany',            away:'Ivory Coast'},
  {id:35, home:'Ecuador',            away:'Curaçao'},
  {id:55, home:'Ecuador',            away:'Germany'},
  {id:56, home:'Curaçao',            away:'Ivory Coast'},
  // Group F
  {id:10, home:'Netherlands',        away:'Japan'},
  {id:12, home:'Sweden',             away:'Tunisia'},
  {id:33, home:'Netherlands',        away:'Sweden'},
  {id:36, home:'Tunisia',            away:'Japan'},
  {id:57, home:'Japan',              away:'Sweden'},
  {id:58, home:'Tunisia',            away:'Netherlands'},
  // Group G
  {id:14, home:'Belgium',            away:'Egypt'},
  {id:16, home:'Iran',               away:'New Zealand'},
  {id:38, home:'Belgium',            away:'Iran'},
  {id:40, home:'New Zealand',        away:'Egypt'},
  {id:65, home:'Egypt',              away:'Iran'},
  {id:66, home:'New Zealand',        away:'Belgium'},
  // Group H
  {id:13, home:'Spain',              away:'Cape Verde'},
  {id:15, home:'Saudi Arabia',       away:'Uruguay'},
  {id:37, home:'Spain',              away:'Saudi Arabia'},
  {id:39, home:'Uruguay',            away:'Cape Verde'},
  {id:63, home:'Cape Verde',         away:'Saudi Arabia'},
  {id:64, home:'Uruguay',            away:'Spain'},
  // Group I
  {id:17, home:'France',             away:'Senegal'},
  {id:18, home:'Iraq',               away:'Norway'},
  {id:42, home:'France',             away:'Iraq'},
  {id:43, home:'Norway',             away:'Senegal'},
  {id:61, home:'Norway',             away:'France'},
  {id:62, home:'Senegal',            away:'Iraq'},
  // Group J
  {id:19, home:'Argentina',          away:'Algeria'},
  {id:20, home:'Austria',            away:'Jordan'},
  {id:41, home:'Argentina',          away:'Austria'},
  {id:44, home:'Jordan',             away:'Algeria'},
  {id:71, home:'Algeria',            away:'Austria'},
  {id:72, home:'Jordan',             away:'Argentina'},
  // Group K
  {id:21, home:'Portugal',           away:'DR Congo'},
  {id:24, home:'Uzbekistan',         away:'Colombia'},
  {id:45, home:'Portugal',           away:'Uzbekistan'},
  {id:48, home:'Colombia',           away:'DR Congo'},
  {id:69, home:'Colombia',           away:'Portugal'},
  {id:70, home:'DR Congo',           away:'Uzbekistan'},
  // Group L
  {id:22, home:'England',            away:'Croatia'},
  {id:23, home:'Ghana',              away:'Panama'},
  {id:46, home:'England',            away:'Ghana'},
  {id:47, home:'Panama',             away:'Croatia'},
  {id:67, home:'Panama',             away:'England'},
  {id:68, home:'Croatia',            away:'Ghana'},
];

function findOurMatch(apiHome, apiAway) {
  const h = norm(apiHome), a = norm(apiAway);
  return OUR_MATCHES.find(m =>
    (m.home === h && m.away === a) ||
    (m.home === a && m.away === h)
  ) || null;
}

// ── Knockout stage detection by date ─────────────────────────────────────────
// Bucket names: who advanced *past* that round.
// r16  = 16 teams who won the Round of 32  (matches ~Jul 1-4)
// qf   = 8 teams who won the Round of 16   (matches ~Jul 7-10)
// sf   = 4 teams who won the QF            (matches ~Jul 11-12)
// final = 2 finalists                      (matches ~Jul 15-16)
// winner = champion                        (Jul 19)
// bronze = 3rd place                       (Jul 18)
const KNOCKOUT_DATE_RANGES = [
  { stage: 'r16',    from: '2026-07-01', to: '2026-07-04' },
  { stage: 'qf',     from: '2026-07-07', to: '2026-07-10' },
  { stage: 'sf',     from: '2026-07-11', to: '2026-07-12' },
  { stage: 'final',  from: '2026-07-15', to: '2026-07-16' },
  { stage: 'bronze', from: '2026-07-18', to: '2026-07-18' },
  { stage: 'winner', from: '2026-07-19', to: '2026-07-19' },
];

function knockoutStageForDate(dateStr) {
  // dateStr: 'YYYY-MM-DD'
  for (const { stage, from, to } of KNOCKOUT_DATE_RANGES) {
    if (dateStr >= from && dateStr <= to) return stage;
  }
  return null;
}

// ── American odds → implied probability (raw, before normalisation) ───────────
function americanToProb(oddsStr) {
  const n = parseInt(oddsStr);
  if (isNaN(n)) return null;
  return n < 0 ? (-n) / (-n + 100) : 100 / (n + 100);
}

// ── ESPN: all match data in one request ───────────────────────────────────────
async function fetchESPNData(alreadyImported) {
  const result = {
    results: {},
    scores:  {},
    scorers: {},
    cards:   {},
    odds:    {},
    knockoutWinners: { r16: [], qf: [], sf: [], final: [], winner: [], bronze: [] },
    processed: new Set(),
  };

  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
  let sbRes;
  try {
    sbRes = await fetch(`${BASE}/scoreboard?dates=20260611-20260719&limit=500`);
  } catch (e) {
    console.error(`ESPN scoreboard network error: ${e.message}`);
    return result;
  }
  if (!sbRes.ok) { console.warn(`ESPN scoreboard HTTP ${sbRes.status}`); return result; }

  const sbData = await sbRes.json();
  const events = sbData.events || [];
  const finished = events.filter(e => {
    const s = e.competitions?.[0]?.status?.type;
    return s?.completed === true || s?.state === 'post';
  });
  console.log(`ESPN: ${events.length} total events, ${finished.length} finished`);

  // Pre-match odds from ALL events (disappear after kickoff — grab while available)
  for (const event of events) {
    const comp     = event.competitions?.[0];
    const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
    const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');
    if (!homeComp || !awayComp) continue;
    const apiHome = homeComp.team?.displayName || '';
    const apiAway = awayComp.team?.displayName || '';
    const ourMatch = findOurMatch(apiHome, apiAway);
    if (!ourMatch) continue;

    const oddsEntry = comp?.odds?.[0];
    if (!oddsEntry) continue;
    const hOdds = oddsEntry.moneyline?.home?.close?.odds;
    const dOdds = oddsEntry.moneyline?.draw?.close?.odds;
    const aOdds = oddsEntry.moneyline?.away?.close?.odds;
    if (!hOdds || !dOdds || !aOdds) continue;

    const h = americanToProb(hOdds);
    const d = americanToProb(dOdds);
    const a = americanToProb(aOdds);
    if (h === null || d === null || a === null) continue;

    const total = h + d + a;
    result.odds[ourMatch.id] = {
      home: +((h / total).toFixed(3)),
      draw: +((d / total).toFixed(3)),
      away: +((a / total).toFixed(3)),
    };
  }
  console.log(`ESPN: odds captured for ${Object.keys(result.odds).length} matches`);

  // Results, scores, scorers, cards from finished events
  for (const event of finished) {
    const comp     = event.competitions?.[0];
    const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
    const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');
    if (!homeComp || !awayComp) continue;

    const apiHome = homeComp.team?.displayName || '';
    const apiAway = awayComp.team?.displayName || '';

    const homeScore = parseInt(homeComp.score) || 0;
    const awayScore = parseInt(awayComp.score) || 0;

    const ourMatch = findOurMatch(apiHome, apiAway);

    if (ourMatch) {
      // Group stage match — write result + score
      const flipped = norm(apiHome) !== ourMatch.home;
      const ourHome = flipped ? awayScore : homeScore;
      const ourAway = flipped ? homeScore : awayScore;

      result.results[ourMatch.id] = ourHome > ourAway ? 'home' : ourAway > ourHome ? 'away' : 'draw';
      result.scores[ourMatch.id]  = { home: ourHome, away: ourAway };

      // Scorers + cards (skip if already imported)
      if (!alreadyImported[String(ourMatch.id)]) {
        const teamById = {};
        (comp?.competitors || []).forEach(c => {
          if (c.team?.id) teamById[c.team.id] = c.team.displayName || '';
        });

        const details = comp?.details || [];

        const goalDetails = details.filter(d => d.scoringPlay === true && !d.ownGoal);
        result.scorers[ourMatch.id] = goalDetails.map(d => ({
          player: d.athletesInvolved?.[0]?.displayName || 'Unknown',
          team:   norm(teamById[d.team?.id] || ''),
          minute: parseInt(d.clock?.displayValue) || 0,
          type:   d.penaltyKick ? 'PENALTY' : 'REGULAR',
          assist: null,
        }));

        const cardDetails = details.filter(d => d.yellowCard === true || d.redCard === true);
        if (cardDetails.length > 0) {
          result.cards[ourMatch.id] = cardDetails.map(d => ({
            player: d.athletesInvolved?.[0]?.displayName || 'Unknown',
            team:   norm(teamById[d.team?.id] || ''),
            minute: parseInt(d.clock?.displayValue) || 0,
            type:   (d.redCard && d.yellowCard) ? 'Yellow Red Card'
                  : d.redCard                   ? 'Red Card'
                  :                               'Yellow Card',
          }));
        }

        result.processed.add(String(ourMatch.id));
        console.log(`  Group match ${ourMatch.id} (${ourMatch.home} vs ${ourMatch.away}): ` +
          `${ourHome}-${ourAway}, ${goalDetails.length} goals, ${cardDetails.length} cards`);
      } else {
        // Still log the result even for already-imported scorers
        console.log(`  Group match ${ourMatch.id} (${ourMatch.home} vs ${ourMatch.away}): ` +
          `${homeScore}-${awayScore} (scorers already imported)`);
      }

    } else {
      // Knockout match — detect stage by event date, record winner
      const eventDate = event.date ? event.date.slice(0, 10) : '';
      const stage = knockoutStageForDate(eventDate);
      if (!stage) {
        console.log(`  Unknown stage for ${apiHome} vs ${apiAway} on ${eventDate}`);
        continue;
      }
      const winner = homeScore > awayScore ? norm(apiHome)
                   : awayScore > homeScore ? norm(apiAway)
                   : null; // draw shouldn't happen in knockout (extra time/pens determine winner)
      if (winner) {
        result.knockoutWinners[stage].push(winner);
        console.log(`  Knockout [${stage}]: ${winner} (${homeScore}-${awayScore})`);
      }
    }
  }

  console.log(`ESPN: 1 request used (all details inline in scoreboard)`);
  return result;
}

// ── Rank snapshot (for form arrows) ──────────────────────────────────────────
async function snapshotRanks(existingResults) {
  const snap = await db.ref('wc2026/picks').once('value');
  const picksData = snap.val() || {};
  const players = Object.values(picksData).filter(p => p && p.name);

  const BPTS = { r16:1, qf:2, sf:3, final:5, winner:8, bronze:3 };

  const scored = players.map(p => {
    let pts = 0;
    Object.entries(p.picks || {}).forEach(([id, pick]) => {
      if (existingResults[id] === pick) pts++;
    });
    const bracket = p.bracket || {};
    ['r16','qf','sf','final'].forEach(stage => {
      const actual = (existingResults[stage]||'').split(',').map(t=>t.trim()).filter(Boolean);
      if (!actual.length) return;
      (bracket[stage]||[]).forEach(team => {
        if (actual.some(a => a.toLowerCase() === team.toLowerCase())) pts += BPTS[stage];
      });
    });
    if (existingResults.winner && bracket.winner &&
        existingResults.winner.toLowerCase() === (bracket.winner||'').toLowerCase()) pts += BPTS.winner;
    if (existingResults.bronze && bracket.bronze &&
        existingResults.bronze.toLowerCase() === (bracket.bronze||'').toLowerCase()) pts += BPTS.bronze;
    return { name: p.name, pts };
  }).sort((a, b) => b.pts - a.pts);

  return Object.fromEntries(scored.map((p, i) => [p.name, i + 1]));
}


async function run() {
  console.log('=== import-scores diagnostics ===');
  console.log(`  FIREBASE_DATABASE_URL : ${DB_URL ? DB_URL : 'NOT SET ⚠'}`);
  console.log(`  Node version          : ${process.version}`);
  console.log('=================================');

  const isManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  if (!isManual) {
    const now   = new Date();
    const start = new Date('2026-06-11T00:00:00Z');
    const end   = new Date('2026-07-20T00:00:00Z');
    if (now < start || now > end) {
      console.log(`Outside tournament window. Skipping.`);
      process.exit(0);
    }
  }

  // Read existing state from Firebase
  const [existingSnap, eventsImportedSnap] = await Promise.all([
    db.ref('wc2026/results').once('value'),
    db.ref('wc2026/eventsImported').once('value'),
  ]);
  const existingResults = existingSnap.val() || {};
  const alreadyImported = eventsImportedSnap.val() || {};
  const ranksBefore     = await snapshotRanks(existingResults);

  // ── ESPN: all data in one request ──────────────────────────────────────────
  const { results, scores, scorers, cards, odds, knockoutWinners, processed } =
    await fetchESPNData(alreadyImported);

  const updates = {};

  // Group stage results + scores
  for (const [id, result] of Object.entries(results)) {
    updates[`results/${id}`] = result;
  }
  for (const [id, score] of Object.entries(scores)) {
    updates[`scores/${id}`] = score;
  }

  // Total goals
  const totalGoals = Object.values(scores).reduce((sum, s) => sum + (s.home || 0) + (s.away || 0), 0);
  if (totalGoals > 0) updates['results/total_goals'] = String(totalGoals);

  // Knockout progression
  if (knockoutWinners.r16.length)    updates['results/r16']    = knockoutWinners.r16.join(',');
  if (knockoutWinners.qf.length)     updates['results/qf']     = knockoutWinners.qf.join(',');
  if (knockoutWinners.sf.length)     updates['results/sf']     = knockoutWinners.sf.join(',');
  if (knockoutWinners.final.length)  updates['results/final']  = knockoutWinners.final.join(',');
  if (knockoutWinners.winner.length) {
    updates['results/winner']             = knockoutWinners.winner[0];
    updates['results/tournament_winner']  = knockoutWinners.winner[0];
  }
  if (knockoutWinners.bronze.length) updates['results/bronze'] = knockoutWinners.bronze[0];

  // Scorers, cards, odds
  for (const [id, scorerList] of Object.entries(scorers)) {
    updates[`scorers/${id}`] = scorerList;
  }
  for (const [id, cardList] of Object.entries(cards)) {
    updates[`cards/${id}`] = cardList;
  }
  for (const [id, probs] of Object.entries(odds)) {
    updates[`odds/${id}`] = probs;
  }
  for (const id of processed) {
    updates[`eventsImported/${id}`] = true;
  }

  // Golden Boot leader
  const scorerTotals = {};
  Object.values(scorers).forEach(list => {
    list.forEach(s => {
      if (!scorerTotals[s.player]) scorerTotals[s.player] = { player: s.player, team: s.team, goals: 0 };
      scorerTotals[s.player].goals++;
    });
  });
  const topScorer = Object.values(scorerTotals).sort((a, b) => b.goals - a.goals)[0];
  if (topScorer) updates['results/golden_boot_leader'] = topScorer.player;

  const count = Object.keys(updates).length;
  if (count === 0) {
    console.log('No updates to write.');
    process.exit(0);
  }

  updates['config/prevRanks'] = ranksBefore;

  console.log(`Writing ${count} updates to Firebase...`);
  await db.ref('wc2026').update(updates);
  console.log('Done ✓');

  console.log(`  Group stage results written: ${Object.keys(results).length}`);
  console.log(`  Total goals: ${totalGoals}`);
  console.log(`  ESPN matches processed for scorers: ${processed.size}`);
  console.log(`  Matches with scorer data: ${Object.keys(scorers).length}`);
  console.log(`  Matches with card data: ${Object.keys(cards).length}`);
  console.log(`  Matches with odds data: ${Object.keys(odds).length}`);
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
