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
  status?: "SUCCESS" | "WARNING" | "ERROR";
  error_type?: string;
  error_message?: string;
  [k: string]: unknown;
}

export interface TrackMetadata {
  request_id: number;
  metadata: Record<string, string>;
}

export interface TrackScore {
  request_id: number;
  score: number;
  name?: string;
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
  label?: string;
}

export interface PullSkillCollectionParams {
  label?: string;
  version?: number;
  format?: string;
}

export interface InitialSkillFileUpdate {
  path: string;
  content: string;
  [k: string]: unknown;
}

export interface SkillFileUpdate extends InitialSkillFileUpdate {}

export interface SkillFileMove {
  from: string;
  to: string;
  [k: string]: unknown;
}

export type SkillCollectionProvider =
  | "claude_code"
  | "openai"
  | "openclaw";

export interface PublishSkillCollectionFromFiles {
  name: string;
  folderId?: number;
  provider: SkillCollectionProvider;
  files?: InitialSkillFileUpdate[];
  commitMessage?: string;
}

export type SkillCollectionZipSource = Blob | ArrayBuffer | Uint8Array;

export interface PublishSkillCollectionFromZip {
  name: string;
  zipFile: SkillCollectionZipSource;
  fileName?: string;
  folderId?: number;
  provider: SkillCollectionProvider;
  commitMessage?: string;
}

export type PublishSkillCollection =
  | PublishSkillCollectionFromFiles
  | PublishSkillCollectionFromZip;

export interface SaveSkillCollectionVersion {
  fileUpdates?: SkillFileUpdate[];
  moves?: SkillFileMove[];
  deletes?: string[];
  commitMessage?: string;
  releaseLabel?: string;
  provider?: SkillCollectionProvider;
}

export interface UpdateSkillCollection extends SaveSkillCollectionVersion {
  name?: string;
}

export interface SkillCollection {
  id: string | number;
  name: string;
  provider?: SkillCollectionProvider | null;
  folder_id?: number | null;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}

export interface SkillCollectionVersion {
  id?: string | number;
  version?: number;
  provider?: SkillCollectionProvider | null;
  release_label?: string | null;
  commit_message?: string | null;
  created_at?: string;
  [k: string]: unknown;
}

export interface PublishSkillCollectionResponse {
  success: boolean;
  skill_collection: SkillCollection;
  version?: SkillCollectionVersion | null;
  [k: string]: unknown;
}

export interface PullSkillCollectionResponse {
  success: boolean;
  skill_collection: SkillCollection;
  files: Record<string, string>;
  version: SkillCollectionVersion | null;
  [k: string]: unknown;
}

export interface UpdateSkillCollectionResponse {
  success: boolean;
  skill_collection: SkillCollection;
  version?: SkillCollectionVersion | null;
  [k: string]: unknown;
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
  model_parameter_overrides?: Record<string, unknown>;
  skip_input_variable_rendering?: boolean;
}

const templateFormat = ["f-string", "jinja2"] as const;

export type TemplateFormat = (typeof templateFormat)[number];

export type FileAnnotation = {
  type: "file_citation";
  index: number;
  file_id: string;
  filename: string;
};

export type WebAnnotation = {
  type: "url_citation";
  title: string;
  url: string;
  start_index: number;
  end_index: number;
  cited_text?: string;
  encrypted_index?: string;
};

export type MapAnnotation = {
  type: "map_citation";
  title: string;
  url: string;
  place_id?: string;
  start_index: number;
  end_index: number;
  cited_text?: string;
};

export type ContainerFileAnnotation = {
  type: "container_file_citation";
  container_id: string;
  start_index?: number;
  end_index?: number;
  filename?: string;
  file_id?: string;
};

export type Annotation =
  | WebAnnotation
  | FileAnnotation
  | MapAnnotation
  | ContainerFileAnnotation;

export type ImageUrl = {
  url: string;
  detail?: string;
};

export type TextContent = {
  id?: string;
  type: "text";
  text: string;
  annotations?: Annotation[];
  thought_signature?: string;
};

export type ThinkingContent = {
  id?: string;
  signature?: string;
  type: "thinking";
  thinking: string;
};

export type CodeContent = {
  id?: string;
  container_id?: string;
  type: "code";
  code: string;
  language?: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: ImageUrl;
  image_variable?: string;
};

export type Media = {
  title: string;
  type: string;
  url?: string;
  format?: "base64" | "url" | "neither";
};

export type MediaContent = {
  type: "media";
  media: Media;
};

export type MediaVariable = {
  type: "media_variable";
  name: string;
};

export type OutputMediaContent = {
  type: "output_media";
  id?: string;
  url: string;
  mime_type?: string;
  media_type?: "image" | "video" | "audio";
  provider_metadata?: Record<string, unknown>;
};

export type ServerToolUseContent = {
  type: "server_tool_use";
  id: string;
  name: string;
  input?: Record<string, unknown>;
};

export type WebSearchResult = {
  type: "web_search_result";
  url?: string;
  title?: string;
  encrypted_content?: string;
  page_age?: string;
};

export type WebSearchToolResultContent = {
  type: "web_search_tool_result";
  tool_use_id: string;
  content?: WebSearchResult[];
};

export type CodeExecutionResultContent = {
  type: "code_execution_result";
  output: string;
  outcome?: string;
};

export type McpListToolsContent = {
  type: "mcp_list_tools";
  id?: string;
  server_label?: string;
  tools?: Record<string, unknown>[];
  error?: string | Record<string, unknown>;
};

export type McpCallContent = {
  type: "mcp_call";
  id?: string;
  name?: string;
  server_label?: string;
  arguments?: string;
  output?: string;
  error?: string | Record<string, unknown>;
  approval_request_id?: string;
};

export type McpApprovalRequestContent = {
  type: "mcp_approval_request";
  id?: string;
  name?: string;
  arguments?: string;
  server_label?: string;
};

export type McpApprovalResponseContent = {
  type: "mcp_approval_response";
  approval_request_id: string;
  approve: boolean;
};

export type BashCodeExecutionToolResultContent = {
  type: "bash_code_execution_tool_result";
  tool_use_id: string;
  content?: Record<string, unknown>;
};

export type TextEditorCodeExecutionToolResultContent = {
  type: "text_editor_code_execution_tool_result";
  tool_use_id: string;
  content?: Record<string, unknown>;
};

export type ShellCallContent = {
  type: "shell_call";
  id?: string;
  call_id?: string;
  action?: Record<string, unknown>;
  status?: string;
};

export type ShellCallOutputContent = {
  type: "shell_call_output";
  id?: string;
  call_id?: string;
  output?: Record<string, unknown>[];
  status?: string;
};

export type ApplyPatchCallContent = {
  type: "apply_patch_call";
  id?: string;
  call_id?: string;
  operation?: Record<string, unknown>;
  status?: string;
};

export type ApplyPatchCallOutputContent = {
  type: "apply_patch_call_output";
  id?: string;
  call_id?: string;
  output?: string;
  status?: string;
};

export type Content =
  | TextContent
  | ThinkingContent
  | CodeContent
  | ImageContent
  | MediaContent
  | MediaVariable
  | OutputMediaContent
  | ServerToolUseContent
  | WebSearchToolResultContent
  | CodeExecutionResultContent
  | McpListToolsContent
  | McpCallContent
  | McpApprovalRequestContent
  | McpApprovalResponseContent
  | BashCodeExecutionToolResultContent
  | TextEditorCodeExecutionToolResultContent
  | ShellCallContent
  | ShellCallOutputContent
  | ApplyPatchCallContent
  | ApplyPatchCallOutputContent;

export type Function_ = {
  name: string;
  description: string;
  strict?: boolean;
  parameters: Record<string, unknown>;
};

export type FunctionCall = {
  name: string;
  arguments: string;
};

export type WebSearchToolFilters = {
  allowed_domains?: string[];
};

export type WebSearchToolUserLocation = {
  city?: string;
  country?: string;
  region?: string;
  timezone?: string;
  type: "approximate";
};

export type OpenAIWebSearchToolConfig = {
  type: "web_search" | "web_search_2025_08_26";
  filters?: WebSearchToolFilters;
  search_context_size?: "low" | "medium" | "high";
  user_location?: WebSearchToolUserLocation;
};

export type ComparisonFilter = {
  key: string;
  value: string | number | boolean;
  operation: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
};

export type CompoundFilter = {
  operator: "and" | "or";
  operands: (ComparisonFilter | CompoundFilter)[];
};

export type RankingOptions = {
  ranker?: "auto" | "default-2024-11-15";
  score_threshold?: number;
};

export type FileSearchToolConfig = {
  type: "file_search";
  vector_store_ids: string[];
  filters?: ComparisonFilter | CompoundFilter;
  max_num_results?: number;
  ranking_options?: RankingOptions;
};

export type CodeInterpreterToolConfig = {
  type: "code_interpreter";
  container?: Record<string, unknown>;
};

export type ImageGenerationToolConfig = {
  type: "image_generation";
};

export type ShellToolConfig = {
  type: "shell";
  environment?: Record<string, unknown>;
};

export type ApplyPatchToolConfig = {
  type: "apply_patch";
};

export type McpToolApprovalFilter = {
  tool_names?: string[];
};

export type McpToolApproval = {
  never?: McpToolApprovalFilter;
  always?: McpToolApprovalFilter;
};

export type McpToolConfig = {
  type: "mcp";
  server_label: string;
  server_url?: string;
  server_description?: string;
  connector_id?: string;
  authorization?: string;
  allowed_tools?: string[];
  require_approval?: string | McpToolApproval;
};

export type BuiltInToolConfig =
  | OpenAIWebSearchToolConfig
  | FileSearchToolConfig
  | CodeInterpreterToolConfig
  | ImageGenerationToolConfig
  | McpToolConfig
  | ShellToolConfig
  | ApplyPatchToolConfig;

export type FunctionTool = {
  type: "function";
  function: Function_;
};

export type BuiltInTool = {
  id: string;
  name: string;
  description: string;
  provider: string;
  type:
    | "web_search"
    | "file_search"
    | "code_interpreter"
    | "image_generation"
    | "google_maps"
    | "url_context"
    | "mcp"
    | "bash"
    | "shell"
    | "apply_patch"
    | "text_editor";
  config: BuiltInToolConfig;
};

export type RegistryTool = {
  type: "registry";
  tool_registry_id: number;
  label?: string | null;
  version_number?: number | null;
};

export type Tool = FunctionTool | BuiltInTool | RegistryTool;

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
  tool_id?: string;
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
  content?: Content[];
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
  api_type?: string;
  provider: string;
  model_config_display_name?: string;
  base_model?: string;
  name: string;
  parameters: Record<string, unknown>;
  display_params?: Record<string, string | boolean | null>;
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
  provider_base_url_name?: string;
  report_id?: number;
  inference_client_name?: string;
  provider_id?: number;
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
  score_name?: string;
  api_type?: string;
  status?: "SUCCESS" | "WARNING" | "ERROR";
  error_type?: string;
  error_message?: string;
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
  baseURL: string;
}

export interface WorkflowResponse {
  success?: boolean;
  message?: string;
  error?: string;
  status?: string;
  value?: string;
}

export type ResourceId = string | number;

export enum ColumnType {
  TEXT = "TEXT",
  PROMPT_TEMPLATE = "PROMPT_TEMPLATE",
  LLM_ASSERTION = "LLM_ASSERTION",
  CODE_EXECUTION = "CODE_EXECUTION",
  COMPARE = "COMPARE",
  CONTAINS = "CONTAINS",
  COALESCE = "COALESCE",
  FOR_LOOP = "FOR_LOOP",
  WHILE_LOOP = "WHILE_LOOP",
  JSON_PATH = "JSON_PATH",
  COUNT = "COUNT",
  REGEX = "REGEX",
  COSINE_SIMILARITY = "COSINE_SIMILARITY",
  ASSERT_VALID = "ASSERT_VALID",
  AI_DATA_EXTRACTION = "AI_DATA_EXTRACTION",
  COMPOSITION = "COMPOSITION",
  TRAJECTORY = "TRAJECTORY",
  TRACE = "TRACE",
}

/** String values of {@link ColumnType}. Literal strings remain accepted for compatibility. */
export type ColumnTypeValue = `${ColumnType}`;

export type CellStatus =
  | "PENDING"
  | "QUEUED"
  | "DISPATCHED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "STALE"
  | "SKIPPED";

export interface Table {
  id: ResourceId;
  title: string;
  workspace_id?: number | null;
  folder_id?: number | null;
  sheet_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  [key: string]: unknown;
}

export interface Sheet {
  id: ResourceId;
  table_id?: ResourceId | null;
  title?: string | null;
  index?: number | null;
  row_count?: number | null;
  version_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface ColumnDependency {
  column_id: string;
  reference_type?: string;
  config_key?: string;
  config_meta?: Record<string, unknown>;
}

export interface Column {
  id: ResourceId;
  sheet_id?: ResourceId | null;
  title: string;
  type: ColumnTypeValue | string;
  position_rank?: number | null;
  config?: Record<string, unknown> | null;
  dependencies?: ColumnDependency[] | null;
  is_output_column?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface Cell {
  id: ResourceId;
  sheet_id?: ResourceId | null;
  column_id?: ResourceId | null;
  row_index?: number | null;
  status?: CellStatus | string | null;
  value?: unknown;
  display_value?: string | null;
  [key: string]: unknown;
}

export interface SheetVersion {
  id: ResourceId;
  sheet_id?: ResourceId | null;
  version_number?: number | null;
  snapshot?: Record<string, unknown> | null;
  created_by?: ResourceId | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface TableScore {
  score?: number | null;
  score_configuration?: Record<string, unknown> | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface CreateTable {
  title: string;
  folder_id?: number;
}

export interface UpdateTable {
  title?: string;
  folder_id?: number;
}

export interface CreateSheetFileSource {
  type: "file";
  file_name: string;
  file_content_base64: string;
}

export interface CreateSheetRequestLogsSource {
  type: "request_logs";
  request_log_ids?: number[];
  prompt_id?: number;
  prompt_version_id?: number;
  prompt_label_id?: number;
  start_time?: string;
  end_time?: string;
}

export type CreateSheetSource =
  | CreateSheetFileSource
  | CreateSheetRequestLogsSource;

export interface CreateSheet {
  title?: string;
  index?: number;
  operation_id?: string;
  source?: CreateSheetSource;
}

export interface UpdateSheet {
  title?: string;
}

export interface CreateColumn {
  title: string;
  type: ColumnTypeValue | string;
  config?: Record<string, unknown>;
  dependencies?: ColumnDependency[];
  is_output_column?: boolean;
}

export interface UpdateColumn {
  title?: string;
  type?: ColumnTypeValue | string;
  config?: Record<string, unknown>;
  dependencies?: ColumnDependency[];
  is_output_column?: boolean;
}

export interface AddTableRows {
  count?: number;
  values?: Record<string, unknown>[];
}

export interface DeleteSheetRows {
  row_indices: number[];
}

export interface UpdateCell {
  display_value?: string;
  value?: unknown;
}

export interface CreateSheetVersion {
  name?: string;
}

export interface ConfigureSheetScore {
  score_type?: string;
  score_config?: Record<string, unknown>;
  column_ids?: string[];
  column_names?: string[];
  code?: string;
  code_language?: "PYTHON" | "JAVASCRIPT";
  true_values?: string[];
  false_values?: string[];
  assertion_aggregation?: "all" | "any" | "mean";
  [key: string]: unknown;
}

export interface AddTraceImport {
  trace_id: string;
  sheet_id: ResourceId;
  smart_table_id?: ResourceId;
  table_id?: ResourceId;
  span_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ListTablesParams {
  cursor?: string;
  limit?: number;
  name?: string;
  folder_id?: number;
  page?: number;
  per_page?: number;
}

export interface BatchRecalculateCells {
  cell_ids?: Array<string | number>;
  column_ids?: Array<string | number>;
  row_indices?: number[];
}

export interface CreateSheetOperation {
  operation?: string;
  column_ids?: Array<string | number>;
  row_ids?: number[];
  statuses?: string[];
}

export interface TableListResponse {
  success?: boolean;
  data?: Table[];
  tables?: Table[];
  items?: Table[];
  [key: string]: unknown;
}

export interface TableResponse {
  success?: boolean;
  table?: Table;
  [key: string]: unknown;
}

export interface SheetListResponse {
  success?: boolean;
  data?: Sheet[];
  sheets?: Sheet[];
  items?: Sheet[];
  [key: string]: unknown;
}

export interface SheetResponse {
  success?: boolean;
  sheet?: Sheet;
  [key: string]: unknown;
}

export interface ColumnListResponse {
  success?: boolean;
  data?: Column[];
  columns?: Column[];
  items?: Column[];
  [key: string]: unknown;
}

export interface ColumnResponse {
  success?: boolean;
  column?: Column;
  [key: string]: unknown;
}

export interface CellResponse {
  success?: boolean;
  cell?: Cell;
  [key: string]: unknown;
}

export interface SheetVersionListResponse {
  success?: boolean;
  data?: SheetVersion[];
  versions?: SheetVersion[];
  items?: SheetVersion[];
  [key: string]: unknown;
}

export interface SheetVersionResponse {
  success?: boolean;
  version?: SheetVersion;
  [key: string]: unknown;
}

export interface TableScoreResponse {
  success?: boolean;
  score?: TableScore | number | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface EvalCase<TInput = unknown> {
  input: TInput;
  expected?: unknown;
  /** Wire / Table column title: Expected Trace */
  expectedTrace?: unknown;
}

export interface EvalDatasetRef {
  tableId: ResourceId;
  sheetId?: ResourceId;
}

export type EvalDataset<TInput = unknown> = EvalCase<TInput>[] | EvalDatasetRef;

export interface EvalScorerColumn {
  title: string;
  type: ColumnTypeValue | string;
  config?: Record<string, unknown>;
  weight?: number;
  required?: boolean;
  thresholds?: { pass?: number; warn?: number };
  /** SDK-only metadata; never sent to the Table API. */
  _sdkDiagnosis?: string;
}

export type EvalScorer =
  | EvalScorerColumn
  | ((...args: unknown[]) => unknown);

/** Supporting/preprocessing columns share the same wire shape as scorer defs. */
export type EvalProcessingColumn = EvalScorerColumn;

export interface EvalDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  dataset: EvalDataset<TInput>;
  runner: (input: TInput) => TOutput | Promise<TOutput>;
  scorers: EvalScorer[];
  /** Supporting Table columns created before scorecard scoring. */
  columns?: EvalProcessingColumn[];
  tableId?: ResourceId;
  sheetId?: ResourceId;
  folderId?: number;
  experimentName?: string;
  maxConcurrency?: number;
  passingScore?: number;
  includeFailureExamples?: boolean;
  apiKey?: string;
  baseURL?: string;
}

export interface EvaluateOptions<TInput = unknown, TOutput = unknown>
  extends Omit<EvalDefinition<TInput, TOutput>, "name"> {
  enableTracing?: boolean;
}

export interface EvalCaseResult<TInput = unknown, TOutput = unknown> {
  input: TInput;
  expected?: unknown;
  output: TOutput;
  scores: Record<string, unknown>;
  /** Fetch the full trace via PromptLayer tracing APIs / dashboard. */
  traceId: string | null;
  spanId: string | null;
  rowIndex: number | null;
}

export interface EvalScoreCard {
  scorer: string;
  passed: number;
  total: number;
  passRate: number;
}

export interface EvalResult<TInput = unknown, TOutput = unknown> {
  name: string;
  tableId: ResourceId;
  sheetId: ResourceId;
  failedRowIndices: number[];
  scoreCards: EvalScoreCard[];
  totalRows: number;
  /**
   * Per-case summaries (input/output/scores/ids). Full traces and sheet score
   * payloads are not inlined — refetch with:
   * `client.tables.sheets(tableId).forSheet(sheetId).score.get()`
   * and `...rows.listAll()`, or open `url`.
   */
  results: EvalCaseResult<TInput, TOutput>[];
  url?: string;
}
