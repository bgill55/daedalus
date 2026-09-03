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