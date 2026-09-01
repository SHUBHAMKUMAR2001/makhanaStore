/**
 * TanStack Query hooks.
 *
 * Every server interaction goes through here so cache invalidation is defined
 * once per mutation rather than remembered at each call site.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  BusinessProfileDto,
  CampaignDto,
  CsvImportResult,
  DashboardStats,
  InteractionDto,
  LeadDetailDto,
  LeadDto,
  LeadListQuery,
  Paginated,
  ProductDto,
  ScraperRunDto,
  UserDto,
} from '@lead/shared';
import { api, qs } from '../lib/api';

export const keys = {
  me: ['me'] as const,
  leads: (q: unknown) => ['leads', q] as const,
  lead: (id: string) => ['lead', id] as const,
  leadScore: (id: string) => ['lead-score', id] as const,
  dashboard: (days: number) => ['dashboard', days] as const,
  campaigns: ['campaigns'] as const,
  scraperRuns: (q: unknown) => ['scraper-runs', q] as const,
  products: (q: unknown) => ['products', q] as const,
  business: ['business'] as const,
};

// --- auth ------------------------------------------------------------------

export function useMe(): UseQueryResult<{ user: UserDto }> {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<{ user: UserDto }>('/auth/me'),
    // A 401 here is the normal "not signed in" answer, not a transient failure.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<{ user: UserDto }>('/auth/login', body),
    onSuccess: (data) => {
      qc.setQueryData(keys.me, data);
      void qc.invalidateQueries();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}

// --- leads -----------------------------------------------------------------

export function useLeads(query: Partial<LeadListQuery>): UseQueryResult<Paginated<LeadDto>> {
  return useQuery({
    queryKey: keys.leads(query),
    queryFn: () => api.get<Paginated<LeadDto>>(`/leads${qs(query as Record<string, unknown>)}`),
    // Keeps the previous page visible while the next one loads, so the table
    // does not collapse to a spinner on every filter change.
    placeholderData: (prev) => prev,
  });
}

export function useLead(id: string | undefined): UseQueryResult<LeadDetailDto> {
  return useQuery({
    queryKey: keys.lead(id ?? ''),
    queryFn: () => api.get<LeadDetailDto>(`/leads/${id}`),
    enabled: Boolean(id),
  });
}

export function useLeadScore(id: string | undefined) {
  return useQuery({
    queryKey: keys.leadScore(id ?? ''),
    queryFn: () =>
      api.get<{
        stored: { score: string; scoreValue: number; reasons: string[] };
        computed: {
          value: number;
          band: string;
          contributions: { signal: string; points: number; max: number; reason: string }[];
        };
        stale: boolean;
      }>(`/leads/${id}/score`),
    enabled: Boolean(id),
  });
}

/** Invalidate everything a lead write can affect. */
function invalidateLead(qc: ReturnType<typeof useQueryClient>, id?: string): void {
  void qc.invalidateQueries({ queryKey: ['leads'] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  if (id) {
    void qc.invalidateQueries({ queryKey: keys.lead(id) });
    void qc.invalidateQueries({ queryKey: keys.leadScore(id) });
  }
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<LeadDto>('/leads', body),
    onSuccess: () => invalidateLead(qc),
  });
}

export function useUpdateLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<LeadDto>(`/leads/${id}`, body),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/leads/${id}`),
    onSuccess: () => invalidateLead(qc),
  });
}

export function useTransitionStage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { stage: string; note?: string; dealValue?: number | null }) =>
      api.post<LeadDto>(`/leads/${id}/stage`, body),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useAddInteraction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { type: string; content: string; direction?: string }) =>
      api.post<InteractionDto>(`/leads/${id}/interactions`, body),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      csv,
      dryRun,
      defaultSource,
    }: {
      csv: string;
      dryRun: boolean;
      defaultSource: string;
    }) => api.postCsv<CsvImportResult>(`/leads/import${qs({ dryRun, defaultSource })}`, csv),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) invalidateLead(qc);
    },
  });
}

// --- dashboard, campaigns, runs --------------------------------------------

export function useDashboard(days: number): UseQueryResult<DashboardStats> {
  return useQuery({
    queryKey: keys.dashboard(days),
    queryFn: () => api.get<DashboardStats>(`/stats/dashboard${qs({ days })}`),
  });
}

export function useCampaigns(): UseQueryResult<CampaignDto[]> {
  return useQuery({
    queryKey: keys.campaigns,
    queryFn: () => api.get<CampaignDto[]>('/campaigns'),
  });
}

export function useScraperRuns(query: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: keys.scraperRuns(query),
    queryFn: () => api.get<Paginated<ScraperRunDto>>(`/scraper-runs${qs(query)}`),
    // Runs progress in the background, so poll while the page is open.
    refetchInterval: 15_000,
  });
}

export function useStartScrape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { source: string; category: string; city: string; regionTier?: number }) =>
      api.post<ScraperRunDto>('/scraper-runs', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scraper-runs'] }),
  });
}

// --- catalogue -------------------------------------------------------------

export function useProducts(includeInactive: boolean): UseQueryResult<ProductDto[]> {
  return useQuery({
    queryKey: keys.products({ includeInactive }),
    queryFn: () => api.get<ProductDto[]>(`/catalogue/products${qs({ includeInactive })}`),
  });
}

function invalidateProducts(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['products'] });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<ProductDto>('/catalogue/products', body),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<ProductDto>(`/catalogue/products/${id}`, body),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hard }: { id: string; hard: boolean }) =>
      api.delete<{ deleted: 'soft' | 'hard'; message: string }>(
        `/catalogue/products/${id}${qs({ hard })}`,
      ),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useRestoreProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ProductDto>(`/catalogue/products/${id}/restore`),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useBusinessProfile(): UseQueryResult<BusinessProfileDto> {
  return useQuery({
    queryKey: keys.business,
    queryFn: () => api.get<BusinessProfileDto>('/config/business'),
  });
}
