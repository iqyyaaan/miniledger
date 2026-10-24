import pino from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  // pretty + colorized locally, plain NDJSON in prod so a log aggregator
  // can actually parse it
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.code',
      'body.otp',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
});

// this is the "SMS provider" for now — swap it for Twilio/MSG91 later and
// nothing at the call site has to change, that's the whole point of hiding
// it behind a function instead of inlining a console.log somewhere
export function deliverOtp(phone: string, code: string, ttlSeconds: number): void {
  const banner = '─'.repeat(46);
  logger.info(
    `\n┌${banner}┐\n` +
      `│ 📲  MOCK SMS — MiniLedger login code${' '.repeat(9)}│\n` +
      `│${' '.repeat(46)}│\n` +
      `│   To      : ${phone.padEnd(33)}│\n` +
      `│   Code    : ${code.padEnd(33)}│\n` +
      `│   Expires : ${`in ${ttlSeconds}s`.padEnd(33)}│\n` +
      `└${banner}┘`,
  );
}
