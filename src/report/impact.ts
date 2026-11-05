// The monthly impact report (SPC, 5 November 2026): what the licence cards did in a month, for SPC's management.
// Admin → Report shows any month; on the 1st to 3rd of each month the daily run emails the month before to the
// addresses in Admin → Settings (report_to), and Send in the admin sends the month shown (./send.ts). Test cards are
// left out everywhere: their counters are never kept, and their cards, emails and posts are filtered here. Months
// are Dubai months. Only what the service measures is reported: no estimates (LinkedIn does not share reach).
import type { D1Database } from '../types.js';
import { linkedinPostsBetween } from '../db/linkedin.js';
import type { PostWithCard } from '../db/linkedin.js';

export interface MonthStats {
  month: string;
  /** Licence cards created for real customers. */
  newCards: number;
  welcomeSent: number;
  /** Customers who opened their card page (each card once). */
  openedCards: number;
  views: number;
  viewsFromEmail: number;
  /** Customers who downloaded, shared or posted their card (each card once). */
  sharedCards: number;
  downloads: number;
  /** The phone's share sheet (posts made with Post to LinkedIn are counted in `posts`). */
  shares: number;
  posts: number;
  liStarted: number;
  liSignedIn: number;
  liCancelled: number;
  liFailed: number;
  reviewAsks: number;
  reviewClicks: number;
}

export interface ImpactReport {
  month: string;
  /** "October 2026". */
  label: string;
  current: MonthStats;
  previous: MonthStats;
  previousLabel: string;
  posts: PostWithCard[];
  sinceLaunch: { cards: number; sharedCards: number; posts: number };
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(v: unknown): v is string {
  return typeof v === 'string' && MONTH_RE.test(v);
}

/** The month before `month` (YYYY-MM). */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The Dubai month `now` falls in (YYYY-MM). */
export function dubaiMonth(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
}

/** "October 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** The month as UTC instants [from, to): Dubai is UTC+4 all year. */
export function monthRange(month: string): { from: string; to: string; firstDay: string; lastDay: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1, -4)).toISOString();
  const to = new Date(Date.UTC(y, m, 1, -4)).toISOString();
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to, firstDay: `${month}-01`, lastDay: `${month}-${String(lastDay).padStart(2, '0')}` };
}

async function count(db: D1Database, sql: string, ...args: unknown[]): Promise<number> {
  const r = await db.prepare(sql).bind(...args).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

// Daily rows (YYYY-MM-DD) in the month, and the monthly row (YYYY-MM) older days may have been folded into.
const IN_MONTH = '((day >= ?1 AND day <= ?2) OR day = ?3)';

export async function monthStats(db: D1Database, month: string): Promise<MonthStats> {
  const { from, to, firstDay, lastDay } = monthRange(month);
  const rows = (await db.prepare(`SELECT kind, network, SUM(count) AS n FROM metrics WHERE ${IN_MONTH} GROUP BY kind, network`)
    .bind(firstDay, lastDay, month).all<{ kind: string; network: string; n: number }>()).results ?? [];
  const sum = (kind: string, network?: (n: string) => boolean): number =>
    rows.filter((r) => r.kind === kind && (!network || network(r.network))).reduce((a, r) => a + Number(r.n), 0);
  const [newCards, welcomeSent, openedCards, sharedCards, posts] = await Promise.all([
    count(db, 'SELECT COUNT(*) AS n FROM cards WHERE is_test = 0 AND created_at >= ?1 AND created_at < ?2', from, to),
    count(db, `SELECT COUNT(*) AS n FROM emails e JOIN cards c ON c.id = e.card_id
      WHERE c.is_test = 0 AND e.kind = 'welcome' AND e.status = 'sent' AND e.sent_at >= ?1 AND e.sent_at < ?2`, from, to),
    count(db, `SELECT COUNT(DISTINCT card_id) AS n FROM metrics WHERE ${IN_MONTH} AND kind = 'view'`, firstDay, lastDay, month),
    count(db, `SELECT COUNT(DISTINCT card_id) AS n FROM metrics WHERE ${IN_MONTH} AND kind IN ('download', 'share', 'li_post')`, firstDay, lastDay, month),
    count(db, `SELECT COUNT(*) AS n FROM linkedin_posts p JOIN cards c ON c.id = p.card_id
      WHERE c.is_test = 0 AND p.status = 'posted' AND p.created_at >= ?1 AND p.created_at < ?2`, from, to),
  ]);
  return {
    month,
    newCards,
    welcomeSent,
    openedCards,
    views: sum('view'),
    viewsFromEmail: sum('view', (n) => n === 'email'),
    sharedCards,
    downloads: sum('download'),
    shares: sum('share', (n) => n !== 'linkedin'),
    posts,
    liStarted: sum('li_start'),
    liSignedIn: sum('li_signin'),
    liCancelled: sum('li_cancel'),
    liFailed: sum('li_fail'),
    reviewAsks: sum('review_ask'),
    reviewClicks: sum('review_click'),
  };
}

export async function buildReport(db: D1Database, month: string): Promise<ImpactReport> {
  const prev = previousMonth(month);
  const { from, to } = monthRange(month);
  const [current, previous, posts, cards, sharedCards, allPosts] = await Promise.all([
    monthStats(db, month),
    monthStats(db, prev),
    linkedinPostsBetween(db, from, to),
    count(db, 'SELECT COUNT(*) AS n FROM cards WHERE is_test = 0'),
    count(db, "SELECT COUNT(DISTINCT card_id) AS n FROM metrics WHERE kind IN ('download', 'share', 'li_post')"),
    count(db, "SELECT COUNT(*) AS n FROM linkedin_posts p JOIN cards c ON c.id = p.card_id WHERE c.is_test = 0 AND p.status = 'posted'"),
  ]);
  return { month, label: monthLabel(month), current, previous, previousLabel: monthLabel(prev), posts, sinceLaunch: { cards, sharedCards, posts: allPosts } };
}

/** The headline figures, in the order the page and the email show them. */
export const HEADLINES: ReadonlyArray<[keyof MonthStats, string, string]> = [
  ['newCards', 'New licence cards', 'Cards created for newly licensed companies'],
  ['welcomeSent', 'Welcome emails sent', 'The email with the link to their card'],
  ['openedCards', 'Customers who opened their card', 'Each card counted once'],
  ['sharedCards', 'Customers who shared their card', 'Downloaded it, shared it or posted it'],
  ['posts', 'Posts on LinkedIn', 'Made with Post to LinkedIn, each mentioning SPC'],
  ['reviewClicks', 'Google review clicks', 'Pressed "Leave a Google review"'],
];

/** "+3", "−2" or "no change" against the month before; "" when both are nought. */
export function change(cur: number, prev: number): string {
  if (cur === 0 && prev === 0) return '';
  if (cur === prev) return 'no change';
  return cur > prev ? `+${cur - prev}` : `−${prev - cur}`;
}

/** The smaller figures under the headlines. */
export function details(s: MonthStats): Array<[string, string]> {
  return [
    ['Card page views', `${s.views} (${s.viewsFromEmail} from the welcome email)`],
    ['Downloads', String(s.downloads)],
    ['Shared with the phone share sheet', String(s.shares)],
    ['Post to LinkedIn', `${s.liStarted} started, ${s.liSignedIn} signed in, ${s.posts} posted, ${s.liCancelled} cancelled at LinkedIn, ${s.liFailed} failed`],
    ['Google review request', `${s.reviewAsks} shown, ${s.reviewClicks} pressed`],
  ];
}
