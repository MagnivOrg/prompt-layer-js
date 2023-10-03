export type ApiKey = string;
export type ProviderType = "openai" | "anthropic" | "langchain";
export type FunctionName = string;
export type Args = unknown[];
export type RequestEndTime = string;
export type RequestStartTime = string;
export type PromptId = number;
export type PromptVersion = number;
export type Tags = string[];
export type PromptInputVariables =
  | {
      [k: string]: string;
    }
  | string[];

export interface TrackRequest {
  api_key: ApiKey;
  provider_type?: ProviderType;
  function_name: FunctionName;
  args?: Args;
  kwargs?: Kwargs;
  request_end_time: RequestEndTime;
  request_start_time: RequestStartTime;
  prompt_id?: PromptId;
  prompt_version?: PromptVersion;
  metadata?: Metadata;
  tags?: Tags;
  request_response?: RequestResponse;
  prompt_input_variables?: PromptInputVariables;
  [k: string]: unknown;
}
export interface Kwargs {
  [k: string]: unknown;
}
export interface Metadata {
  [k: string]: string;
}
export interface RequestResponse {
  [k: string]: unknown;
}
