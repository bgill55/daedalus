export interface Prompt {
  id: string;
  name: string;
  tags: string[];
  template: string;
  variables: string[];
}

export interface VariableMap {
  [key: string]: string;
}

export interface SearchResult {
  prompt: Prompt;
  score: number;
}

export interface TagPill {
  name: string;
  count: number;
}