export interface AnalyticsReport {
  uptime: string;
  totalInteractions: number;
  totalErrors: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCalls?: number;
  lastModel?: string;
  lastTier?: string;
  indexedFiles?: number;
  routerProvider?: string;
  routerStatus?: string;
}

export class SessionStats {
  private startTime: Date = new Date();
  private interactions: number = 0;
  private errors: number = 0;
  private promptTokensCount: number = 0;
  private completionTokensCount: number = 0;
  private toolCallsCount: number = 0;
  private lastModel?: string;
  private lastTier?: string;

  public recordInteraction(promptTokens: number = 0, completionTokens: number = 0, isError: boolean = false): void {
    this.interactions += 1;
    this.promptTokensCount += promptTokens;
    this.completionTokensCount += completionTokens;
    if (isError) {
      this.errors += 1;
    }
  }

  public recordToolCall(count: number = 1): void {
    this.toolCallsCount += count;
  }

  public setLastModel(model?: string, tier?: string): void {
    if (model) this.lastModel = model;
    if (tier) this.lastTier = tier;
  }

  public getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }

  public getFormattedUptime(): string {
    const totalSecs = this.getUptimeSeconds();
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  public getReport(): AnalyticsReport {
    return {
      uptime: this.getFormattedUptime(),
      totalInteractions: this.interactions,
      totalErrors: this.errors,
      promptTokens: this.promptTokensCount,
      completionTokens: this.completionTokensCount,
      totalTokens: this.promptTokensCount + this.completionTokensCount,
      toolCalls: this.toolCallsCount,
      lastModel: this.lastModel,
      lastTier: this.lastTier,
    };
  }
}

export const globalSessionStats = new SessionStats();
