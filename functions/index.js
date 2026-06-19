// Firebase Cloud Functions — 1-minute live score updater.
//
// Scheduled every minute (Cloud Scheduler). importLiveScores() is "live only":
// it does one lightweight ESPN scoreboard read and returns immediately whenever
// nothing is live and nothing has just finished, so idle minutes are ~free.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { importLiveScores } = require('./importCore');

const DATABASE_URL =
  'https://wc2026-predictor-924a4-default-rtdb.europe-west1.firebasedatabase.app';

admin.initializeApp({ databaseURL: DATABASE_URL });
setGlobalOptions({ region: 'europe-west1', maxInstances: 1 });

const db = admin.database();

exports.liveScores = onSchedule(
  {
    schedule: '* * * * *', // every minute
    timeZone: 'UTC',
    timeoutSeconds: 60,
    memory: '256MiB',
    retryCount: 0, // a missed minute is fixed by the next run — no point retrying
  },
  async () => {
    const t0 = Date.now();
    try {
      const result = await importLiveScores(db);
      console.log(`liveScores ${JSON.stringify(result)} (${Date.now() - t0}ms)`);
    } catch (err) {
      console.error('liveScores failed:', err && (err.stack || err.message || err));
    }
  }
);
