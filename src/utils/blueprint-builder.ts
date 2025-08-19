const _buildToolCall = (id: string, name: string, input: any) => {
  return {
    id,
    function: {
      name,
      input,
    },
  };
};

const _buildContentBlock = ({
  type,
  ...rest
}: {
  type: string;
  [key: string]: any;
}) => {
  return {
    type,
    ...rest,
  };
};

const _buildAssistantMessage = (content: any[], tool_calls: any[]) => {
  return {
    input_variables: [],
    template_format: "f-string" as const,
    content: content,
    role: "assistant" as const,
    function_call: null,
    name: null,
    tool_calls: tool_calls,
  };
};

const _buildPromptTemplate = (assistantMessage: any, metadata: any) => {
  const promptTemplate = {
    messages: [assistantMessage],
    type: "chat" as const,
    input_variables: [],
  };

  return {
    prompt_template: promptTemplate,
    metadata: metadata,
  };
};

export const buildPromptBlueprintFromAnthropicEvent = (
  event: any,
  metadata: any
) => {
  const assistantContent: any[] = [];
  const tool_calls: any[] = [];

  if (event.type === "content_block_start") {
    if (event.content_block.type === "thinking") {
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          thinking: "",
          signature: "",
        })
      );
    } else if (event.content_block.type === "text") {
      assistantContent.push(
        _buildContentBlock({
          type: "text",
          text: "",
        })
      );
    } else if (event.content_block.type === "tool_use") {
      tool_calls.push(
        _buildToolCall(
          event.content_block.id || "",
          event.content_block.name || "",
          {}
        )
      );
    }
  } else if (event.type === "content_block_delta") {
    if (event.delta.type === "thinking_delta") {
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          thinking: event.delta.thinking || "",
          signature: "",
        })
      );
    } else if (event.delta.type === "text_delta") {
      assistantContent.push(
        _buildContentBlock({
          type: "text",
          text: event.delta.text || "",
        })
      );
    } else if (event.delta.type === "signature_delta") {
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          thinking: "",
          signature: event.delta.signature || "",
        })
      );
    } else if (event.delta.type === "input_json_delta") {
      tool_calls.push(_buildToolCall("", "", event.delta.partial_json));
    }
  }

  const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls);
  return _buildPromptTemplate(assistantMessage, metadata);
};

export const buildPromptBlueprintFromGoogleEvent = (
  event: any,
  metadata: any
) => {
  const assistantContent: any[] = [];
  const tool_calls: any[] = [];

  for (const candidate of event.candidates) {
    if (
      candidate.content &&
      candidate.content.parts &&
      Array.isArray(candidate.content.parts)
    ) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          if (part.thought === true) {
            assistantContent.push(
              _buildContentBlock({
                type: "thinking",
                thinking: part.text,
                signature: part.thoughtSignature || "",
              })
            );
          } else {
            assistantContent.push(
              _buildContentBlock({
                type: "text",
                text: part.text,
              })
            );
          }
        } else if (part.functionCall) {
          tool_calls.push(
            _buildToolCall(
              part.functionCall.id || "",
              part.functionCall.name || "",
              part.functionCall.args || {}
            )
          );
        }
      }
    }
  }

  const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls);
  return _buildPromptTemplate(assistantMessage, metadata);
};

export const buildPromptBlueprintFromOpenAIEvent = (
  event: any,
  metadata: any
) => {
  const assistantContent: any[] = [];
  const tool_calls: any[] = [];

  for (const choice of event.choices) {
    if (choice.delta) {
      if (choice.delta.content) {
        assistantContent.push(
          _buildContentBlock({
            type: "text",
            text: choice.delta.content,
          })
        );
      }
      const toolCalls = choice.delta.tool_calls || choice.delta.toolCalls;
      if (toolCalls && Array.isArray(toolCalls)) {
        for (const toolCall of toolCalls) {
          if (toolCall.function) {
            tool_calls.push(
              _buildToolCall(
                toolCall.id || "",
                toolCall.function.name || "",
                toolCall.function.arguments || ""
              )
            );
          }
        }
      }
    }
  }

  const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls);
  return _buildPromptTemplate(assistantMessage, metadata);
};


export const buildPromptBlueprintFromBedrockEvent = (
  event: any,
  metadata: any
) => {
  const assistantContent: any[] = [];
  const tool_calls: any[] = [];

  if ("contentBlockDelta" in event) {
    const delta = event.contentBlockDelta?.delta || {};

    if ("reasoningContent" in delta) {
      const reasoningText = delta.reasoningContent?.text || "";
      const signature = delta.reasoningContent?.signature || "";
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          thinking: reasoningText,
          signature: signature,
        })
      );
    } else if ("text" in delta) {
      assistantContent.push(
        _buildContentBlock({
          type: "text",
          text: delta.text || "",
        })
      );
    } else if ("toolUse" in delta) {
      const toolUse = delta.toolUse || {};
      tool_calls.push(
        _buildToolCall(
          toolUse.toolUseId || "",
          toolUse.name || "",
          toolUse.input || ""
        )
      );
    }
  } else if ("contentBlockStart" in event) {
    const startBlock = event.contentBlockStart?.start || {};

    if ("toolUse" in startBlock) {
      const toolUse = startBlock.toolUse || {};
      tool_calls.push(
        _buildToolCall(
          toolUse.toolUseId || "",
          toolUse.name || "",
          ""
        )
      );
    }
  }

  const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls);
  return _buildPromptTemplate(assistantMessage, metadata);
};
