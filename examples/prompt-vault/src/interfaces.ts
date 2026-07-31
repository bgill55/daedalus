export { Prompt, VariableMap, SearchResult, TagPill } from "./types";

export interface Prompt {
  id: string;
  name: string;
  tags: string[];
  template: string;
  variables: string[];
}