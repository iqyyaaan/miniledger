import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { validationFailed } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

export interface FieldError {
  field: string;
  message: string;
}

/** Flatten Zod's issue tree into `[{ field, message }]` the app can show inline. */
export function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '_root',
    message: issue.message,
  }));
}

/**
 * Validate one part of the request against a schema and *replace* it with the
 * parsed result. That matters: downstream handlers then read coerced,
 * trimmed, defaulted values, and anything not in the schema is stripped —
 * so a client cannot smuggle an extra field like `userId` into an insert.
 */
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(validationFailed(toFieldErrors(result.error)));
      return;
    }

    if (source === 'query') {
      // Express 5 makes req.query a getter; assigning to a side channel keeps
      // this forward-compatible.
      (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    }
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}

/** Typed accessor for a validated query, paired with `validate(schema, 'query')`. */
export function validatedQuery<T extends ZodTypeAny>(req: Request): z.infer<T> {
  return ((req as Request & { validatedQuery?: unknown }).validatedQuery ?? req.query) as z.infer<T>;
}
