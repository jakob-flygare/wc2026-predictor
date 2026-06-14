// import-scores.js
// Fetches WC2026 results from football-data.org (results/scores/knockout)
// and from api-football (goalscorers + cards), then writes to Firebase.
// Runs as a GitHub Action every 30 minutes.

const admin = require('firebase-admin');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const DB_URL  = process.env.FIREBASE_DATABASE_URL;
const SA      = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({ credential: admin.credential.cert(SA), databaseURL: DB_URL });
const db = admin.database();

// ── Team name normalisation ───────────────────────────────────────────────────
// Covers both football-data.org and api-football naming variations
const TEAM_MAP = {
  // football-data.org
  'United States':                  'USA',
  'Korea Republic':                 'South Korea',
  'Czech Republic':                 'Czechia',
  'Turkey':                         'Türkiye',
  'Bosnia and Herzegovina':         'Bosnia-Herzegovina',
  'Democratic Republic of Congo':   'DR Congo',
  'Congo DR':                       'DR Congo',
  'Côte d\'Ivoire':                 'Ivory Coast',
  "Cote d'Ivoire":                  'Ivory Coast',
  'Curacao':                        'Curaçao',
  // api-football variations
  'Bosnia Herzegovina':             'Bosnia-Herzegovina',
  'DR Congo':                       'DR Congo',
  'Ivory Coast':                    'Ivory Coast',
  'South Korea':                    'South Korea',
  'Czechia':                        'Czechia',
  'Curaçao':                        'Curaçao',
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

// Map API winner field → our "home"/"draw"/"away" (relative to OUR match home team)
function mapResult(winner, ourMatch, apiHome) {
  if (!winner || winner === 'DRAW') return 'draw';
  const apiWinner = winner === 'HOME_TEAM' ? norm(apiHome) : null;
  const homeWon   = apiWinner !== null
    ? apiWinner === ourMatch.home
    : winner === 'AWAY_TEAM' ? false : null;
  if (homeWon === null) return 'draw';
  return homeWon ? 'home' : 'away';
}

// football-data.org stage → our knockout stage bucket
const STAGE_MAP = {
  'LAST_32':        'r16',
  'ROUND_OF_32':    'r16',
  'LAST_16':        'qf',
  'ROUND_OF_16':    'qf',
  'QUARTER_FINALS': 'sf',
  'SEMI_FINALS':    'final',
  'FINAL':          'winner',
  'THIRD_PLACE':    'bronze',
};

// ── ESPN unofficial API: goalscorers + cards ─────────────────────────────────
// No API key. Goal/card details are inline in scoreboard competitions[0].details
// so everything comes from a single request — no per-match summary calls needed.
async function fetchESPNEvents(alreadyImported) {
  const result = { scorers: {}, cards: {}, processed: new Set() };
  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

  // 1 request: all WC2026 events with inline goal + card details
  let sbRes;
  try {
    sbRes = await fetch(`${BASE}/scoreboard?dates=20260611-20260719&limit=500`);
  } catch (e) {
    console.error(`ESPN scoreboard network error: ${e.message}`);
    return result;
  }
  if (!sbRes.ok) { console.warn(`ESPN scoreboard HTTP ${sbRes.status}`); return result; }

  const sbData   = await sbRes.json();
  const events   = sbData.events || [];
  const finished = events.filter(e => {
    const s = e.competitions?.[0]?.status?.type;
    return s?.completed === true || s?.state === 'post';
  });
  console.log(`ESPN: ${events.length} total events, ${finished.length} finished`);

  for (const event of finished) {
    const comp     = event.competitions?.[0];
    const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
    const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');
    const apiHome  = homeComp?.team?.displayName || '';
    const apiAway  = awayComp?.team?.displayName || '';

    const ourMatch = findOurMatch(apiHome, apiAway);
    if (!ourMatch) continue;
    if (alreadyImported[String(ourMatch.id)]) continue;

    // Map ESPN team id → display name for this match
    const teamById = {};
    (comp?.competitors || []).forEach(c => {
      if (c.team?.id) teamById[c.team.id] = c.team.displayName || '';
    });

    const details = comp?.details || [];

    // Goals: scoringPlay===true, skip own goals (ownGoal flag)
    const goalDetails = details.filter(d => d.scoringPlay === true && !d.ownGoal);
    result.scorers[ourMatch.id] = goalDetails.map(d => ({
      player: d.athletesInvolved?.[0]?.displayName || 'Unknown',
      team:   norm(teamById[d.team?.id] || ''),
      minute: parseInt(d.clock?.displayValue) || 0,
      type:   d.penaltyKick ? 'PENALTY' : 'REGULAR',
      assist: null,
    }));

    // Cards: yellowCard and/or redCard flags
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
    console.log(`  Match ${ourMatch.id} (${ourMatch.home} vs ${ourMatch.away}): ` +
      `${goalDetails.length} goals, ${cardDetails.length} cards`);
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
  // ── Env diagnostics (safe — never prints full key) ──────────────────────
  console.log('=== import-scores diagnostics ===');
  console.log(`  FOOTBALL_DATA_API_KEY : ${API_KEY ? `set (${API_KEY.length} chars)` : 'NOT SET ⚠'}`);
  console.log(`  FIREBASE_DATABASE_URL : ${DB_URL  ? DB_URL : 'NOT SET ⚠'}`);
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

  // ── football-data.org: results, scores, knockout progression ─────────────
  console.log('Fetching WC2026 matches from football-data.org...');
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches?season=2026', {
    headers: { 'X-Auth-Token': API_KEY },
  });

  const requestsAvailable = parseInt(res.headers.get('X-RequestsAvailable') ?? '99');
  const resetInSeconds    = res.headers.get('X-RequestCounter-Reset') ?? '?';
  const apiVersion        = res.headers.get('X-API-Version') ?? '?';
  console.log(`football-data.org v${apiVersion} — ${requestsAvailable} requests remaining (resets in ${resetInSeconds}s)`);

  if (!res.ok) {
    if (res.status === 429) {
      console.error(`Rate limited. Resets in ${resetInSeconds}s. Skipping this run.`);
      process.exit(0);
    }
    const body = await res.text();
    throw new Error(`football-data.org error ${res.status}: ${body}`);
  }
  if (requestsAvailable < 3) {
    console.warn(`⚠ Only ${requestsAvailable} football-data.org requests remaining!`);
  }

  const fdData = await res.json();
  const matches = fdData.matches || [];
  console.log(`Got ${matches.length} matches from football-data.org`);

  // Read existing results + already-imported event tracker from Firebase
  const [existingSnap, eventsImportedSnap] = await Promise.all([
    db.ref('wc2026/results').once('value'),
    db.ref('wc2026/eventsImported').once('value'),
  ]);
  const existingResults = existingSnap.val() || {};
  const alreadyImported = eventsImportedSnap.val() || {};
  const ranksBefore     = await snapshotRanks(existingResults);

  const updates = {};
  const knockoutBuckets = { r16:[], qf:[], sf:[], final:[], winner:[], bronze:[] };
  let totalGoals = 0;

  for (const m of matches) {
    if (m.status !== 'FINISHED') continue;

    const apiHome = m.homeTeam?.name || '';
    const apiAway = m.awayTeam?.name || '';
    const score   = m.score?.fullTime || {};
    const winner  = m.score?.winner;

    if (score.home != null) totalGoals += (score.home || 0) + (score.away || 0);

    if (m.stage === 'GROUP_STAGE') {
      const ourMatch = findOurMatch(apiHome, apiAway);
      if (!ourMatch) {
        console.warn(`  No match found for: ${apiHome} vs ${apiAway}`);
        continue;
      }

      updates[`results/${ourMatch.id}`] = mapResult(winner, ourMatch, apiHome);

      const flipped = norm(apiHome) !== ourMatch.home;
      updates[`scores/${ourMatch.id}`] = flipped
        ? { home: score.away, away: score.home }
        : { home: score.home, away: score.away };

    } else {
      const bucket = STAGE_MAP[m.stage];
      if (!bucket) {
        console.warn(`  Unknown stage: "${m.stage}" — add to STAGE_MAP if needed`);
        continue;
      }
      if (bucket === 'winner') {
        const champ = winner === 'HOME_TEAM' ? norm(apiHome) : norm(apiAway);
        knockoutBuckets.winner.push(champ);
        updates['results/winner'] = champ;
      } else if (bucket === 'bronze') {
        updates['results/bronze'] = winner === 'HOME_TEAM' ? norm(apiHome) : norm(apiAway);
      } else {
        knockoutBuckets[bucket].push(winner === 'HOME_TEAM' ? norm(apiHome) : norm(apiAway));
      }
    }
  }

  if (knockoutBuckets.r16.length)   updates['results/r16']   = knockoutBuckets.r16.join(',');
  if (knockoutBuckets.qf.length)    updates['results/qf']    = knockoutBuckets.qf.join(',');
  if (knockoutBuckets.sf.length)    updates['results/sf']    = knockoutBuckets.sf.join(',');
  if (knockoutBuckets.final.length) updates['results/final'] = knockoutBuckets.final.join(',');
  if (totalGoals > 0)               updates['results/total_goals'] = String(totalGoals);
  if (updates['results/winner'])    updates['results/tournament_winner'] = updates['results/winner'];

  // ── ESPN: goalscorers + cards ─────────────────────────────────────────────
  const { scorers, cards, processed } = await fetchESPNEvents(alreadyImported);

  for (const [id, scorerList] of Object.entries(scorers)) {
    updates[`scorers/${id}`] = scorerList;
  }
  for (const [id, cardList] of Object.entries(cards)) {
    updates[`cards/${id}`] = cardList;
  }
  // Mark every match we fetched a summary for as imported (even 0-goal matches)
  // so we don't re-spend a request on them next run.
  for (const id of processed) {
    updates[`eventsImported/${id}`] = true;
  }

  // Golden Boot leader — tally goals across all imported matches
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

  const finished = matches.filter(m => m.status === 'FINISHED').length;
  console.log(`  football-data.org finished matches: ${finished}`);
  console.log(`  Total goals: ${totalGoals}`);
  console.log(`  ESPN matches processed: ${processed.size}`);
  console.log(`  Matches with scorer data: ${Object.keys(scorers).length}`);
  console.log(`  Matches with card data: ${Object.keys(cards).length}`);
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
