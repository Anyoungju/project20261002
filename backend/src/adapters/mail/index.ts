import nodemailer from 'nodemailer';
import { env } from '../../config/env';

/** R18 — MailTransport: console(개발) · smtp */
export interface MailTransport {
  send(to: string, subject: string, text: string): Promise<void>;
}

class ConsoleMail implements MailTransport {
  async send(to: string, subject: string): Promise<void> {
    // 수신자 주소는 로그에 남기지 않는다(개인정보) — 도메인만
    console.log(`[mail:console] to=*@${to.split('@')[1] ?? '?'} subject=${subject}`);
  }
}

class SmtpMail implements MailTransport {
  private t = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT ?? 587,
    auth: env.MAIL_USER ? { user: env.MAIL_USER, pass: env.MAIL_PASSWORD } : undefined,
  });
  async send(to: string, subject: string, text: string): Promise<void> {
    await this.t.sendMail({ from: env.MAIL_FROM, to, subject, text });
  }
}

let transport: MailTransport | null = null;
export function mailTransport(): MailTransport {
  if (!transport) transport = env.MAIL_TRANSPORT === 'smtp' ? new SmtpMail() : new ConsoleMail();
  return transport;
}

export function sendMail(to: string, subject: string, text: string): Promise<void> {
  return mailTransport().send(to, subject, text);
}
