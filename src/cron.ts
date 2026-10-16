// Daily housekeeping (ARCHITECTURE section 10, C3, C4, C8). Wired to the cron trigger in src/index.ts.
import type { CardRow, Env } from './types.js';
import {
  compactOldMetrics, deleteCard, expireCard, getIntSetting, listExpiredCandidates, listTestCardsOlderThan, purgeRawBodies,
} from './db/cards.js';
import { addDays, nowIso } from './util/time.js';

export interface HousekeepingSummary {
  rawBodiesPurged: number;
  testCardsDeleted: number;
  cardsExpired: number;
  metricRowsCompacted: number;
}

const BATCH = 200;
const MAX_LOOPS = 10;

/** Run `fn` over successive batches of `list()` until a short or empty batch, at most MAX_LOOPS times. Returns successes. */
async function drain(list: () => Promise<CardRow[]>, fn: (card: CardRow) => Promise<void>, label: string): Promise<number> {
  let done = 0;
  for (let i = 0; i < MAX_LOOPS; i++) {
    const rows = await list();
    if (rows.length === 0) break;
    let failures = 0;
    for (const card of rows) {
      try {
        await fn(card);
        done++;
      } catch (err) {
        failures++;
        console.error(`housekeeping: ${label} failed`, { card_id: card.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
    // Every row failed: the same rows would come back next loop, so stop rather than spin.
    if (rows.length < BATCH || failures === rows.length) break;
  }
  return done;
}

export async function runHousekeeping(env: Env, now: Date = new Date()): Promise<HousekeepingSummary> {
  const nowStr = nowIso(now);
  const summary: HousekeepingSummary = { rawBodiesPurged: 0, testCardsDeleted: 0, cardsExpired: 0, metricRowsCompacted: 0 };

  // 1. Raw request bodies kept on the test route (C4).
  summary.rawBodiesPurged = await purgeRawBodies(env.DB, nowStr);

  // 2. Test cards older than the test retention period (C3).
  const testDays = await getIntSetting(env.DB, 'test_retention_days', 30);
  const testCutoff = addDays(nowStr, -testDays);
  summary.testCardsDeleted = await drain(
    () => listTestCardsOlderThan(env.DB, testCutoff, BATCH),
    async (card) => {
      await deleteCard(env.DB, card.id);
    },
    'test card delete',
  );

  // 3. Live cards past expires_at: the founder's name is cleared, the row stays so the page can say "expired" (C8).
  summary.cardsExpired = await drain(
    () => listExpiredCandidates(env.DB, nowStr, BATCH),
    async (card) => {
      await expireCard(env.DB, card.id);
    },
    'expire',
  );

  // 4. Daily metric rows older than 13 months fold into monthly rows.
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(1);
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 13);
  summary.metricRowsCompacted = await compactOldMetrics(env.DB, cutoff.toISOString().slice(0, 10));

  console.log(JSON.stringify({ housekeeping: summary }));
  return summary;
}
