// How email leaves the service. smtp: any provider with an SMTP endpoint (ZeptoMail, Amazon SES, Microsoft 365,
// Google Workspace), set by MAIL_SMTP_URL. file: each email is written to DATA_DIR/mail-outbox as .html and .txt,
// for the local copy and for previews. off: nothing is sent and emails stay queued.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Env } from '../types.js';

export interface OutgoingEmail {
  to: string;
  cc?: string | null;
  subject: string;
  html: string;
  text: string;
}

export interface MailTransport {
  readonly mode: 'smtp' | 'file';
  send(m: OutgoingEmail): Promise<{ id: string }>;
}

export const DEFAULT_FROM = 'SPC Free Zone <noreply@spcfz.ae>';

/** The transport the configuration asks for, or null when mail is off. */
export function transportFromEnv(env: Env): MailTransport | null {
  const mode = env.MAIL_TRANSPORT ?? (env.MAIL_SMTP_URL ? 'smtp' : 'off');
  const from = env.MAIL_FROM || DEFAULT_FROM;
  const headers = { 'X-Auto-Response-Suppress': 'OOF, AutoReply', 'Auto-Submitted': 'auto-generated' };
  if (mode === 'smtp' && env.MAIL_SMTP_URL) {
    const smtp = nodemailer.createTransport(env.MAIL_SMTP_URL);
    return {
      mode: 'smtp',
      async send(m) {
        const info = await smtp.sendMail({
          from, to: m.to, cc: m.cc || undefined, bcc: env.MAIL_BCC || undefined, replyTo: env.MAIL_REPLY_TO || undefined,
          subject: m.subject, html: m.html, text: m.text, headers,
        });
        return { id: String(info.messageId ?? '') };
      },
    };
  }
  if (mode === 'file') {
    const dir = path.join(env.DATA_DIR, 'mail-outbox');
    return {
      mode: 'file',
      async send(m) {
        mkdirSync(dir, { recursive: true });
        const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${m.to.replace(/[^a-z0-9@._-]/gi, '_')}`;
        writeFileSync(path.join(dir, `${id}.html`), m.html);
        writeFileSync(path.join(dir, `${id}.txt`), `From: ${from}\nTo: ${m.to}\n${m.cc ? `Cc: ${m.cc}\n` : ''}Subject: ${m.subject}\n\n${m.text}\n`);
        return { id: `file:${id}` };
      },
    };
  }
  return null;
}
