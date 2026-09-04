export interface IServerConfig {
  /** Port on which the server should listen */
  port: number;
  /** Optional hostname; defaults to 'localhost' */
  host?: string;
  /** Flag indicating whether HTTPS should be used */
  secure?: boolean;
}

export interface IRequest {
  /** HTTP method, e.g., 'GET', 'POST' */
  method: string;
  /** URL path, e.g., '/api/status' */
  path: string;
  /** Optional JSON payload for POST/PUT */
  body?: any;
}

export interface IResponse {
  /** HTTP status code */
  status: number;
  /** JSON payload returned to the client */
  data: any;
}

export interface WebuiChatMessageEvent {
  type: 'chat_token' | 'chat_tool_start' | 'chat_tool_result' | 'chat_done' | 'chat_error';
  id?: string;
  text?: string;
  role?: 'user' | 'assistant' | 'system';
  tool?: string;
  content?: string;
  timestamp: number;
  imageBase64?: string;
}

export interface WebuiChatRequest {
  message: string;
  role?: string;
  imageBase64?: string;
  fileName?: string;
}

export interface FileNode {
  name: string;
  type: 'file' | 'dir';
  path: string;
  children?: FileNode[];
}