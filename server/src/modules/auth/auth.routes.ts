import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { normalizePhone } from '../../lib/phone.js';
import { requireAuth, currentUser } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { clientIp, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as service from './auth.service.js';

export const authRouter = Router();

/**
 * `.transform(normalizePhone)` runs inside validation, so by the time a
 * handler sees `req.body.phone` it is already E.164. Every downstream
 * lookup therefore compares the same canonical string.
 */
const phoneField = z
  .string({ required_error: 'Phone number is required.' })
  .min(6, 'Enter a valid phone number.')
  .max(20, 'Enter a valid phone number.')
  .transform((value, ctx) => {
    try {
      return normalizePhone(value, env.DEFAULT_COUNTRY_CODE);
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
  });

const RequestOtpSchema = z.object({ phone: phoneField }).strict();

const VerifyOtpSchema = z
  .object({
    phone: phoneField,
    code: z
      .string({ required_error: 'Enter the code we sent you.' })
      .trim()
      .regex(new RegExp(`^\\d{${env.OTP_LENGTH}}$`), `Enter the ${env.OTP_LENGTH}-digit code.`),
  })
  .strict();

const RefreshSchema = z.object({ refreshToken: z.string().min(1, 'refreshToken is required.') }).strict();

const ProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'Name cannot be empty.')
      .max(60, 'Name is too long.')
      .nullable()
      .optional(),
  })
  .strict();

/**
 * Two limits guard OTP requests: per IP (stops one host enumerating many
 * numbers) and per phone (stops many hosts hammering one number). The
 * per-phone count lives in the database so it survives a restart; this is the
 * cheap in-memory first line.
 */
const requestOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyBy: clientIp,
  message: 'Too many login attempts from this device. Try again shortly.',
});

const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyBy: clientIp,
  message: 'Too many verification attempts. Try again shortly.',
});

authRouter.post(
  '/request-otp',
  requestOtpLimiter,
  validate(RequestOtpSchema),
  asyncHandler(async (req, res) => {
    const { phone } = req.body as z.infer<typeof RequestOtpSchema>;
    const result = await service.requestOtp(phone);

    res.status(200).json({
      message: 'Verification code sent. Check the server logs.',
      phone,
      expiresInSeconds: result.expiresInSeconds,
      otpLength: env.OTP_LENGTH,
      // Present only in development; see OTP_ECHO_IN_RESPONSE.
      devCode: result.devCode,
    });
  }),
);

authRouter.post(
  '/verify-otp',
  verifyOtpLimiter,
  validate(VerifyOtpSchema),
  asyncHandler(async (req, res) => {
    const { phone, code } = req.body as z.infer<typeof VerifyOtpSchema>;
    const session = await service.verifyOtp(phone, code);
    res.status(200).json(session);
  }),
);

authRouter.post(
  '/refresh',
  validate(RefreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof RefreshSchema>;
    res.status(200).json(await service.refreshSession(refreshToken));
  }),
);

authRouter.post(
  '/logout',
  validate(RefreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof RefreshSchema>;
    await service.logout(refreshToken);
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json({ user: await service.getProfile(currentUser(req).id) });
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  validate(ProfileSchema),
  asyncHandler(async (req, res) => {
    const { displayName } = req.body as z.infer<typeof ProfileSchema>;
    const user = await service.setDisplayName(currentUser(req).id, displayName ?? null);
    res.status(200).json({ user });
  }),
);
