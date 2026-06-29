// importCore.js — shared WC2026 importer logic.
//
// Fetches results, scores, scorers, cards and odds from the ESPN unofficial API
// AND captures live (in-progress) scores, then writes to Firebase Realtime DB.
//
// Exposed as importLiveScores(db): the 1-minute Cloud Function calls this. It is
// "live only" by design — it does a single lightweight scoreboard read every run
// and returns immediately (no standings fetch, no DB write) whenever nothing is
// live and nothing has just finished. The GitHub Action keeps running the older
// scripts/import-scores.js every 5 min as a backup for standings/odds/finals.

// ── Team name normalisation ───────────────────────────────────────────────────
const TEAM_MAP = {
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

const MATCH_BY_ID = Object.fromEntries(OUR_MATCHES.map(m => [String(m.id), m]));

// ── Knockout stage detection by date ─────────────────────────────────────────
const KNOCKOUT_DATE_RANGES = [
  { stage: 'r16',    from: '2026-06-28', to: '2026-07-04' },
  { stage: 'qf',     from: '2026-07-04', to: '2026-07-07' },
  { stage: 'sf',     from: '2026-07-09', to: '2026-07-12' },
  { stage: 'final',  from: '2026-07-14', to: '2026-07-15' },
  { stage: 'bronze', from: '2026-07-18', to: '2026-07-18' },
  { stage: 'winner', from: '2026-07-19', to: '2026-07-19' },
];

function knockoutStageForDate(dateStr) {
  for (const { stage, from, to } of KNOCKOUT_DATE_RANGES) {
    if (dateStr >= from && dateStr <= to) return stage;
  }
  return null;
}

function americanToProb(oddsStr) {
  const n = parseInt(oddsStr);
  if (isNaN(n)) return null;
  return n < 0 ? (-n) / (-n + 100) : 100 / (n + 100);
}

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

// ── Score helper: orient ESPN home/away to our match's home/away ──────────────
function orientScore(ourMatch, apiHome, homeScore, awayScore) {
  const flipped = norm(apiHome) !== ourMatch.home;
  return {
    home: flipped ? awayScore : homeScore,
    away: flipped ? homeScore : awayScore,
  };
}

// ── Parse the scoreboard payload ──────────────────────────────────────────────
// Returns everything we might write plus counters used for the live-only gate.
function parseScoreboard(sbData, alreadyImported, existingResults) {
  const out = {
    results: {}, scores: {}, liveScores: {}, scorers: {}, cards: {}, odds: {},
    knockoutWinners: { r16: [], qf: [], sf: [], final: [], winner: [], bronze: [] },
    processed: new Set(),
    liveCount: 0,
    newlyFinishedCount: 0,
  };

  const events = sbData.events || [];

  // Pre-match odds from ALL events (they disappear after kickoff).
  for (const event of events) {
    const comp     = event.competitions?.[0];
    const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
    const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');
    if (!homeComp || !awayComp) continue;
    const ourMatch = findOurMatch(homeComp.team?.displayName || '', awayComp.team?.displayName || '');
    if (!ourMatch) continue;

    const oddsEntry = comp?.odds?.[0];
    if (!oddsEntry) continue;
    const hOdds = oddsEntry.moneyline?.home?.close?.odds;
    const dOdds = oddsEntry.moneyline?.draw?.close?.odds;
    const aOdds = oddsEntry.moneyline?.away?.close?.odds;
    if (!hOdds || !dOdds || !aOdds) continue;
    const h = americanToProb(hOdds), d = americanToProb(dOdds), a = americanToProb(aOdds);
    if (h === null || d === null || a === null) continue;
    const total = h + d + a;
    out.odds[ourMatch.id] = {
      home: +((h / total).toFixed(3)),
      draw: +((d / total).toFixed(3)),
      away: +((a / total).toFixed(3)),
    };
  }

  for (const event of events) {
    const comp     = event.competitions?.[0];
    const status   = comp?.status?.type;
    const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
    const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');
    if (!comp || !homeComp || !awayComp) continue;

    const apiHome   = homeComp.team?.displayName || '';
    const apiAway   = awayComp.team?.displayName || '';
    const homeScore = parseInt(homeComp.score) || 0;
    const awayScore = parseInt(awayComp.score) || 0;
    const isFinished = status?.completed === true || status?.state === 'post';
    const isLive     = status?.state === 'in';
    const ourMatch   = findOurMatch(apiHome, apiAway);

    // ── LIVE (in-progress) group match → update the current score only ──
    if (isLive && ourMatch) {
      out.liveScores[ourMatch.id] = orientScore(ourMatch, apiHome, homeScore, awayScore);
      out.liveCount++;
      continue;
    }

    if (!isFinished) continue;

    if (ourMatch) {
      const oriented = orientScore(ourMatch, apiHome, homeScore, awayScore);
      out.results[ourMatch.id] = oriented.home > oriented.away ? 'home'
                               : oriented.away > oriented.home ? 'away' : 'draw';
      out.scores[ourMatch.id]  = oriented;

      // A match counts as "newly finished" (work to do) until its result is stored.
      if (existingResults[String(ourMatch.id)] === undefined) out.newlyFinishedCount++;

      // Scorers + cards — import once, then lock.
      if (!alreadyImported[String(ourMatch.id)]) {
        const teamById = {};
        (comp.competitors || []).forEach(c => {
          if (c.team?.id) teamById[c.team.id] = c.team.displayName || '';
        });
        const details = comp.details || [];

        const goalDetails = details.filter(d => d.scoringPlay === true && !d.ownGoal);
        out.scorers[ourMatch.id] = goalDetails.map(d => ({
          player: d.athletesInvolved?.[0]?.displayName || 'Unknown',
          team:   norm(teamById[d.team?.id] || ''),
          minute: parseInt(d.clock?.displayValue) || 0,
          type:   d.penaltyKick ? 'PENALTY' : 'REGULAR',
          assist: null,
        }));

        const cardDetails = details.filter(d => d.yellowCard === true || d.redCard === true);
        if (cardDetails.length > 0) {
          out.cards[ourMatch.id] = cardDetails.map(d => ({
            player: d.athletesInvolved?.[0]?.displayName || 'Unknown',
            team:   norm(teamById[d.team?.id] || ''),
            minute: parseInt(d.clock?.displayValue) || 0,
            type:   (d.redCard && d.yellowCard) ? 'Yellow Red Card'
                  : d.redCard                   ? 'Red Card'
                  :                               'Yellow Card',
          }));
        }
        out.processed.add(String(ourMatch.id));
      }
    } else {
      // Knockout match — detect stage by date, record winner.
      const eventDate = event.date ? event.date.slice(0, 10) : '';
      const stage = knockoutStageForDate(eventDate);
      if (!stage) continue;
      const winner = homeScore > awayScore ? norm(apiHome)
                   : awayScore > homeScore ? norm(apiAway) : null;
      if (winner && !out.knockoutWinners[stage].includes(winner)) {
        out.knockoutWinners[stage].push(winner);
      }
    }
  }

  return out;
}

// ── Official group standings (only fetched when there is work to write) ───────
async function fetchStandings() {
  const standings = {};
  try {
    const stRes = await fetch(
      'https://site.web.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026'
    );
    if (!stRes.ok) return standings;
    const stData = await stRes.json();
    for (const group of (stData.children || [])) {
      const letter = (group.abbreviation || group.name || '').replace('Group ', '').trim();
      if (!letter) continue;
      const entries = group.standings?.entries || [];
      standings[letter] = entries.map(entry => {
        const stat = n => entry.stats?.find(s => s.name === n)?.value ?? 0;
        return {
          team: norm(entry.team?.displayName || ''),
          rank: stat('rank'), pts: stat('points'), pld: stat('gamesPlayed'),
          w: stat('wins'), d: stat('ties'), l: stat('losses'),
          gf: stat('pointsFor'), ga: stat('pointsAgainst'), gd: stat('pointDifferential'),
          note: entry.note?.description || '',
        };
      }).sort((a, b) => a.rank - b.rank);
    }
  } catch (e) {
    console.warn(`standings fetch error: ${e.message}`);
  }
  return standings;
}

// ── YouTube highlights (server-side; key kept in a Functions secret) ──────────
// Searches for a ~medium-length highlight clip for one match. Returns null when
// no key is set or nothing is found, so it never blocks the score import.
async function fetchHighlight(home, away) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const q = encodeURIComponent(`${home} vs ${away} 2026 World Cup highlights`);
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&maxResults=1&videoDuration=medium&order=relevance&q=${q}&key=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.warn(`YouTube HTTP ${res.status}`); return null; }
    const data = await res.json();
    const item = (data.items || [])[0];
    if (!item || !item.id || !item.id.videoId) return null;
    const sn = item.snippet || {};
    return {
      videoId: item.id.videoId,
      title:   sn.title || '',
      channel: sn.channelTitle || '',
      thumb:   sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || '',
    };
  } catch (e) {
    console.warn(`YouTube fetch error: ${e.message}`);
    return null;
  }
}

// ── Rank snapshot (for the leaderboard form arrows) ───────────────────────────
async function snapshotRanks(db, existingResults) {
  const snap = await db.ref('wc2026/picks').once('value');
  const players = Object.values(snap.val() || {}).filter(p => p && p.name);
  const BPTS = { r16:1, qf:2, sf:3, final:5, winner:8, bronze:3 };
  const scored = players.map(p => {
    let pts = 0;
    Object.entries(p.picks || {}).forEach(([id, pick]) => { if (existingResults[id] === pick) pts++; });
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

// ── Main entry point ──────────────────────────────────────────────────────────
async function importLiveScores(db) {
  // Tournament window — cheap, no network.
  const now   = new Date();
  if (now < new Date('2026-06-11T00:00:00Z') || now > new Date('2026-07-20T00:00:00Z')) {
    return { skipped: 'outside-window' };
  }

  // One lightweight scoreboard read — this is the live-only gate's source of truth.
  let sbData;
  try {
    const res = await fetch(`${ESPN_BASE}/scoreboard?dates=20260611-20260719&limit=500`);
    if (!res.ok) return { skipped: `scoreboard-http-${res.status}` };
    sbData = await res.json();
  } catch (e) {
    return { skipped: `scoreboard-error:${e.message}` };
  }

  const [eventsImportedSnap, existingSnap, highlightsSnap] = await Promise.all([
    db.ref('wc2026/eventsImported').once('value'),
    db.ref('wc2026/results').once('value'),
    db.ref('wc2026/highlights').once('value'),
  ]);
  const alreadyImported   = eventsImportedSnap.val() || {};
  const existingResults   = existingSnap.val() || {};
  const existingHighlights = highlightsSnap.val() || {};

  const p = parseScoreboard(sbData, alreadyImported, existingResults);

  // LIVE-ONLY GATE: nothing live and nothing newly finished → no write, no standings.
  if (p.liveCount === 0 && p.newlyFinishedCount === 0) {
    return { skipped: 'idle', live: 0 };
  }

  const updates = {};

  // Live in-progress scores (no result yet, no scorer/card lock).
  for (const [id, score] of Object.entries(p.liveScores)) updates[`scores/${id}`] = score;

  // Finished group results + scores.
  for (const [id, r] of Object.entries(p.results)) updates[`results/${id}`] = r;
  for (const [id, s] of Object.entries(p.scores))  updates[`scores/${id}`]  = s;

  // Total goals (live + finished scores we know about).
  const allScores = { ...p.liveScores, ...p.scores };
  const totalGoals = Object.values(allScores).reduce((sum, s) => sum + (s.home || 0) + (s.away || 0), 0);
  if (totalGoals > 0) updates['results/total_goals'] = String(totalGoals);

  // Knockout progression.
  if (p.knockoutWinners.r16.length)    updates['results/r16']    = p.knockoutWinners.r16.join(',');
  if (p.knockoutWinners.qf.length)     updates['results/qf']     = p.knockoutWinners.qf.join(',');
  if (p.knockoutWinners.sf.length)     updates['results/sf']     = p.knockoutWinners.sf.join(',');
  if (p.knockoutWinners.final.length)  updates['results/final']  = p.knockoutWinners.final.join(',');
  if (p.knockoutWinners.winner.length) {
    updates['results/winner']            = p.knockoutWinners.winner[0];
    updates['results/tournament_winner'] = p.knockoutWinners.winner[0];
  }
  if (p.knockoutWinners.bronze.length) updates['results/bronze'] = p.knockoutWinners.bronze[0];

  // Scorers, cards, odds.
  for (const [id, list]  of Object.entries(p.scorers)) updates[`scorers/${id}`] = list;
  for (const [id, list]  of Object.entries(p.cards))   updates[`cards/${id}`]   = list;
  for (const [id, probs] of Object.entries(p.odds))    updates[`odds/${id}`]    = probs;
  for (const id of p.processed) updates[`eventsImported/${id}`] = true;

  // Golden Boot leader.
  const totals = {};
  Object.values(p.scorers).forEach(list => list.forEach(s => {
    if (!totals[s.player]) totals[s.player] = { goals: 0 };
    totals[s.player].goals++;
  }));
  const top = Object.entries(totals).sort((a, b) => b[1].goals - a[1].goals)[0];
  if (top) updates['results/golden_boot_leader'] = top[0];

  // Standings + rank snapshot only when a match just finished (they don't change
  // mid-match), so live-only minutes stay cheap.
  if (p.newlyFinishedCount > 0) {
    const [standings, ranksBefore] = await Promise.all([
      fetchStandings(),
      snapshotRanks(db, existingResults),
    ]);
    for (const [group, rows] of Object.entries(standings)) updates[`standings/${group}`] = rows;
    updates['config/prevRanks'] = ranksBefore;
  }

  // YouTube highlights — fetch once per finished match that doesn't have one yet.
  // Capped per run to bound API quota; backfills steadily as matches finish / during live windows.
  let highlightsFetched = 0;
  if (process.env.YOUTUBE_API_KEY && (p.newlyFinishedCount > 0 || p.liveCount > 0)) {
    const missing = Object.keys(p.results)
      .filter(id => !existingHighlights[id] && MATCH_BY_ID[id])
      .slice(0, 6);
    for (const id of missing) {
      const hl = await fetchHighlight(MATCH_BY_ID[id].home, MATCH_BY_ID[id].away);
      if (hl) { updates[`highlights/${id}`] = hl; highlightsFetched++; }
    }
  }

  await db.ref('wc2026').update(updates);
  return { wrote: Object.keys(updates).length, live: p.liveCount, finished: p.newlyFinishedCount, highlights: highlightsFetched };
}

module.exports = { importLiveScores, parseScoreboard, findOurMatch, ESPN_BASE };
