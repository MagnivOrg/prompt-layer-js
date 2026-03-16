import type {
  Annotation,
  AssistantMessage,
  ChatPromptTemplate,
  CompletionPromptTemplate,
  Content,
  FileAnnotation,
  MapAnnotation,
  Metadata,
  PromptBlueprint,
  ToolCall,
  WebAnnotation,
} from "../types";

const OUTPUT_FORMAT_TO_MIME: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  url: "image/png",
};

const _buildToolCall = (
  id: string,
  name: string,
  args: unknown,
  tool_id?: string
): ToolCall => ({
  id,
  type: "function",
  function: {
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  },
  ...(tool_id ? { tool_id } : {}),
});

const _buildContentBlock = ({
  type,
  item_id,
  ...rest
}: {
  type: string;
  item_id?: string;
  [key: string]: any;
}): Content => {
  const contentBlock: Record<string, any> = {
    type,
    ...rest,
  };
  if (item_id) {
    contentBlock.id = item_id;
  }
  return contentBlock as Content;
};

const _buildAssistantMessage = (
  content: Content[],
  tool_calls: ToolCall[]
): AssistantMessage => ({
  role: "assistant",
  input_variables: [],
  template_format: "f-string",
  content,
  tool_calls,
});

const _buildPromptTemplate = (
  assistantMessage: AssistantMessage,
  metadata: Metadata
): PromptBlueprint => {
  const promptTemplate: ChatPromptTemplate = {
    messages: [assistantMessage],
    type: "chat",
    input_variables: [],
  };

  return {
    prompt_template: promptTemplate,
    metadata: metadata,
  };
};

function _parseAnthropicWebAnnotation(c: Record<string, unknown>): WebAnnotation {
  return {
    type: "url_citation",
    url: (c.url as string) ?? "",
    title: (c.title as string) ?? "",
    start_index: (c.start_index as number) ?? 0,
    end_index: (c.end_index as number) ?? 0,
    ...(c.cited_text != null ? { cited_text: c.cited_text as string } : {}),
    ...(c.encrypted_index != null ? { encrypted_index: c.encrypted_index as string } : {}),
  };
}

export const buildPromptBlueprintFromAnthropicEvent = (
  event: any,
  metadata: Metadata,
  blockTypeByIndex?: Record<number, string>
): PromptBlueprint => {
  const assistantContent: Content[] = [];
  const tool_calls: ToolCall[] = [];

  // Merged message (from anthropicStreamMessage): event.content is array of blocks
  if (Array.isArray(event.content)) {
    for (const block of event.content) {
      if (!block || typeof block !== "object") continue;
      const blockType = block.type;
      if (blockType === "text") {
        const text = block.text ?? "";
        const rawCitations = block.citations ?? block.annotations ?? [];
        const annotations: WebAnnotation[] = [];
        for (const c of rawCitations) {
          if (c && typeof c === "object") annotations.push(_parseAnthropicWebAnnotation(c as Record<string, unknown>));
        }
        assistantContent.push(
          _buildContentBlock({
            type: "text",
            text,
            ...(annotations.length > 0 ? { annotations } : {}),
          })
        );
      } else if (blockType === "thinking") {
        assistantContent.push(
          _buildContentBlock({
            type: "thinking",
            thinking: block.thinking ?? "",
            signature: block.signature ?? "",
          })
        );
      } else if (blockType === "tool_use") {
        tool_calls.push(
          _buildToolCall(
            block.id ?? "",
            block.name ?? "",
            block.input ?? {}
          )
        );
      } else if (blockType === "server_tool_use") {
        assistantContent.push(
          _buildContentBlock({
            type: "server_tool_use",
            id: block.id ?? "",
            name: block.name ?? "",
            input: block.input ?? {},
          })
        );
      } else if (blockType === "web_search_tool_result") {
        const contentList = block.content ?? [];
        const searchResults: Array<{ type: "web_search_result"; url?: string; title?: string; encrypted_content?: string; page_age?: string }> = [];
        for (const r of contentList) {
          if (r && typeof r === "object" && (r as Record<string, unknown>).type === "web_search_result") {
            const rr = r as Record<string, unknown>;
            searchResults.push({
              type: "web_search_result",
              url: rr.url as string | undefined,
              title: rr.title as string | undefined,
              encrypted_content: rr.encrypted_content as string | undefined,
              page_age: rr.page_age as string | undefined,
            });
          }
        }
        assistantContent.push(
          _buildContentBlock({
            type: "web_search_tool_result",
            tool_use_id: block.tool_use_id ?? "",
            content: searchResults,
          })
        );
      } else if (blockType === "bash_code_execution_tool_result") {
        assistantContent.push(
          _buildContentBlock({
            type: "bash_code_execution_tool_result",
            tool_use_id: block.tool_use_id ?? "",
            content: (block.content as Record<string, unknown>) ?? {},
          })
        );
      }
    }
    const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls);
    return _buildPromptTemplate(assistantMessage, metadata);
  }

  // Single stream events (content_block_start / content_block_delta)
  if (event.type === "content_block_start") {
    if (event.content_block?.type === "thinking") {
      assistantContent.push(
        _buildContentBlock({ type: "thinking", thinking: "", signature: "" })
      );
    } else if (event.content_block?.type === "text") {
      assistantContent.push(_buildContentBlock({ type: "text", text: "" }));
    } else if (event.content_block?.type === "tool_use") {
      tool_calls.push(
        _buildToolCall(
          event.content_block.id ?? "",
          event.content_block.name ?? "",
          {}
        )
      );
    } else if (event.content_block?.type === "server_tool_use") {
      assistantContent.push(
        _buildContentBlock({
          type: "server_tool_use",
          id: event.content_block.id ?? "",
          name: event.content_block.name ?? "",
          input: event.content_block.input ?? {},
        })
      );
    } else if (event.content_block?.type === "web_search_tool_result") {
      const contentList = event.content_block.content ?? [];
      const searchResults: Array<{ type: "web_search_result"; url?: string; title?: string; encrypted_content?: string; page_age?: string }> = [];
      for (const r of contentList) {
        if (r && typeof r === "object" && (r as Record<string, unknown>).type === "web_search_result") {
          const rr = r as Record<string, unknown>;
          searchResults.push({
            type: "web_search_result",
            url: rr.url as string | undefined,
            title: rr.title as string | undefined,
            encrypted_content: rr.encrypted_content as string | undefined,
            page_age: rr.page_age as string | undefined,
          });
        }
      }
      assistantContent.push(
        _buildContentBlock({
          type: "web_search_tool_result",
          tool_use_id: event.content_block.tool_use_id ?? "",
          content: searchResults,
        })
      );
    } else if (event.content_block?.type === "bash_code_execution_tool_result") {
      assistantContent.push(
        _buildContentBlock({
          type: "bash_code_execution_tool_result",
          tool_use_id: event.content_block.tool_use_id ?? "",
          content: (event.content_block.content as Record<string, unknown>) ?? {},
        })
      );
    }
  } else if (event.type === "content_block_delta") {
    if (event.delta?.type === "thinking_delta") {
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          thinking: event.delta.thinking ?? "",
          signature: "",
        })
      );
    } else if (event.delta?.type === "text_delta") {
      assistantContent.push(
        _buildContentBlock({ type: "text", text: event.delta.text ?? "" })
      );
    } else if (event.delta?.type === "signature_delta") {
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          thinking: "",
          signature: event.delta.signature ?? "",
        })
      );
    } else if (event.delta?.type === "input_json_delta") {
      const blockType = blockTypeByIndex?.[event.index];
      if (blockType === "server_tool_use") {
        assistantContent.push(
          _buildContentBlock({
            type: "server_tool_use",
            id: "",
            name: "",
            input: event.delta.partial_json ?? {} as Record<string, unknown>,
          })
        );
      } else {
        tool_calls.push(_buildToolCall("", "", event.delta.partial_json ?? ""));
      }
    } else if (event.delta?.type === "citations_delta" && event.delta.citation) {
      const citation = event.delta.citation as Record<string, unknown>;
      const annotations: WebAnnotation[] = [_parseAnthropicWebAnnotation(citation)];
      assistantContent.push(
        _buildContentBlock({ type: "text", text: "", annotations })
      );
    }
  }

  const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls);
  return _buildPromptTemplate(assistantMessage, metadata);
};

const _isImageMimeType = (mimeType: string): boolean =>
  typeof mimeType === "string" && mimeType.startsWith("image/");

function _getChunkWebInfo(chunk: Record<string, unknown>): { uri: string; title: string } {
  const web = chunk.web as Record<string, unknown> | undefined;
  if (web && typeof web === "object") {
    return {
      uri: (web.uri as string) ?? "",
      title: (web.title as string) ?? "",
    };
  }
  return {
    uri: (chunk.uri as string) ?? "",
    title: (chunk.title as string) ?? "",
  };
}

function _getFullResponseTextFromCandidate(candidate: Record<string, unknown> | null | undefined): string | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const content = candidate.content as { parts?: Array<{ text?: string }> } | undefined;
  const partList = content?.parts;
  if (!Array.isArray(partList)) return undefined;
  const texts: string[] = [];
  for (const part of partList) {
    if (part && typeof part === "object" && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts.length > 0 ? texts.join("") : undefined;
}

function _citationMetadataToAnnotations(citationMetadata: Record<string, unknown> | null | undefined): WebAnnotation[] {
  if (!citationMetadata || typeof citationMetadata !== "object") return [];
  const citations = (citationMetadata.citations as Record<string, unknown>[]) ?? [];
  const annotations: WebAnnotation[] = [];
  for (const c of citations) {
    if (!c || typeof c !== "object") continue;
    const uri = (c.uri as string) ?? "";
    if (!uri) continue;
    const startIndex = (c.startIndex as number) ?? 0;
    const endIndex = (c.endIndex as number) ?? 0;
    annotations.push({
      type: "url_citation",
      url: uri,
      title: uri,
      start_index: startIndex,
      end_index: endIndex,
    });
  }
  return annotations;
}

function _candidateToAnnotations(
  candidate: Record<string, unknown> | null | undefined,
  fullResponseText?: string
): Annotation[] {
  if (!candidate || typeof candidate !== "object") return [];
  const groundingMetadata = candidate.groundingMetadata as Record<string, unknown> | undefined;
  const citationMetadata = candidate.citationMetadata as Record<string, unknown> | undefined;
  const fromGrounding = _groundingMetadataToAnnotations(groundingMetadata, fullResponseText);
  const fromCitation = _citationMetadataToAnnotations(citationMetadata);
  return [...fromGrounding, ...fromCitation];
}

function _groundingMetadataToAnnotations(
  groundingMetadata: Record<string, unknown> | null | undefined,
  fullResponseText?: string
): Annotation[] {
  const chunks = groundingMetadata && typeof groundingMetadata === "object"
    ? ((groundingMetadata.groundingChunks as Record<string, unknown>[]) ?? [])
    : [];
  const supports = groundingMetadata && typeof groundingMetadata === "object"
    ? ((groundingMetadata.groundingSupports as Record<string, unknown>[]) ?? [])
    : [];

  function citedTextForSegment(segment: Record<string, unknown>, startIndex: number, endIndex: number): string | undefined {
    const segmentText = segment.text as string | undefined;
    if (segmentText != null && segmentText !== "") return segmentText;
    if (fullResponseText != null && endIndex > startIndex) {
      return fullResponseText.slice(startIndex, endIndex) || undefined;
    }
    return undefined;
  }

  // Map chunks to supports by matching indices (same as backend): only chunk_idx < chunks.length
  if (supports.length > 0 && chunks.length > 0) {
    const annotations: Annotation[] = [];
    const seenFileIds = new Set<string>();
    for (const support of supports) {
      if (!support || typeof support !== "object") continue;
      const segment = (support.segment as Record<string, unknown>) ?? {};
      const chunkIndices = (support.groundingChunkIndices as number[]) ?? [];
      const startIndex = (segment.startIndex as number) ?? 0;
      const endIndex = (segment.endIndex as number) ?? 0;
      const citedText = citedTextForSegment(segment, startIndex, endIndex);

      for (const chunkIdx of chunkIndices) {
        if (typeof chunkIdx !== "number" || chunkIdx >= chunks.length) continue;
        const chunk = chunks[chunkIdx] as Record<string, unknown>;
        if (!chunk || typeof chunk !== "object") continue;

        const maps = chunk.maps as Record<string, unknown> | undefined;
        if (maps && typeof maps === "object") {
          const uri = (maps.uri as string) ?? "";
          const title = (maps.title as string) ?? "";
          const placeId = maps.placeId as string | undefined;
          if (uri || title) {
            annotations.push({
              type: "map_citation",
              url: uri,
              title: title || uri,
              ...(placeId != null ? { place_id: placeId } : {}),
              start_index: startIndex,
              end_index: endIndex,
              ...(citedText != null ? { cited_text: citedText } : {}),
            } as MapAnnotation);
          }
          continue;
        }

        const retrieved = chunk.retrievedContext as Record<string, unknown> | undefined;
        if (retrieved && typeof retrieved === "object") {
          const title = (retrieved.title as string) ?? "";
          if (title && !seenFileIds.has(title)) {
            seenFileIds.add(title);
            annotations.push({
              type: "file_citation",
              file_id: title,
              filename: title,
              index: chunkIdx,
            } as FileAnnotation);
          }
          continue;
        }

        const { uri, title } = _getChunkWebInfo(chunk);
        if (uri) {
          annotations.push({
            type: "url_citation",
            url: uri,
            title: title || uri,
            start_index: startIndex,
            end_index: endIndex,
            ...(citedText != null ? { cited_text: citedText } : {}),
          } as WebAnnotation);
        }
      }
    }
    return annotations;
  }

  if (!groundingMetadata || typeof groundingMetadata !== "object") {
    return [];
  }

  // Fallback: annotations from chunks only (no segment info)
  const annotations: Annotation[] = [];
  const seenFileIds = new Set<string>();
  chunks.forEach((chunk, idx) => {
    if (!chunk || typeof chunk !== "object") return;
    const c = chunk as Record<string, unknown>;

    const maps = c.maps as Record<string, unknown> | undefined;
    if (maps && typeof maps === "object") {
      const uri = (maps.uri as string) ?? "";
      const title = (maps.title as string) ?? "";
      const placeId = maps.placeId as string | undefined;
      if (uri || title) {
        annotations.push({
          type: "map_citation",
          url: uri,
          title: title || uri,
          ...(placeId != null ? { place_id: placeId } : {}),
          start_index: 0,
          end_index: 0,
        } as MapAnnotation);
      }
      return;
    }

    const retrieved = c.retrievedContext as Record<string, unknown> | undefined;
    if (retrieved && typeof retrieved === "object") {
      const title = (retrieved.title as string) ?? "";
      if (title && !seenFileIds.has(title)) {
        seenFileIds.add(title);
        annotations.push({
          type: "file_citation",
          file_id: title,
          filename: title,
          index: idx,
        } as FileAnnotation);
      }
      return;
    }

    const { uri, title } = _getChunkWebInfo(c);
    if (uri) {
      annotations.push({
        type: "url_citation",
        url: uri,
        title: title || uri,
        start_index: 0,
        end_index: 0,
      } as WebAnnotation);
    }
  });
  return annotations;
}

export const buildPromptBlueprintFromGoogleEvent = (
  event: any,
  metadata: Metadata
): PromptBlueprint => {
  const assistantContent: Content[] = [];
  const tool_calls: ToolCall[] = [];

  for (const candidate of event.candidates ?? []) {
    if (
      candidate.content &&
      candidate.content.parts &&
      Array.isArray(candidate.content.parts)
    ) {
      for (const part of candidate.content.parts) {
        if (part.text != null) {
          if (part.thought === true) {
            assistantContent.push(
              _buildContentBlock({
                type: "thinking",
                thinking: part.text,
                signature: part.thoughtSignature ?? "",
              })
            );
          } else {
            assistantContent.push(
              _buildContentBlock({
                type: "text",
                text: part.text,
                ...(part.thoughtSignature ? { thought_signature: part.thoughtSignature } : {}),
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
        } else if (part.executableCode) {
          const exec = part.executableCode;
          assistantContent.push(
            _buildContentBlock({
              type: "code",
              code: exec.code ?? "",
              ...(exec.language != null ? { language: exec.language } : {}),
            })
          );
        } else if (part.codeExecutionResult) {
          const result = part.codeExecutionResult;
          assistantContent.push(
            _buildContentBlock({
              type: "code_execution_result",
              output: result.output ?? "",
              outcome: result.outcome ?? "OUTCOME_OK",
            })
          );
        } else {
          const inlineData = part.inlineData;
          if (inlineData && part.thought !== true) {
            const mimeType = inlineData.mimeType ?? "image/png";
            const data = inlineData.data ?? "";
            if (_isImageMimeType(mimeType) && data) {
              const providerMetadata: Record<string, unknown> = {};
              if (part.thoughtSignature) providerMetadata.thought_signature = part.thoughtSignature;
              if (part.aspectRatio != null) providerMetadata.aspect_ratio = part.aspectRatio;
              if (part.imageSize != null) providerMetadata.image_size = part.imageSize;
              assistantContent.push(
                _buildContentBlock({
                  type: "output_media",
                  url: data,
                  mime_type: mimeType,
                  media_type: "image",
                  ...(Object.keys(providerMetadata).length ? { provider_metadata: providerMetadata } : {}),
                })
              );
            }
          }
        }
      }
    }
  }

  const firstCandidate = event.candidates?.[0] as Record<string, unknown> | undefined;
  const fullResponseText = _getFullResponseTextFromCandidate(firstCandidate);
  const allAnnotations = _candidateToAnnotations(firstCandidate, fullResponseText);
  if (allAnnotations.length > 0) {
    for (let i = 0; i < assistantContent.length; i++) {
      const block = assistantContent[i];
      if (block && typeof block === "object" && (block as Content).type === "text") {
        const existing = (block as { annotations?: Annotation[] }).annotations ?? [];
        assistantContent[i] = { ...block, annotations: [...existing, ...allAnnotations] } as Content;
      }
    }
  }

  const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls);
  return _buildPromptTemplate(assistantMessage, metadata);
};

export const buildPromptBlueprintFromOpenAIEvent = (
  event: any,
  metadata: Metadata
): PromptBlueprint => {
  const assistantContent: Content[] = [];
  const tool_calls: ToolCall[] = [];

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
  metadata: Metadata
): PromptBlueprint => {
  const assistantContent: Content[] = [];
  const tool_calls: ToolCall[] = [];

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
    } else if (item_type === "code_interpreter_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "code",
          item_id: item_id,
          code: item?.code ?? "",
          container_id: item?.container_id ?? "",
        })
      );
    } else if (item_type === "image_generation_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "output_media",
          item_id: item_id,
          url: "",
          mime_type: "image/png",
          media_type: "image",
        })
      );
    } else if (item_type === "mcp_list_tools") {
      assistantContent.push(
        _buildContentBlock({
          type: "mcp_list_tools",
          item_id: item_id,
          server_label: item?.server_label ?? "",
          tools: item?.tools ?? [],
        })
      );
    } else if (item_type === "mcp_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "mcp_call",
          item_id: item_id,
          name: item?.name ?? "",
          server_label: item?.server_label ?? "",
          arguments: item?.arguments ?? "",
          output: item?.output,
          error: item?.error,
          approval_request_id: item?.approval_request_id,
        })
      );
    } else if (item_type === "mcp_approval_request") {
      assistantContent.push(
        _buildContentBlock({
          type: "mcp_approval_request",
          item_id: item_id,
          name: item?.name ?? "",
          arguments: item?.arguments ?? "",
          server_label: item?.server_label ?? "",
        })
      );
    } else if (item_type === "shell_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "shell_call",
          item_id: item_id,
          call_id: item?.call_id ?? "",
          action: item?.action ?? {},
          status: item?.status ?? "in_progress",
        })
      );
    } else if (item_type === "shell_call_output") {
      assistantContent.push(
        _buildContentBlock({
          type: "shell_call_output",
          item_id: item_id,
          call_id: item?.call_id ?? "",
          output: item?.output ?? [],
          status: item?.status ?? "in_progress",
        })
      );
    } else if (item_type === "apply_patch_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "apply_patch_call",
          item_id: item_id,
          call_id: item?.call_id ?? "",
          operation: item?.operation ?? {},
          status: item?.status ?? "in_progress",
        })
      );
    } else if (item_type === "apply_patch_call_output") {
      assistantContent.push(
        _buildContentBlock({
          type: "apply_patch_call_output",
          item_id: item_id,
          call_id: item?.call_id ?? "",
          output: item?.output ?? "",
          status: item?.status ?? "in_progress",
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
          annotations: (part?.annotations || []) as Annotation[],
        })
      );
    }
  } else if (event_type === "response.content_part.done") {
    const part = event?.part ?? {};
    const part_type: string = part?.type ?? "output_text";
    const item_id: string = event?.item_id ?? "";
    if (part_type === "output_text") {
      assistantContent.push(
        _buildContentBlock({
          type: "text",
          item_id: item_id,
          text: part?.text ?? "",
          annotations: (part?.annotations || []) as Annotation[],
        })
      );
    }
  } else if (event_type === "response.output_text.annotation.added") {
    const annotation = event?.annotation || {};
    const atype = annotation?.type;
    let mapped_annotation: Annotation | null = null;

    if (atype === "url_citation") {
      mapped_annotation = {
        type: "url_citation",
        title: annotation?.title ?? "",
        url: annotation?.url ?? "",
        start_index: annotation?.start_index ?? 0,
        end_index: annotation?.end_index ?? 0,
      } as WebAnnotation;
    }
    else if (atype === "file_citation") {
      mapped_annotation = {
        type: "file_citation",
        index: annotation?.index ?? 0,
        file_id: annotation?.file_id ?? "",
        filename: annotation?.filename ?? "",
      } as FileAnnotation;
    }
    else {
      mapped_annotation = annotation as Annotation;
    }

    assistantContent.push(
      _buildContentBlock({
        type: "text",
        item_id: event?.item_id ?? "",
        text: "",
        annotations: [mapped_annotation],
      })
    );
  } else if (event_type === "response.code_interpreter_call.in_progress") {
    assistantContent.push(
      _buildContentBlock({
        type: "code",
        item_id: event?.item_id ?? "",
        code: event?.code ?? "",
        container_id: event?.container_id ?? "",
      })
    );
  } else if (event_type === "response.code_interpreter_call_code.delta") {
    assistantContent.push(
      _buildContentBlock({
        type: "code",
        item_id: event?.item_id ?? "",
        code: event?.delta ?? "",
        container_id: event?.container_id ?? "",
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
    assistantContent.push(
      _buildContentBlock({
        type: "text",
        item_id: event?.item_id ?? "",
        text: event?.text ?? "",
      })
    );
  } else if (event_type === "response.output_item.done") {
    const item = event?.item ?? {};
    const item_type: string | undefined = item?.type;
    const item_id: string = item?.id ?? "";

    if (item_type === "reasoning") {
      const summary: any[] = item?.summary ?? [];
      const summary_text: string = summary.map((summary_part: any) => summary_part?.text ?? "").join("");
      assistantContent.push(
        _buildContentBlock({
          type: "thinking",
          item_id: item_id,
          thinking: summary_text,
          signature: "",
        })
      );
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
          assistantContent.push(
            _buildContentBlock({
              type: "text",
              item_id: item_id,
              text: content_part?.text ?? "",
            })
          );
        }
      }
    } else if (item_type === "code_interpreter_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "code",
          item_id: item_id,
          code: item?.code ?? "",
          container_id: item?.container_id ?? "",
        })
      );
    } else if (item_type === "image_generation_call") {
      const result = item?.result ?? "";
      const output_format = item?.output_format ?? "png";
      const mime_type = output_format === "webp" ? "image/webp" : "image/png";
      const provider_metadata: Record<string, unknown> = {};
      for (const key of ["revised_prompt", "background", "size", "quality", "output_format"]) {
        if (item?.[key] != null) provider_metadata[key] = item[key];
      }
      assistantContent.push(
        _buildContentBlock({
          type: "output_media",
          item_id: item_id,
          url: result,
          mime_type,
          media_type: "image",
          ...(Object.keys(provider_metadata).length ? { provider_metadata } : {}),
        })
      );
    } else if (item_type === "mcp_list_tools") {
      assistantContent.push(
        _buildContentBlock({
          type: "mcp_list_tools",
          item_id: item_id,
          server_label: item?.server_label ?? "",
          tools: item?.tools ?? [],
          error: item?.error,
        })
      );
    } else if (item_type === "mcp_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "mcp_call",
          item_id: item_id,
          name: item?.name ?? "",
          server_label: item?.server_label ?? "",
          arguments: item?.arguments ?? "",
          output: item?.output,
          error: item?.error,
          approval_request_id: item?.approval_request_id,
        })
      );
    } else if (item_type === "mcp_approval_request") {
      assistantContent.push(
        _buildContentBlock({
          type: "mcp_approval_request",
          item_id: item_id,
          name: item?.name ?? "",
          arguments: item?.arguments ?? "",
          server_label: item?.server_label ?? "",
        })
      );
    } else if (item_type === "shell_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "shell_call",
          item_id: item_id,
          call_id: item?.call_id ?? "",
          action: item?.action ?? {},
          status: item?.status ?? "completed",
        })
      );
    } else if (item_type === "shell_call_output") {
      assistantContent.push(
        _buildContentBlock({
          type: "shell_call_output",
          item_id: item_id,
          call_id: item?.call_id ?? "",
          output: item?.output ?? [],
          status: item?.status ?? "completed",
        })
      );
    } else if (item_type === "apply_patch_call") {
      assistantContent.push(
        _buildContentBlock({
          type: "apply_patch_call",
          item_id: item_id,
          call_id: item?.call_id ?? "",
          operation: item?.operation ?? {},
          status: item?.status ?? "completed",
        })
      );
    } else if (item_type === "apply_patch_call_output") {
      assistantContent.push(
        _buildContentBlock({
          type: "apply_patch_call_output",
          item_id: item_id,
          call_id: item?.call_id ?? "",
          output: item?.output ?? "",
          status: item?.status ?? "completed",
        })
      );
    }
  } else if (event_type === "response.code_interpreter_call_code.done") {
    assistantContent.push(
      _buildContentBlock({
        type: "code",
        item_id: event?.item_id ?? "",
        code: event?.code ?? "",
        container_id: event?.container_id ?? "",
      })
    );
  } else if (event_type === "response.code_interpreter_call.interpreting") {
    assistantContent.push(
      _buildContentBlock({
        type: "code",
        item_id: event?.item_id ?? "",
        code: event?.code ?? "",
        container_id: event?.container_id ?? "",
      })
    );
  } else if (event_type === "response.code_interpreter_call.completed") {
    assistantContent.push(
      _buildContentBlock({
        type: "code",
        item_id: event?.item_id ?? "",
        code: event?.code ?? "",
        container_id: event?.container_id ?? "",
      })
    );
  } else if (event_type === "response.image_generation_call.in_progress") {
    assistantContent.push(
      _buildContentBlock({
        type: "output_media",
        item_id: event?.item_id ?? "",
        url: "",
        mime_type: "image/png",
        media_type: "image",
      })
    );
  } else if (event_type === "response.image_generation_call.generating") {
    assistantContent.push(
      _buildContentBlock({
        type: "output_media",
        item_id: event?.item_id ?? "",
        url: "",
        mime_type: "image/png",
        media_type: "image",
      })
    );
  } else if (event_type === "response.image_generation_call.partial_image") {
    const output_format = event?.output_format ?? "png";
    const mime_type = output_format === "webp" ? "image/webp" : "image/png";
    const provider_metadata: Record<string, unknown> = {};
    for (const key of ["background", "size", "quality", "output_format"]) {
      if (event?.[key] != null) provider_metadata[key] = event[key];
    }
    assistantContent.push(
      _buildContentBlock({
        type: "output_media",
        item_id: event?.item_id ?? "",
        url: event?.partial_image_b64 ?? "",
        mime_type,
        media_type: "image",
        ...(Object.keys(provider_metadata).length ? { provider_metadata } : {}),
      })
    );
  } else if (event_type === "response.shell_call_command.added") {
    assistantContent.push(
      _buildContentBlock({
        type: "shell_call",
        action: { command: event?.command ?? "" },
      })
    );
  } else if (event_type === "response.shell_call_command.delta") {
    assistantContent.push(
      _buildContentBlock({
        type: "shell_call",
        action: { command: event?.delta ?? "" },
      })
    );
  } else if (event_type === "response.shell_call_command.done") {
    assistantContent.push(
      _buildContentBlock({
        type: "shell_call",
        action: { command: event?.command ?? "" },
      })
    );
  } else if (event_type === "response.shell_call_output_content.delta") {
    assistantContent.push(
      _buildContentBlock({
        type: "shell_call_output",
        item_id: event?.item_id ?? "",
        output: [event?.delta ?? {}],
      })
    );
  } else if (event_type === "response.shell_call_output_content.done") {
    assistantContent.push(
      _buildContentBlock({
        type: "shell_call_output",
        item_id: event?.item_id ?? "",
        output: event?.output ?? [],
      })
    );
  } else if (event_type === "response.apply_patch_call_operation_diff.delta") {
    assistantContent.push(
      _buildContentBlock({
        type: "apply_patch_call",
        item_id: event?.item_id ?? "",
        operation: { diff: event?.delta ?? "" },
      })
    );
  } else if (event_type === "response.apply_patch_call_operation_diff.done") {
    assistantContent.push(
      _buildContentBlock({
        type: "apply_patch_call",
        item_id: event?.item_id ?? "",
        operation: { diff: event?.diff ?? "" },
      })
    );
  } else if (event_type === "response.completed") {
    const response = event?.response ?? {};
    const output: any[] = response?.output ?? [];

    for (const item of output) {
      const item_type: string | undefined = item?.type;
      const item_id: string = item?.id ?? "";

      if (item_type === "reasoning") {
        const summary: any[] = item?.summary ?? [];
        const summary_text: string = summary.map((summary_part: any) => summary_part?.text ?? "").join("");
        assistantContent.push(
          _buildContentBlock({
            type: "thinking",
            item_id: item_id,
            thinking: summary_text,
            signature: "",
          })
        );
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
            assistantContent.push(
              _buildContentBlock({
                type: "text",
                item_id: item_id,
                text: content_part?.text ?? "",
                annotations: (content_part?.annotations || []) as Annotation[],
              })
            );
          }
        }
      } else if (item_type === "code_interpreter_call") {
        assistantContent.push(
          _buildContentBlock({
            type: "code",
            item_id: item_id,
            code: item?.code ?? "",
            container_id: item?.container_id ?? "",
          })
        );
      } else if (item_type === "image_generation_call") {
        const result = item?.result ?? "";
        const output_format = item?.output_format ?? "png";
        const mime_type = output_format === "webp" ? "image/webp" : "image/png";
        const provider_metadata: Record<string, unknown> = {};
        for (const key of ["revised_prompt", "background", "size", "quality", "output_format"]) {
          if (item?.[key] != null) provider_metadata[key] = item[key];
        }
        assistantContent.push(
          _buildContentBlock({
            type: "output_media",
            item_id: item_id,
            url: result,
            mime_type,
            media_type: "image",
            ...(Object.keys(provider_metadata).length ? { provider_metadata } : {}),
          })
        );
      } else if (item_type === "mcp_list_tools") {
        assistantContent.push(
          _buildContentBlock({
            type: "mcp_list_tools",
            item_id: item_id,
            server_label: item?.server_label ?? "",
            tools: item?.tools ?? [],
            error: item?.error,
          })
        );
      } else if (item_type === "mcp_call") {
        assistantContent.push(
          _buildContentBlock({
            type: "mcp_call",
            item_id: item_id,
            name: item?.name ?? "",
            server_label: item?.server_label ?? "",
            arguments: item?.arguments ?? "",
            output: item?.output,
            error: item?.error,
            approval_request_id: item?.approval_request_id,
          })
        );
      } else if (item_type === "mcp_approval_request") {
        assistantContent.push(
          _buildContentBlock({
            type: "mcp_approval_request",
            item_id: item_id,
            name: item?.name ?? "",
            arguments: item?.arguments ?? "",
            server_label: item?.server_label ?? "",
          })
        );
      } else if (item_type === "shell_call") {
        assistantContent.push(
          _buildContentBlock({
            type: "shell_call",
            item_id: item_id,
            call_id: item?.call_id ?? "",
            action: item?.action ?? {},
            status: item?.status ?? "completed",
          })
        );
      } else if (item_type === "shell_call_output") {
        assistantContent.push(
          _buildContentBlock({
            type: "shell_call_output",
            item_id: item_id,
            call_id: item?.call_id ?? "",
            output: item?.output ?? [],
            status: item?.status ?? "completed",
          })
        );
      } else if (item_type === "apply_patch_call") {
        assistantContent.push(
          _buildContentBlock({
            type: "apply_patch_call",
            item_id: item_id,
            call_id: item?.call_id ?? "",
            operation: item?.operation ?? {},
            status: item?.status ?? "completed",
          })
        );
      } else if (item_type === "apply_patch_call_output") {
        assistantContent.push(
          _buildContentBlock({
            type: "apply_patch_call_output",
            item_id: item_id,
            call_id: item?.call_id ?? "",
            output: item?.output ?? "",
            status: item?.status ?? "completed",
          })
        );
      }
    }
  }

  const assistantMessage = _buildAssistantMessage(assistantContent, tool_calls || []);
  return _buildPromptTemplate(assistantMessage, metadata);
};

export const buildPromptBlueprintFromBedrockEvent = (
  event: any,
  metadata: Metadata
): PromptBlueprint => {
  const assistantContent: Content[] = [];
  const tool_calls: ToolCall[] = [];

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

const _RESPONSE_METADATA_KEYS = ["size", "quality", "background", "output_format"] as const;

export const buildPromptBlueprintFromOpenAIImagesEvent = (
  event: any,
  metadata: Metadata
): PromptBlueprint => {
  const content: Content[] = [];
  const event_type: string = event?.type ?? "";

  if (event_type === "image_generation.partial_image") {
    const b64 = event?.b64_json ?? "";
    if (b64) {
      const output_format: string = event?.output_format ?? "png";
      const mime_type = OUTPUT_FORMAT_TO_MIME[output_format] ?? "image/png";
      const provider_metadata: Record<string, unknown> = {};
      const partial_image_index = event?.partial_image_index;
      if (partial_image_index != null) {
        provider_metadata.partial_image_index = partial_image_index;
      }
      content.push(
        _buildContentBlock({
          type: "output_media",
          url: b64,
          mime_type,
          media_type: "image",
          ...(Object.keys(provider_metadata).length ? { provider_metadata } : {}),
        })
      );
    }
  } else if (event_type === "image_generation.completed") {
    const b64 = event?.b64_json ?? "";
    const output_format: string = event?.output_format ?? "png";
    const mime_type = OUTPUT_FORMAT_TO_MIME[output_format] ?? "image/png";
    const provider_metadata: Record<string, unknown> = {};
    for (const key of _RESPONSE_METADATA_KEYS) {
      if (event?.[key] != null) provider_metadata[key] = event[key];
    }
    content.push(
      _buildContentBlock({
        type: "output_media",
        url: b64,
        mime_type,
        media_type: "image",
        ...(Object.keys(provider_metadata).length ? { provider_metadata } : {}),
      })
    );
  }

  const promptTemplate: CompletionPromptTemplate = {
    type: "completion",
    content,
    input_variables: [],
  };

  return {
    prompt_template: promptTemplate,
    metadata,
  };
};
