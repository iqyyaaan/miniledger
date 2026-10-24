import { env } from '../config/env.js';

// hand-written OpenAPI doc rather than generated from the Zod schemas.
// generating it would avoid the duplication, sure, but it'd also couple the
// public API contract to internal validation code — a schema refactor could
// silently reshape what's documented without anyone noticing. writing it by
// hand keeps the contract explicit and reviewable, and it's small enough
// that drift gets caught by the integration tests hitting the same routes anyway.
export function buildOpenApiDocument(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MiniLedger API',
      version: '1.0.0',
      description:
        'Track money lent to friends. Phone + OTP authentication, a loan ledger with ' +
        'repayment tracking, receipt photos, and a single-query summary endpoint.\n\n' +
        '**Money is always integer minor units** (`amountMinor`, i.e. paise for INR). ' +
        'The decimal `amount` string is a convenience for display only.',
    },
    servers: [{ url: baseUrl, description: 'This server' }],
    tags: [
      { name: 'Auth', description: 'Phone number login with a mock OTP.' },
      { name: 'Loans', description: 'The ledger: entries, repayment, receipts.' },
      { name: 'Summary', description: 'Aggregates across the whole ledger.' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'validation_failed' },
                message: { type: 'string' },
                details: {},
                requestId: { type: 'string' },
              },
              required: ['code', 'message'],
            },
          },
        },
        Loan: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            friendName: { type: 'string', example: 'Ravi' },
            amountMinor: { type: 'integer', example: 125050, description: 'Paise. Authoritative.' },
            amount: { type: 'string', example: '1250.50', description: 'Display only.' },
            currency: { type: 'string', example: env.DEFAULT_CURRENCY },
            dueDate: { type: 'string', format: 'date', example: '2026-11-15' },
            note: { type: ['string', 'null'] },
            status: { type: 'string', enum: ['outstanding', 'repaid'] },
            isOverdue: { type: 'boolean', description: 'Derived: outstanding and past due.' },
            daysUntilDue: { type: 'integer', description: 'Negative once overdue.' },
            repaidAt: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            receipt: {
              type: ['object', 'null'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                url: { type: 'string', example: '/api/loans/{id}/receipt' },
                mimeType: { type: 'string' },
                sizeBytes: { type: 'integer' },
              },
            },
          },
        },
        Summary: {
          type: 'object',
          properties: {
            asOf: { type: 'string', format: 'date' },
            currency: { type: 'string' },
            totals: {
              type: 'object',
              properties: {
                lentMinor: { type: 'integer' },
                repaidMinor: { type: 'integer' },
                outstandingMinor: { type: 'integer' },
                overdueMinor: { type: 'integer' },
                dueSoonMinor: { type: 'integer' },
              },
            },
            counts: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                repaid: { type: 'integer' },
                outstanding: { type: 'integer' },
                overdue: { type: 'integer' },
                dueSoon: { type: 'integer' },
                friends: { type: 'integer' },
              },
            },
            repaidPercent: { type: ['number', 'null'] },
            nextDueDate: { type: ['string', 'null'], format: 'date' },
            oldestOverdueDate: { type: ['string', 'null'], format: 'date' },
            topDebtors: { type: 'array', items: { type: 'object' } },
          },
        },
      },
      parameters: {
        AsOf: {
          name: 'asOf',
          in: 'query',
          schema: { type: 'string', format: 'date' },
          description:
            "The client's local date (YYYY-MM-DD). Determines what counts as overdue. " +
            `Defaults to today in ${env.APP_TIMEZONE}.`,
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing, invalid or expired access token.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ValidationFailed: {
          description: 'A field failed validation. `details` is `[{ field, message }]`.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/health': {
        get: {
          tags: ['Summary'],
          summary: 'Liveness + database connectivity',
          security: [],
          responses: { 200: { description: 'Healthy' }, 503: { description: 'Database unreachable' } },
        },
      },
      '/api/auth/request-otp': {
        post: {
          tags: ['Auth'],
          summary: 'Send a login code',
          description:
            'Prints the OTP to the server log. In development the code is also returned as ' +
            '`devCode` so the app can prefill it.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['phone'],
                  properties: { phone: { type: 'string', example: '9876543210' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Code sent' },
            422: { $ref: '#/components/responses/ValidationFailed' },
            429: { description: 'Too many codes requested' },
          },
        },
      },
      '/api/auth/verify-otp': {
        post: {
          tags: ['Auth'],
          summary: 'Exchange a code for a session',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['phone', 'code'],
                  properties: {
                    phone: { type: 'string', example: '9876543210' },
                    code: { type: 'string', example: '123456' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Access token, refresh token and user' },
            401: { description: 'Incorrect or expired code' },
            429: { description: 'Too many attempts' },
          },
        },
      },
      '/api/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Rotate a refresh token',
          description: 'Single-use. Replaying a rotated token revokes every session for the user.',
          security: [],
          responses: { 200: { description: 'New token pair' }, 401: { description: 'Invalid' } },
        },
      },
      '/api/auth/logout': {
        post: { tags: ['Auth'], summary: 'Revoke a refresh token', security: [], responses: { 204: { description: 'Signed out' } } },
      },
      '/api/auth/me': {
        get: { tags: ['Auth'], summary: 'Current user', responses: { 200: { description: 'The user' }, 401: { $ref: '#/components/responses/Unauthorized' } } },
        patch: { tags: ['Auth'], summary: 'Set display name', responses: { 200: { description: 'Updated user' } } },
      },
      '/api/loans': {
        get: {
          tags: ['Loans'],
          summary: 'List entries (keyset paginated)',
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['all', 'outstanding', 'repaid', 'overdue', 'due_soon'],
                default: 'outstanding',
              },
            },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Matches friend name or note.' },
            { name: 'friend', in: 'query', schema: { type: 'string' } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'From `meta.nextCursor`.' },
            { $ref: '#/components/parameters/AsOf' },
          ],
          responses: {
            200: {
              description: 'A page of entries',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Loan' } },
                      meta: {
                        type: 'object',
                        properties: {
                          nextCursor: { type: ['string', 'null'] },
                          asOf: { type: 'string', format: 'date' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          tags: ['Loans'],
          summary: 'Add an entry',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['friendName', 'amount', 'dueDate'],
                  properties: {
                    friendName: { type: 'string', example: 'Ravi' },
                    amount: {
                      oneOf: [{ type: 'number' }, { type: 'string' }],
                      example: '1250.50',
                      description: 'Major units. "1,250.50" and 1250.5 are both accepted.',
                    },
                    dueDate: { type: 'string', format: 'date', example: '2026-11-15' },
                    note: { type: ['string', 'null'] },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Loan' } } } },
            422: { $ref: '#/components/responses/ValidationFailed' },
          },
        },
      },
      '/api/loans/friends': {
        get: { tags: ['Loans'], summary: 'Distinct friends, for autocomplete', responses: { 200: { description: 'Friend list' } } },
      },
      '/api/loans/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        get: { tags: ['Loans'], summary: 'Fetch one entry', responses: { 200: { description: 'The entry' }, 404: { description: 'Not found' } } },
        patch: { tags: ['Loans'], summary: 'Edit an entry', responses: { 200: { description: 'Updated' } } },
        delete: { tags: ['Loans'], summary: 'Delete an entry', responses: { 204: { description: 'Deleted' } } },
      },
      '/api/loans/{id}/repayment': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        post: {
          tags: ['Loans'],
          summary: 'Mark as repaid',
          description: 'Idempotent by conditional UPDATE: a second call returns 409 `already_repaid`.',
          responses: { 200: { description: 'Marked repaid' }, 409: { description: 'Already repaid' } },
        },
        delete: { tags: ['Loans'], summary: 'Undo a repayment', responses: { 200: { description: 'Back to outstanding' } } },
      },
      '/api/loans/{id}/receipt': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        put: {
          tags: ['Loans'],
          summary: 'Attach a receipt photo',
          description: `Multipart, field name \`receipt\`. Max ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB. The file type is verified by magic number, not by its declared Content-Type.`,
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { receipt: { type: 'string', format: 'binary' } } },
              },
            },
          },
          responses: { 201: { description: 'Attached' }, 400: { description: 'Not a supported image' }, 413: { description: 'Too large' } },
        },
        get: { tags: ['Loans'], summary: 'Download the receipt', responses: { 200: { description: 'Image bytes' }, 404: { description: 'No receipt' } } },
        delete: { tags: ['Loans'], summary: 'Remove the receipt', responses: { 204: { description: 'Removed' } } },
      },
      '/api/summary': {
        get: {
          tags: ['Summary'],
          summary: 'Totals across the ledger',
          description: 'Total lent, total repaid, outstanding, overdue and due-soon — computed in a single aggregate query.',
          parameters: [{ $ref: '#/components/parameters/AsOf' }],
          responses: {
            200: { description: 'The summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/Summary' } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
    },
  } as const;
}
