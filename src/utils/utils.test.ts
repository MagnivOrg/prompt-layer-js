import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { PromptLayer } from "@/index";
import { encodePathSegment } from "@/utils/utils";

// ---------------------------------------------------------------------------
// encodePathSegment unit tests
// ---------------------------------------------------------------------------

describe("encodePathSegment", () => {
  it("double-encodes forward slashes so a single proxy decode leaves %2F", () => {
    expect(encodePathSegment("feature1/resolve_problem_2")).toBe(
      "feature1%252Fresolve_problem_2"
    );
  });

  it("handles multiple slashes", () => {
    expect(encodePathSegment("a/b/c")).toBe("a%252Fb%252Fc");
  });

  it("does not alter names without slashes", () => {
    expect(encodePathSegment("simple-name")).toBe("simple-name");
  });

  it("still encodes spaces and other special characters", () => {
    expect(encodePathSegment("my prompt name")).toBe("my%20prompt%20name");
  });

  it("handles a name that is purely a slash", () => {
    expect(encodePathSegment("/")).toBe("%252F");
  });
});

// ---------------------------------------------------------------------------
// Integration tests: getPromptTemplate uses encodePathSegment in the URL
// ---------------------------------------------------------------------------

const jsonResponse = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getUrlString = (input: string | URL): string => String(input);

describe("PromptLayer.templates.get – slash in prompt name", () => {
  let client: PromptLayer;
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("double-encodes slashes in the request URL so the segment is not split", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          prompt_template: {
            prompt_name: "feature1/resolve_problem_2",
            type: "chat",
            messages: [],
          },
        },
        200
      )
    );

    await client.templates.get("feature1/resolve_problem_2");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input] = fetchMock.mock.calls[0];
    const url = getUrlString(input);
    // The URL must contain the double-encoded form so that after one proxy
    // decode pass the server receives %2F (not a literal /) in the path.
    expect(url).toContain("%252F");
    expect(url).toContain(
      "https://api.promptlayer.com/prompt-templates/feature1%252Fresolve_problem_2"
    );
  });

  it("does not alter URLs for prompt names without slashes", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          prompt_template: {
            prompt_name: "my-prompt",
            type: "chat",
            messages: [],
          },
        },
        200
      )
    );

    await client.templates.get("my-prompt");

    const [input] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toContain(
      "https://api.promptlayer.com/prompt-templates/my-prompt"
    );
  });
});
