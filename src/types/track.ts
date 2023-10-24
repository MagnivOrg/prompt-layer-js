export interface Request {
  api_key: string;
  provider_type?: string;
  function_name: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
  request_end_time: string;
  request_start_time: string;
  prompt_id?: number;
  prompt_version?: number;
  metadata?: Record<string, string>;
  tags?: string[];
  request_response?: Record<string, unknown>;
  prompt_input_variables?: Record<string, string> | string[];
  [k: string]: unknown;
}

export interface Metadata {
  request_id: number;
  metadata: Record<string, string>;
}

export interface Score {
  request_id: number;
  score: number;
}

export interface Prompt {
  request_id: number;
  prompt_name: string;
  prompt_input_variables: Record<string, unknown>;
  version?: number;
  label?: string;
}

export interface Group {
  request_id: number;
  group_id: number;
}
