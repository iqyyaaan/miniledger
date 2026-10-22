import pino from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  // Pretty, colourised logs locally; newline-delimited JSON in production so a
  // log aggregator can parse them.
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

/**
 * The mock OTP delivery channel. A real build swaps this for Twilio/MSG91;
 * the call site does not change, which is the point of keeping it behind a
 * function.
 */
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
