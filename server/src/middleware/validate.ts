import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { validationFailed } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

export interface FieldError {
  field: string;
  message: string;
}

// flattens Zod's issue tree into [{ field, message }] so the app can show it inline
export function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '_root',
    message: issue.message,
  }));
}

// validates one part of the request and REPLACES it with the parsed result.
// that replace matters — handlers downstream get the coerced/trimmed/
// defaulted values, and anything not declared in the schema just gets
// dropped, so a client can't sneak an extra field like userId into a body
// and have it end up in an insert
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(validationFailed(toFieldErrors(result.error)));
      return;
    }

    if (source === 'query') {
      // req.query is a getter-only prop on Express 5, so this stashes the
      // parsed value on a side channel instead — keeps it working either way
      (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    }
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}

// typed accessor for a validated query — pair with validate(schema, 'query')
export function validatedQuery<T extends ZodTypeAny>(req: Request): z.infer<T> {
  return ((req as Request & { validatedQuery?: unknown }).validatedQuery ?? req.query) as z.infer<T>;
}
