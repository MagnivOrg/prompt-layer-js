export interface GetPromptTemplate {
  prompt_name: string;
  version?: number;
  label?: string;
}

export interface LegacyPromptTemplate {
  prompt_template: any;
  metadata: any;
}

export interface LegacyPublishPromptTemplate {
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
  prompt_input_variables?: Record<string, unknown> | string[];
  return_data?: boolean;
  group_id?: number;
  span_id?: string;
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

export interface CustomProvider {
  id: number;
  name: string;
  client: string;
  base_url: string;
  workspace_id: number;
  api_key: string;
}

export interface GetPromptTemplateParams {
  version?: number;
  label?: string;
  provider?: string;
  input_variables?: Record<string, unknown>;
  metadata_filters?: Record<string, string>;
  model?: string;
}

const templateFormat = ["f-string", "jinja2"] as const;

export type TemplateFormat = (typeof templateFormat)[number];

export type ImageUrl = {
  url: string;
};

export type TextContent = {
  type: "text";
  text: string;
};

export type ThinkingContent = {
  signature?: string;
  type: "thinking";
  thinking: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: ImageUrl;
};

export type Media = {
  title: string;
  type: string;
  url: string;
};

export type MediaContent = {
  type: "media";
  media: Media;
};

export type MediaVariable = {
  type: "media_variable";
  name: string;
};

export type Content =
  | TextContent
  | ThinkingContent
  | ImageContent
  | MediaContent
  | MediaVariable;

export type Function_ = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type Tool = {
  type: "function";
  function: Function_;
};

export type FunctionCall = {
  name: string;
  arguments: string;
};

export type SystemMessage = {
  role: "system";
  input_variables?: string[];
  template_format?: TemplateFormat;
  content: Content[];
  name?: string;
};

export type UserMessage = {
  role: "user";
  input_variables?: string[];
  template_format?: TemplateFormat;
  content: Content[];
  name?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: FunctionCall;
};

export type AssistantMessage = {
  role: "assistant";
  input_variables?: string[];
  template_format?: TemplateFormat;
  content?: Content[];
  function_call?: FunctionCall;
  name?: string;
  tool_calls?: ToolCall[];
};

export type FunctionMessage = {
  role: "function";
  input_variables?: string[];
  template_format?: TemplateFormat;
  content?: Content[];
  name: string;
};

export type ToolMessage = {
  role: "tool";
  input_variables?: string[];
  template_format?: TemplateFormat;
  content: Content[];
  tool_call_id: string;
  name?: string;
};

export type PlaceholderMessage = {
  role: "placeholder";
  name: string;
};

export type DeveloperMessage = {
  role: "developer";
  input_variables?: string[];
  template_format?: TemplateFormat;
  content: Content[];
};

export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | FunctionMessage
  | ToolMessage
  | PlaceholderMessage
  | DeveloperMessage;

export type ChatFunctionCall = {
  name: string;
};

export type CompletionPromptTemplate = {
  type: "completion";
  template_format?: TemplateFormat;
  content: Content[];
  input_variables?: string[];
};

export type ChatToolChoice = {
  type: "function";
  function: ChatFunctionCall;
};

export type ToolChoice = string | ChatToolChoice;

export type ChatPromptTemplate = {
  type: "chat";
  messages: Message[];
  functions?: Function_[];
  function_call?: "auto" | "none" | ChatFunctionCall;
  input_variables?: string[];
  tools?: Tool[];
  tool_choice?: ToolChoice;
};

export type PromptTemplate = CompletionPromptTemplate | ChatPromptTemplate;

export type Model = {
  provider: string;
  name: string;
  parameters: Record<string, unknown>;
};

export type Metadata = {
  model?: Model;
};

export type BasePromptTemplate = {
  prompt_name: string;
  tags?: string[];
};

export type PromptBlueprint = {
  prompt_template: PromptTemplate;
  commit_message?: string;
  metadata?: Metadata;
};

export type PublishPromptTemplate = BasePromptTemplate &
  PromptBlueprint & { release_labels?: string[] };

export interface ProviderBaseURL {
  id: number;
  name: string;
  provider: string;
  url: string;
}

export interface BasePromptTemplateResponse {
  id: number;
  prompt_name: string;
  tags: string[];
  prompt_template: PromptTemplate;
  commit_message?: string;
  metadata?: Metadata;
  provider_base_url?: ProviderBaseURL;
  custom_provider?: CustomProvider;
}

export interface PublishPromptTemplateResponse
  extends BasePromptTemplateResponse {}

export interface GetPromptTemplateResponse extends BasePromptTemplateResponse {
  version: number;
  llm_kwargs: Record<string, unknown> | null;
}

export interface ListPromptTemplatesResponse
  extends BasePromptTemplateResponse {
  version: number;
}

export interface RunRequest {
  promptName: string;
  tags?: string[];
  metadata?: Record<string, string>;
  groupId?: number;
  stream?: boolean;
  promptVersion?: number;
  promptReleaseLabel?: string;
  inputVariables?: Record<string, unknown>;
  modelParameterOverrides?: Record<string, unknown>;
  provider?: string;
  model?: string;
}

export interface LogRequest {
  provider: string;
  model: string;
  input: PromptTemplate;
  output: PromptTemplate;
  request_start_time: number;
  request_end_time: number;
  parameters?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, string>;
  prompt_name?: string;
  prompt_version_number?: number;
  prompt_input_variables?: Record<string, unknown>;
  input_tokens?: number;
  output_tokens?: number;
  price?: number;
  function_name?: string;
  score?: number;
  prompt_id?: number;
}

export interface RequestLog {
  id: number;
  prompt_version: PromptBlueprint;
}

export interface WorkflowRequest {
  workflowName: string;
  inputVariables?: Record<string, any>;
  metadata?: Record<string, string>;
  workflowLabelName?: string | null;
  workflowVersion?: number | null;
  returnAllOutputs?: boolean;
}

export interface RunWorkflowRequestParams {
  workflow_name: string;
  input_variables: Record<string, any>;
  metadata?: Record<string, string>;
  workflow_label_name?: string | null;
  workflow_version_number?: number | null;
  return_all_outputs?: boolean;
  api_key: string;
  timeout?: number;
}

export interface WorkflowResponse {
  success?: boolean;
  message?: string;
  error?: string;
  status?: string;
  value?: string;
}
