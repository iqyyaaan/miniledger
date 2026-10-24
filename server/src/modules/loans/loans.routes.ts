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

// everything below this needs a signed-in user
loansRouter.use(requireAuth);

// buffering the upload in memory instead of letting multer write a temp
// file — at a 5MB cap and one photo per request that's cheap, and it means
// nothing hits disk until it's passed the magic-number check
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

// powers the "who have I lent to before" autocomplete on the add-entry form
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

// modeled repayment as its own sub-resource instead of a
// PATCH { status: 'repaid' }. it's a state transition with a side effect
// (stamping repaid_at), not just a field assignment — POST reads as "do
// this once," and a 409 on repeat actually means something, whereas PATCHing
// a field to the value it already has should really just be a 200 no-op.
loansRouter.post(
  '/:id/repayment',
  validate(LoanIdParamsSchema, 'params'),
  validate(AsOfQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const loan = await service.markRepaid(currentUser(req).id, req.params.id!, asOfFrom(req));
    res.status(200).json({ data: loan });
  }),
);

// the undo, for when someone mis-taps
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

    // a receipt is someone's personal data — private caching only, never
    // let a shared proxy cache a copy
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(sizeBytes));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', etag);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff'); // stop a browser from re-sniffing this as something executable

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
