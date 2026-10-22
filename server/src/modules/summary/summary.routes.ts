import { Router } from 'express';
import { currentUser, requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { AsOfQuerySchema } from '../loans/loans.schemas.js';
import { getSummary } from './summary.service.js';

export const summaryRouter = Router();

summaryRouter.get(
  '/',
  requireAuth,
  validate(AsOfQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { asOf } = validatedQuery<typeof AsOfQuerySchema>(req);
    const summary = await getSummary(currentUser(req).id, asOf ?? null);

    // The summary is cheap to recompute and must never be stale after a
    // repayment, so it is explicitly uncacheable.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ data: summary });
  }),
);
