export interface GetPromptTemplate {
  prompt_name: string;
  version?: number;
  label?: string;
}

export interface PromptTemplate {
  prompt_template: any;
  metadata: any;
}

export interface PublishPromptTemplate {
  prompt_name: string;
  prompt_template: any;
  commit_message?: string;
  tags?: string[];
  metadata?: any;
}

export interface TrackRequest {
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

export interface TrackMetadata {
  request_id: number;
  metadata: Record<string, string>;
}

export interface TrackScore {
  request_id: number;
  score: number;
}

export interface TrackPrompt {
  request_id: number;
  prompt_name: string;
  prompt_input_variables: Record<string, unknown>;
  version?: number;
  label?: string;
}

export interface TrackGroup {
  request_id: number;
  group_id: number;
}

export interface Pagination {
  page?: number;
  per_page?: number;
}

export interface GetPromptTemplateParams {
  version?: number;
  label?: string;
  provider: string;
  input_variables: Record<string, string>;
}
