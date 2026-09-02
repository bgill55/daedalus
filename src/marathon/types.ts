export type MarathonStatus =
  | 'planning'
  | 'running'
  | 'paused'
  | 'evaluating'
  | 'completed'
  | 'aborted'
  | 'failed';

export type MilestoneStatus =
  | 'pending'
  | 'in_progress'
  | 'verifying'
  | 'passed'
  | 'failed'
  | 'rolled_back';

export interface MilestoneCriterionResult {
  criterion: string;
  satisfied: boolean;
  note?: string;
}

export interface MarathonEvaluationReport {
  passed: boolean;
  score: number;
  summary: string;
  regressions: string[];
  criteriaResults: MilestoneCriterionResult[];
  repairRecommendations: string[];
  evaluatedAt: string;
}

export interface MarathonMilestone {
  id: string;
  title: string;
  description: string;
  targetFiles: string[];
  acceptanceCriteria: string[];
  verifyCommand?: string;
  status: MilestoneStatus;
  gitTag?: string;
  gitCommit?: string;
  attempts: number;
  maxAttempts: number;
  antiPatternIds?: string[];
  evalReport?: MarathonEvaluationReport;
  startedAt?: string;
  completedAt?: string;
}

export interface MarathonMetrics {
  totalIterations: number;
  totalRollbacks: number;
  totalEvaluations: number;
  totalTokensUsed?: number;
}

export interface MarathonRun {
  id: string;
  macroGoal: string;
  baseBranch: string;
  marathonBranch: string;
  status: MarathonStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  activeMilestoneIndex: number;
  milestones: MarathonMilestone[];
  roadmapPath: string;
  metrics: MarathonMetrics;
}