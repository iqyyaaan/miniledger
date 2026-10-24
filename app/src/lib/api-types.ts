// mirrors server/src/modules/loans/loans.serializer.ts#LoanDto
export interface Loan {
  id: string;
  friendName: string;
  amountMinor: number;
  amount: string;
  currency: string;
  dueDate: string;
  note: string | null;
  status: 'outstanding' | 'repaid';
  isOverdue: boolean;
  daysUntilDue: number;
  repaidAt: string | null;
  createdAt: string;
  updatedAt: string;
  receipt: { id: string; url: string; mimeType: string; sizeBytes: number } | null;
}

export type LoanStatusFilter = 'all' | 'outstanding' | 'repaid' | 'overdue' | 'due_soon';

export interface LoanListResponse {
  data: Loan[];
  meta: { nextCursor: string | null; asOf: string; count: number };
}

// mirrors server/src/modules/summary/summary.service.ts#Summary
export interface Summary {
  asOf: string;
  currency: string;
  totals: {
    lentMinor: number;
    repaidMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    dueSoonMinor: number;
    lent: string;
    repaid: string;
    outstanding: string;
    overdue: string;
    dueSoon: string;
  };
  counts: {
    total: number;
    repaid: number;
    outstanding: number;
    overdue: number;
    dueSoon: number;
    friends: number;
  };
  repaidPercent: number | null;
  nextDueDate: string | null;
  oldestOverdueDate: string | null;
  dueSoonWindowDays: number;
  topDebtors: {
    friendName: string;
    outstandingMinor: number;
    outstanding: string;
    overdueMinor: number;
    loanCount: number;
  }[];
}

export interface AuthUser {
  id: string;
  phone: string;
  displayName: string | null;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  isNewUser: boolean;
  user: AuthUser;
}

export interface FriendSummary {
  name: string;
  loanCount: number;
  outstandingMinor: number;
}

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ApiFieldError[] | { code?: string } | unknown;
    requestId?: string;
  };
}

// thrown by the fetch client for any non-2xx response
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly fieldErrors: ApiFieldError[];

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? 'Something went wrong.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'unknown_error';
    this.details = body?.error.details;
    this.fieldErrors = Array.isArray(body?.error.details)
      ? (body!.error.details as ApiFieldError[])
      : [];
  }

  // the 409 case where "mark repaid" (or similar) already happened
  get isAlreadyDone(): boolean {
    const details = this.details as { code?: string } | undefined;
    return this.status === 409 && (details?.code === 'already_repaid' || details?.code === 'already_outstanding');
  }

  fieldError(field: string): string | undefined {
    return this.fieldErrors.find((e) => e.field === field)?.message;
  }
}
