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

const templateFormat = ["f-string", "jinja2"] as const;

export type TemplateFormat = (typeof templateFormat)[number];

export type ImageUrl = {
  url: string;
};

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: ImageUrl;
};

export type Content = TextContent | ImageContent;

export type Function_ = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type FunctionCall = {
  name: string;
  arguments: string;
};

export type SystemMessage = {
  role: "system";
  template_format?: TemplateFormat;
  content: Content[];
  name?: string;
};

export type UserMessage = {
  role: "user";
  template_format?: TemplateFormat;
  content: Content[];
  name?: string;
};

export type AssistantMessage = {
  role: "assistant";
  template_format?: TemplateFormat;
  content?: Content[];
  function_call?: FunctionCall;
  name?: string;
};

export type FunctionMessage = {
  role: "function";
  template_format?: TemplateFormat;
  content?: Content[];
  name: string;
};

export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | FunctionMessage;

export type ChatFunctionCall = {
  name: string;
};

export type CompletionPromptTemplate = {
  type: "completion";
  template_format?: TemplateFormat;
  content: Content[];
};

export type ChatPromptTemplate = {
  type: "chat";
  messages: Message[];
  functions?: Function_[];
  function_call?: "auto" | "none" | ChatFunctionCall;
};

export type PromptTemplate = CompletionPromptTemplate | ChatPromptTemplate;

export type PublishPromptTemplate = {
  prompt_name: string;
  prompt_template: PromptTemplate;
};

export type PublishPromptTemplateResponse = PublishPromptTemplate & {
  id: number;
};
