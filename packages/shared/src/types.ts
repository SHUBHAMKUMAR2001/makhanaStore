/** API response shapes, consumed by the web app and the scraper's API client. */

import type {
  CampaignChannel,
  DeliveryStatus,
  DocumentType,
  InteractionDirection,
  InteractionType,
  LeadScore,
  LeadSource,
  LeadStage,
  ScraperRunStatus,
  UserRole,
} from './enums.js';

/** Money crosses the wire as a number of rupees, not a Prisma Decimal. */
export interface LeadDto {
  id: string;
  name: string;
  category: string;
  city: string;
  regionTier: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  source: LeadSource;
  stage: LeadStage;
  score: LeadScore;
  scoreValue: number;
  scoreReasons: string[];
  dealValue: number | null;
  notes: string | null;
  campaignId: string | null;
  scraperRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InteractionDto {
  id: string;
  leadId: string;
  type: InteractionType;
  content: string;
  direction: InteractionDirection;
  status: DeliveryStatus;
  subject: string | null;
  externalId: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

export interface DocumentDto {
  id: string;
  type: DocumentType;
  leadId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Relative API path to download the file. */
  downloadUrl: string;
}

export interface LeadDetailDto extends LeadDto {
  interactions: InteractionDto[];
  documents: DocumentDto[];
  campaign: { id: string; name: string; channel: CampaignChannel } | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CampaignDto {
  id: string;
  name: string;
  channel: CampaignChannel;
  sourceConfig: Record<string, unknown>;
  spend: number | null;
  startedAt: string;
  endedAt: string | null;
  leadCount: number;
  wonCount: number;
  pipelineValue: number;
  revenue: number;
}

export interface ScraperRunDto {
  id: string;
  source: LeadSource;
  category: string;
  city: string;
  status: ScraperRunStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  leadsFound: number;
  leadsCreated: number;
  leadsDuplicate: number;
  requestsMade: number;
  error: string | null;
  jobId: string | null;
}

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

// --- dashboard -------------------------------------------------------------

export interface FunnelStageCount {
  stage: LeadStage;
  count: number;
  /** Total deal value sitting in this stage. */
  value: number;
}

export interface SourcePerformance {
  source: LeadSource;
  leads: number;
  contacted: number;
  replied: number;
  won: number;
  lost: number;
  /** won / (won + lost), null when nothing has closed yet. */
  closeRate: number | null;
  revenue: number;
  pipelineValue: number;
}

export interface DashboardStats {
  totals: {
    leads: number;
    openLeads: number;
    won: number;
    lost: number;
    /** Sum of dealValue across open stages. */
    pipelineValue: number;
    /** Sum of dealValue across closed_won. */
    revenue: number;
    /** won / (won + lost), null when nothing has closed yet. */
    closeRate: number | null;
    /** Mean dealValue of won deals, null when there are none. */
    averageDealValue: number | null;
  };
  funnel: FunnelStageCount[];
  bySource: SourcePerformance[];
  byScore: { score: LeadScore; count: number; won: number }[];
  byRegionTier: { regionTier: number; count: number; won: number }[];
  /** Leads created per day for the trailing window. */
  leadsOverTime: { date: string; count: number }[];
  recentRuns: ScraperRunDto[];
}

// --- errors ----------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level detail for validation failures. */
    details?: { path: string; message: string }[];
  };
}

export interface CsvImportResult {
  dryRun: boolean;
  totalRows: number;
  created: number;
  updated: number;
  duplicates: number;
  failed: number;
  errors: { row: number; message: string; field?: string }[];
}

// --- catalogue -------------------------------------------------------------

export interface PriceTierDto {
  id: string;
  minQty: number;
  maxQty: number | null;
  pricePerUnit: number;
  currency: string;
}

export interface ProductDto {
  id: string;
  sku: string;
  name: string;
  grade: string | null;
  description: string | null;
  hsnCode: string | null;
  unit: string;
  active: boolean;
  sortOrder: number;
  priceTiers: PriceTierDto[];
  createdAt: string;
  updatedAt: string;
}

export interface BusinessProfileDto {
  legalName: string;
  brandName: string;
  fssaiNumber: string;
  gstin: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  phone: string;
  email: string;
  website: string | null;
  bankName: string | null;
  accountName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  quotationTerms: string[];
  quotationValidityDays: number;
  updatedAt: string;
}
