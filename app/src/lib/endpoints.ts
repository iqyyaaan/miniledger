import { api, apiUpload } from './api-client';
import type {
  AuthSession,
  AuthUser,
  FriendSummary,
  Loan,
  LoanListResponse,
  LoanStatusFilter,
  Summary,
} from './api-types';

export const authApi = {
  requestOtp: (phone: string) =>
    api.post<{ phone: string; expiresInSeconds: number; otpLength: number; devCode?: string }>(
      '/api/auth/request-otp',
      { phone },
      { skipAuth: true },
    ),

  verifyOtp: (phone: string, code: string) =>
    api.post<AuthSession>('/api/auth/verify-otp', { phone, code }, { skipAuth: true }),

  logout: (refreshToken: string) =>
    api.post<void>('/api/auth/logout', { refreshToken }, { skipAuth: true }),

  me: () => api.get<{ user: AuthUser }>('/api/auth/me'),
};

export interface ListLoansParams {
  status: LoanStatusFilter;
  search?: string;
  friend?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
  asOf: string;
}

export interface CreateLoanInput {
  friendName: string;
  amount: string;
  dueDate: string;
  note?: string | null;
}

export const loansApi = {
  list: (params: ListLoansParams) =>
    api.get<LoanListResponse>('/api/loans', {
      status: params.status,
      search: params.search,
      friend: params.friend,
      order: params.order,
      limit: params.limit,
      cursor: params.cursor,
      asOf: params.asOf,
    }),

  get: (id: string, asOf: string) => api.get<{ data: Loan }>(`/api/loans/${id}`, { asOf }),

  create: (input: CreateLoanInput) => api.post<{ data: Loan }>('/api/loans', input),

  update: (id: string, patch: Partial<CreateLoanInput>) =>
    api.patch<{ data: Loan }>(`/api/loans/${id}`, patch),

  remove: (id: string) => api.delete<void>(`/api/loans/${id}`),

  markRepaid: (id: string, asOf: string) =>
    api.post<{ data: Loan }>(`/api/loans/${id}/repayment`, undefined, { query: { asOf } }),

  undoRepaid: (id: string, asOf: string) =>
    api.delete<{ data: Loan }>(`/api/loans/${id}/repayment`, { asOf }),

  friends: () => api.get<{ data: FriendSummary[] }>('/api/loans/friends'),

  uploadReceipt: (id: string, file: { uri: string; name: string; mimeType: string }) => {
    const form = new FormData();
    // RN's FormData is fine with this shape instead of a real web File/Blob
    form.append('receipt', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    return apiUpload<{ data: { id: string; mimeType: string; sizeBytes: number; url: string } }>(
      `/api/loans/${id}/receipt`,
      form,
    );
  },

  deleteReceipt: (id: string) => api.delete<void>(`/api/loans/${id}/receipt`),
};

export const summaryApi = {
  get: (asOf: string) => api.get<{ data: Summary }>('/api/summary', { asOf }),
};
