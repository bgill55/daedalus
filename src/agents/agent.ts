// Base Agent interface for Daedalus sub-agents

export interface Agent {
  /**
   * Run the agent on a given goal.
   * @param goal The high-level task description.
   * @param context Optional additional context (e.g., list of active files).
   * @returns A string summary of what the agent accomplished.
   */
  run(goal: string, context?: string): Promise<string>;
}
