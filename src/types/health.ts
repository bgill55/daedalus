export type ProviderStatus = 'UP' | 'DOWN' | 'UNKNOWN';

export interface ProviderHealth {
  status: ProviderStatus;
  avgLatencyMs: number | null;
  apiKey: string; // masked or "MISSING"
}

export interface HealthPayload {
  routerStrategy: string;
  providers: Record<string, ProviderHealth>;
}
