import fs from 'fs';
import path from 'path';
import { MarathonRun, MarathonMilestone, MilestoneStatus } from './types.js';

export function getMarathonDir(projectRoot: string): string {
  return path.join(projectRoot, '.daedalus');
}

export function getMarathonStatePath(projectRoot: string): string {
  return path.join(getMarathonDir(projectRoot), 'marathon.json');
}

export function getRoadmapPath(projectRoot: string): string {
  return path.join(projectRoot, 'MARATHON_ROADMAP.md');
}

export function loadMarathonRun(projectRoot: string): MarathonRun | null {
  const file = getMarathonStatePath(projectRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as MarathonRun;
  } catch {
    return null;
  }
}

export function saveMarathonRun(projectRoot: string, run: MarathonRun): void {
  const dir = getMarathonDir(projectRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  run.updatedAt = new Date().toISOString();
  fs.writeFileSync(getMarathonStatePath(projectRoot), JSON.stringify(run, null, 2), 'utf8');
  saveRoadmapFile(projectRoot, run);
}

export function initMarathonRun(
  projectRoot: string,
  macroGoal: string,
  baseBranch: string,
  milestones: MarathonMilestone[] = []
): MarathonRun {
  const slug = macroGoal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  const runId = `marathon-${Date.now()}-${slug || 'run'}`;
  const marathonBranch = `marathon/${slug || 'main'}`;

  const run: MarathonRun = {
    id: runId,
    macroGoal,
    baseBranch,
    marathonBranch,
    status: 'planning',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeMilestoneIndex: 0,
    milestones,
    roadmapPath: getRoadmapPath(projectRoot),
    metrics: {
      totalIterations: 0,
      totalRollbacks: 0,
      totalEvaluations: 0,
    },
  };

  saveMarathonRun(projectRoot, run);
  return run;
}

export function updateMilestoneStatus(
  run: MarathonRun,
  milestoneId: string,
  status: MilestoneStatus,
  details?: Partial<MarathonMilestone>
): MarathonRun {
  const milestone = run.milestones.find((m) => m.id === milestoneId);
  if (!milestone) return run;

  milestone.status = status;
  if (details) {
    Object.assign(milestone, details);
  }

  if (status === 'in_progress' && !milestone.startedAt) {
    milestone.startedAt = new Date().toISOString();
  }
  if (status === 'passed' && !milestone.completedAt) {
    milestone.completedAt = new Date().toISOString();
  }

  return run;
}

export function advanceToNextMilestone(run: MarathonRun): boolean {
  if (run.activeMilestoneIndex < run.milestones.length - 1) {
    run.activeMilestoneIndex += 1;
    return true;
  }
  run.status = 'completed';
  run.completedAt = new Date().toISOString();
  return false;
}

export function renderRoadmapMarkdown(run: MarathonRun): string {
  const completed = run.milestones.filter((m) => m.status === 'passed').length;
  const total = run.milestones.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const lines: string[] = [];
  lines.push(`# Marathon Roadmap: ${run.macroGoal}`);
  lines.push('');
  lines.push(`- **Status**: \`${run.status.toUpperCase()}\``);
  lines.push(`- **Progress**: ${completed}/${total} milestones passed (${pct}%)`);
  lines.push(`- **Base Branch**: \`${run.baseBranch}\``);
  lines.push(`- **Integration Branch**: \`${run.marathonBranch}\``);
  lines.push(`- **Last Updated**: ${run.updatedAt}`);
  lines.push('');
  lines.push('## Milestones');
  lines.push('');

  for (let i = 0; i < run.milestones.length; i++) {
    const m = run.milestones[i];
    const isCurrent = i === run.activeMilestoneIndex && run.status === 'running';
    let icon = '[ ]';
    if (m.status === 'passed') icon = '[x]';
    else if (m.status === 'in_progress') icon = '[>]';
    else if (m.status === 'failed') icon = '[!]';
    else if (m.status === 'rolled_back') icon = '[<]';

    lines.push(`### ${icon} ${m.id.toUpperCase()}: ${m.title}${isCurrent ? '  *(Active)*' : ''}`);
    lines.push('');
    lines.push(`${m.description}`);
    lines.push('');
    if (m.targetFiles.length > 0) {
      lines.push(`- **Target Files**: ${m.targetFiles.map((f) => '`' + f + '`').join(', ')}`);
    }
    if (m.gitTag) {
      lines.push(`- **Git Tag**: \`${m.gitTag}\``);
    }
    lines.push(`- **Attempts**: ${m.attempts}/${m.maxAttempts}`);
    lines.push('');
    lines.push('**Acceptance Criteria:**');
    for (const c of m.acceptanceCriteria) {
      const match = m.evalReport?.criteriaResults?.find((cr) => cr.criterion === c);
      const mark = match ? (match.satisfied ? '[x]' : '[ ]') : (m.status === 'passed' ? '[x]' : '[ ]');
      lines.push(`- ${mark} ${c}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function saveRoadmapFile(projectRoot: string, run: MarathonRun): string {
  const content = renderRoadmapMarkdown(run);
  const target = getRoadmapPath(projectRoot);
  try {
    fs.writeFileSync(target, content, 'utf8');
  } catch {
    // Best-effort write
  }
  return target;
}