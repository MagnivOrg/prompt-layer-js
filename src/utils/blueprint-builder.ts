const _buildToolCall = (id: string, name: string, input: any, tool_id?: string) => {
  const toolCall = {
    id,
    function: {
      name,
      input,
    },
  };
  if (tool_id) {
    (toolCall as any).tool_id = tool_id;
  }
  return toolCall;
};

const _buildContentBlock = ({
  type,
  item_id,
  ...rest
}: {
  type: string;
  item_id?: string;
  [key: string]: any;
}) => {
  const contentBlock: any = {
    type,
    ...rest,
  };
  if (item_id) {
    contentBlock.item_id = item_id;
  }
  return contentBlock;
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

export const buildPromptBlueprintFromOpenAIResponsesEvent = (
  event: any,
  metadata: any
) => {
  const assistantContent: any[] = [];
  const tool_calls: any[] = [];

  const event_type: string | undefined = event?.type;

  if (event_type === "response.reasoning_summary_text.delta") {
    const delta: string = event?.delta ?? "";
    const item_id: string = event?.item_id ?? "";
    if (delta) {
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          item_id: item_id,
          thinking: delta,
          signature: "",
        })
      );
    }
  } else if (event_type === "response.reasoning_summary_text.done") {
    const final_text: string = event?.text ?? "";
    const item_id: string = event?.item_id ?? "";
    if (final_text) {
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          item_id: item_id,
          thinking: final_text,
          signature: "",
        })
      );
    }
  } else if (event_type === "response.reasoning_summary_part.added") {
    const part = event?.part ?? {};
    const item_id: string = event?.item_id ?? "";
    if (part?.type === "summary_text") {
      const text: string = part?.text ?? "";
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          item_id: item_id,
          thinking: text,
          signature: "",
        })
      );
    }
  } else if (event_type === "response.reasoning_summary_part.done") {
    const part = event?.part ?? {};
    const item_id: string = event?.item_id ?? "";
    if (part?.type === "summary_text") {
      const text: string = part?.text ?? "";
      if (text) {
        assistantContent.push(
          _buildContentBlock({
            type: "thinking",
            item_id: item_id,
            thinking: text,
            signature: "",
          })
        );
      }
    }
  } else if (event_type === "response.function_call_arguments.delta") {
    const item_id: string = event?.item_id ?? "";
    const delta: string = event?.delta ?? "";
    if (delta) {
      tool_calls.push(_buildToolCall("", "", delta, item_id));
    }
  } else if (event_type === "response.function_call_arguments.done") {
    const item_id: string = event?.item_id ?? "";
    const final_arguments: string = event?.arguments ?? "";
    if (final_arguments) {
      tool_calls.push(_buildToolCall("", "", final_arguments, item_id));
    }
  } else if (event_type === "response.output_item.added") {
    const item = event?.item ?? {};
    const item_type: string | undefined = item?.type;
    const item_id: string = item?.id ?? "";

    if (item_type === "reasoning") {
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          thinking: "",
          signature: "",
          item_id: item_id,
        })
      );
    } else if (item_type === "function_call") {
      tool_calls.push(
        _buildToolCall(item?.call_id || "", item?.name || "", "", item_id)
      );
    } else if (item_type === "message") {
      assistantContent.push(
        _buildContentBlock({
          type: "text",
          item_id: item_id,
          text: "",
        })
      );
    }
  } else if (event_type === "response.content_part.added") {
    const part = event?.part ?? {};
    const part_type: string = part?.type ?? "output_text";
    const item_id: string = event?.item_id ?? "";

    if (part_type === "output_text") {
      assistantContent.push(
        _buildContentBlock({
          type: "text",
          item_id: item_id,
          text: part?.text ?? "",
          annotations: part?.annotations || [],
        })
      );
    }
  } else if (event_type === "response.output_text.annotation.added") {
    const annotation = event?.annotation || {};
    const atype = annotation?.type;
    let mapped_annotation = null;

    if (atype === "url_citation") {
      mapped_annotation = {
        type: "url_citation",
        title: annotation?.title,
        url: annotation?.url,
        start_index: annotation?.start_index,
        end_index: annotation?.end_index,
      }
    }
    else if (atype == "file_citation") {
      mapped_annotation = {
        type: "file_citation",
        index: annotation?.index,
        file_id: annotation?.file_id,
        filename: annotation?.filename,
      }
    }
    else {
      mapped_annotation = annotation
    }

    assistantContent.push(
      _buildContentBlock({
        type: "text",
        item_id: event?.item_id ?? "",
        text: "",
        annotations: [mapped_annotation],
      })
    );
  } else if (event_type === "response.output_text.delta") {
    const delta_text: string = event?.delta ?? "";

    if (delta_text) {
      assistantContent.push(
        _buildContentBlock({
          type: "text",
          item_id: event?.item_id ?? "",
          text: delta_text,
        })
      );
    }
  } else if (event_type === "response.output_text.done") {
    const final_text: string = event?.text ?? "";

    if (final_text) {
      assistantContent.push(
        _buildContentBlock({
          type: "text",
          item_id: event?.item_id ?? "",
          text: final_text,
        })
      );
    }
  } else if (event_type === "response.output_item.done") {
    const item = event?.item ?? {};
    const item_type: string | undefined = item?.type;
    const item_id: string = item?.id ?? "";

    if (item_type === "reasoning") {
      const summary: any[] = item?.summary ?? [];
      for (const summary_part of summary) {
        if (summary_part?.type === "summary_text") {
          const text: string = summary_part?.text ?? "";
          if (text) {
            assistantContent.push(
              _buildContentBlock({
                type: "thinking",
                item_id: item_id,
                thinking: text,
                signature: "",
              })
            );
          }
        }
      }
    } else if (item_type === "function_call") {
      tool_calls.push(
        _buildToolCall(
          item?.call_id || "",
          item?.name || "",
          item?.arguments || "",
          item_id
        )
      );
    } else if (item_type === "message") {
      const content: any[] = item?.content ?? [];
      for (const content_part of content) {
        if (content_part?.type === "output_text") {
          const text: string = content_part?.text ?? "";
          if (text) {
            assistantContent.push(
              _buildContentBlock({
                type: "text",
                item_id: item_id,
                text,
              })
            );
          }
        }
      }
    }
  }

  const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls || []);
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
