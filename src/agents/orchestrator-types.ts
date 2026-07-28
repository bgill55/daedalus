export interface DelegationTask {
  goal: string;
  context: string;
  role: string;
  toolsets?: string[];
  dependencies?: string[];
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  error?: string;
  splitDepth?: number;
}

export interface AgentResult {
  role: string;
  goal: string;
  summary: string;
  success: boolean;
  evidence?: string;
}

export const PLACEHOLDER_RE = /\[(?:YEAR|Year|year|YYYY|yyyy|DATE|Date|date|TODAY|Today|today|YOUR\s+NAME|Your\s+Name|your\s+name|FULLNAME|Fullname|fullname|AUTHOR|Author|author|USERNAME|Username|username|OWNER|Owner|owner)\]/i;

export const HTML_PLACEHOLDER_RE = /<!--[^>]*?(?:YEAR|Year|year|DATE|Date|date|YOUR\s+NAME|Your\s+Name|your\s+name)\s*-->/i;
