// Daily housekeeping (ARCHITECTURE section 10). Wired to the scheduler in src/server.ts.
// Since 19 October 2026 nothing is deleted: test cards, stored request bodies, founder names and daily metrics all
// stay. The run only marks cards expired once their licence has, and drops sign-in sessions that have ended.
import type { CardRow, Env } from './types.js';
import { expireCard, listExpiredCandidates } from './db/cards.js';
import { nowIso } from './util/time.js';
import { purgeExpiredAdminSessions } from './db/admin.js';

export interface HousekeepingSummary {
  cardsExpired: number;
  adminSessionsPurged: number;
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
  const summary: HousekeepingSummary = { cardsExpired: 0, adminSessionsPurged: 0 };

  // 1. Cards whose licence has expired are marked expired. Nothing on them is cleared; the page says the licence
  //    has expired (it already does from the moment the date passes; this keeps the status in the admin current).
  summary.cardsExpired = await drain(
    () => listExpiredCandidates(env.DB, nowStr, BATCH),
    async (card) => {
      await expireCard(env.DB, card.id);
    },
    'expire',
  );

  // 2. Admin sign-in sessions that have ended (src/admin/auth.ts); they are refused anyway, and hold no data.
  summary.adminSessionsPurged = await purgeExpiredAdminSessions(env.DB, nowStr);

  console.log(JSON.stringify({ housekeeping: summary }));
  return summary;
}
