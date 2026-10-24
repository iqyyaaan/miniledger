import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { MoneyParseError } from '../lib/money.js';
import { PhoneParseError } from '../lib/phone.js';
import { toFieldErrors } from './validate.js';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

// pino-http types req.id as ReqId (string | number | object) — everywhere
// we actually want it, we want a plain string, so normalize it once here
// instead of casting at every call site
export function requestId(req: Request): string {
  return String((req as Request & { id?: unknown }).id ?? '');
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: `No route matches ${req.method} ${req.path}.`,
      requestId: requestId(req),
    },
  } satisfies ErrorBody);
}

// the one place every failure in the API funnels through. the expected
// stuff — AppError, Zod, multer, our own parse errors — gets translated
// into a stable { error: { code, message, details } } shape the app can
// branch on. anything else is a bug we didn't anticipate: gets logged in
// full server-side, client just gets a bare 500 with a request id to quote.
// no stack traces, no raw Postgres errors, no table names, ever.
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const reqId = requestId(req);

  if (error instanceof AppError) {
    if (error.status >= 500) logger.error({ err: error, requestId: reqId }, 'Server error');
    else logger.debug({ code: error.code, requestId: reqId }, error.message);

    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details, requestId: reqId },
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'One or more fields are invalid.',
        details: toFieldErrors(error),
        requestId: reqId,
      },
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof MoneyParseError || error instanceof PhoneParseError) {
    res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'One or more fields are invalid.',
        details: [
          {
            field: error instanceof MoneyParseError ? 'amount' : 'phone',
            message: error.message,
          },
        ],
        requestId: reqId,
      },
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'That image is too large.'
        : error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Unexpected file field. Upload the image as "receipt".'
          : 'Upload failed.';
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: { code: `upload_${error.code.toLowerCase()}`, message, requestId: reqId },
    } satisfies ErrorBody);
    return;
  }

  // malformed JSON body — express.json() throws a SyntaxError with .body set on it
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      error: { code: 'malformed_json', message: 'Request body is not valid JSON.', requestId: reqId },
    } satisfies ErrorBody);
    return;
  }

  logger.error({ err: error, requestId: reqId, path: req.path, method: req.method }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our end.',
      // real message only in dev, never a stack trace either way
      details: isProduction ? undefined : { message: (error as Error)?.message },
      requestId: reqId,
    },
  } satisfies ErrorBody);
}

// Express 4 doesn't catch rejections thrown from async handlers on its own
// — without this an unhandled rejection just hangs the request until it
// times out. wrapping every async route handler in this forwards the
// rejection into errorHandler like you'd expect.
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
