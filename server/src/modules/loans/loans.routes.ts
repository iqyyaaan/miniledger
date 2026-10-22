import { Router } from 'express';
import multer from 'multer';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import * as receipts from '../receipts/receipts.service.js';
import {
  AsOfQuerySchema,
  CreateLoanSchema,
  ListLoansQuerySchema,
  LoanIdParamsSchema,
  UpdateLoanSchema,
} from './loans.schemas.js';
import * as service from './loans.service.js';

export const loansRouter = Router();

// Every route below requires a signed-in user.
loansRouter.use(requireAuth);

/**
 * Buffer the upload in memory rather than letting multer write to a temp file.
 * At a 5 MB cap and one photo per request that is cheap, and it means the
 * bytes are never on disk until they have passed the magic-number check.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 4 },
});

const asOfFrom = (req: { query: unknown }): string | null =>
  (req.query as { asOf?: string }).asOf ?? null;

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

loansRouter.get(
  '/',
  validate(ListLoansQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<typeof ListLoansQuerySchema>(req);
    const result = await service.listLoans(currentUser(req).id, {
      status: q.status,
      search: q.search,
      friend: q.friend,
      order: q.order,
      limit: q.limit,
      cursor: q.cursor,
      asOf: q.asOf ?? null,
    });

    res.status(200).json({
      data: result.data,
      meta: { nextCursor: result.nextCursor, asOf: result.asOf, count: result.data.length },
    });
  }),
);

loansRouter.post(
  '/',
  validate(CreateLoanSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof CreateLoanSchema>;
    const loan = await service.createLoan(
      currentUser(req).id,
      {
        friendName: body.friendName,
        amountMinor: body.amount,
        dueDate: body.dueDate,
        note: body.note ?? null,
      },
      null,
    );

    res.status(201).location(`/api/loans/${loan.id}`).json({ data: loan });
  }),
);

/** Powers the "who have I lent to before" autocomplete in the add form. */
loansRouter.get(
  '/friends',
  asyncHandler(async (req, res) => {
    res.status(200).json({ data: await service.listFriends(currentUser(req).id) });
  }),
);

// ---------------------------------------------------------------------------
// Single loan
// ---------------------------------------------------------------------------

loansRouter.get(
  '/:id',
  validate(LoanIdParamsSchema, 'params'),
  validate(AsOfQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const loan = await service.getLoan(currentUser(req).id, req.params.id!, asOfFrom(req));
    res.status(200).json({ data: loan });
  }),
);

loansRouter.patch(
  '/:id',
  validate(LoanIdParamsSchema, 'params'),
  validate(UpdateLoanSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof UpdateLoanSchema>;
    const loan = await service.updateLoan(
      currentUser(req).id,
      req.params.id!,
      {
        friendName: body.friendName,
        amountMinor: body.amount,
        dueDate: body.dueDate,
        note: body.note,
      },
      null,
    );
    res.status(200).json({ data: loan });
  }),
);

loansRouter.delete(
  '/:id',
  validate(LoanIdParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    await service.deleteLoan(currentUser(req).id, req.params.id!);
    res.status(204).send();
  }),
);

/**
 * Repayment is modelled as its own sub-resource rather than
 * `PATCH { status: 'repaid' }`.
 *
 * It is a state transition with a side effect (stamping `repaid_at`), not a
 * field assignment — POST says "do this once", and the 409 on a repeat is
 * meaningful, whereas a PATCH setting a field to the value it already has
 * ought to be a no-op 200.
 */
loansRouter.post(
  '/:id/repayment',
  validate(LoanIdParamsSchema, 'params'),
  validate(AsOfQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const loan = await service.markRepaid(currentUser(req).id, req.params.id!, asOfFrom(req));
    res.status(200).json({ data: loan });
  }),
);

/** Undo — for the inevitable mis-tap. */
loansRouter.delete(
  '/:id/repayment',
  validate(LoanIdParamsSchema, 'params'),
  validate(AsOfQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const loan = await service.markOutstanding(currentUser(req).id, req.params.id!, asOfFrom(req));
    res.status(200).json({ data: loan });
  }),
);

// ---------------------------------------------------------------------------
// Receipt photo (bonus)
// ---------------------------------------------------------------------------

loansRouter.put(
  '/:id/receipt',
  validate(LoanIdParamsSchema, 'params'),
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Attach an image in the "receipt" field.');

    const receipt = await receipts.attachReceipt(currentUser(req).id, req.params.id!, {
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      size: req.file.size,
    });

    res.status(201).json({ data: receipt });
  }),
);

loansRouter.get(
  '/:id/receipt',
  validate(LoanIdParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { stream, mimeType, sizeBytes, etag } = await receipts.openReceipt(
      currentUser(req).id,
      req.params.id!,
    );

    // A receipt is personal data: private caching only, and never let a
    // shared proxy hold a copy.
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(sizeBytes));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', etag);
    res.setHeader('Content-Disposition', 'inline');
    // Stop a browser from re-interpreting the bytes as something executable.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.get('if-none-match') === etag) {
      res.status(304).end();
      stream.destroy();
      return;
    }

    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }),
);

loansRouter.delete(
  '/:id/receipt',
  validate(LoanIdParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    await receipts.deleteReceipt(currentUser(req).id, req.params.id!);
    res.status(204).send();
  }),
);
