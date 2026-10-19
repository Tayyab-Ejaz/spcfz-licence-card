// Staff accounts and their sign-in sessions (migrations/0005_admin_auth.sql). Every SQL statement for them.
import type { D1Database } from '../types.js';
import { ulid } from '../util/crypto.js';

export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  failed_logins: number;
  locked_until: string | null;
}

export interface AdminSession {
  token_hash: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  email: string;
}

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export async function findAdminByEmail(db: D1Database, email: string): Promise<AdminUser | null> {
  return (await db.prepare('SELECT * FROM admin_users WHERE email = ?1').bind(normaliseEmail(email)).first<AdminUser>()) ?? null;
}

export async function listAdmins(db: D1Database): Promise<AdminUser[]> {
  return (await db.prepare('SELECT * FROM admin_users ORDER BY email').all<AdminUser>()).results ?? [];
}

export async function countAdmins(db: D1Database): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM admin_users').first<{ n: number }>())?.n ?? 0;
}

export async function insertAdmin(db: D1Database, email: string, passwordHash: string, now: string): Promise<AdminUser> {
  const id = ulid();
  await db.prepare('INSERT INTO admin_users (id, email, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)')
    .bind(id, normaliseEmail(email), passwordHash, now).run();
  const user = await findAdminByEmail(db, email);
  if (!user) throw new Error('admin user not found after insert');
  return user;
}

/** New password; clears the lock and signs the account out everywhere. */
export async function setAdminPassword(db: D1Database, id: string, passwordHash: string, now: string): Promise<void> {
  await db.prepare('UPDATE admin_users SET password_hash = ?2, updated_at = ?3, failed_logins = 0, locked_until = NULL WHERE id = ?1')
    .bind(id, passwordHash, now).run();
  await deleteAdminSessions(db, id);
}

export async function unlockAdmin(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare('UPDATE admin_users SET failed_logins = 0, locked_until = NULL, updated_at = ?2 WHERE id = ?1').bind(id, now).run();
}

/** Removes the account and, through the foreign key, its sessions. */
export async function deleteAdmin(db: D1Database, id: string): Promise<void> {
  await deleteAdminSessions(db, id);
  await db.prepare('DELETE FROM admin_users WHERE id = ?1').bind(id).run();
}

/** One more wrong password; locks the account until `lockUntil` once `lockAfter` is reached. */
export async function recordAdminFailure(db: D1Database, id: string, lockAfter: number, lockUntil: string): Promise<void> {
  await db.prepare(
    `UPDATE admin_users SET failed_logins = failed_logins + 1,
       locked_until = CASE WHEN failed_logins + 1 >= ?2 THEN ?3 ELSE locked_until END
     WHERE id = ?1`,
  ).bind(id, lockAfter, lockUntil).run();
}

export async function recordAdminLogin(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare('UPDATE admin_users SET failed_logins = 0, locked_until = NULL, last_login_at = ?2 WHERE id = ?1').bind(id, now).run();
}

export async function insertAdminSession(
  db: D1Database, tokenHash: string, userId: string, now: string, expiresAt: string, ip: string | null,
): Promise<void> {
  await db.prepare('INSERT INTO admin_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip) VALUES (?1, ?2, ?3, ?3, ?4, ?5)')
    .bind(tokenHash, userId, now, expiresAt, ip).run();
}

export async function getAdminSession(db: D1Database, tokenHash: string): Promise<AdminSession | null> {
  return (await db.prepare(
    `SELECT s.token_hash, s.user_id, s.created_at, s.last_seen_at, s.expires_at, u.email
       FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.token_hash = ?1`,
  ).bind(tokenHash).first<AdminSession>()) ?? null;
}

export async function touchAdminSession(db: D1Database, tokenHash: string, now: string, expiresAt: string): Promise<void> {
  await db.prepare('UPDATE admin_sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1').bind(tokenHash, now, expiresAt).run();
}

export async function deleteAdminSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1').bind(tokenHash).run();
}

export async function deleteAdminSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE user_id = ?1').bind(userId).run();
}

export async function purgeExpiredAdminSessions(db: D1Database, now: string): Promise<number> {
  const r = await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?1').bind(now).run();
  return r.meta?.changes ?? 0;
}
