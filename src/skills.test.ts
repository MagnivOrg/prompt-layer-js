import { PromptLayer } from "@/index";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const jsonResponse = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const binaryResponse = (bytes: Uint8Array, status: number): Response =>
  new Response(
    new Blob(
      [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)],
      { type: "application/zip" }
    ),
    {
    status,
    headers: { "Content-Type": "application/zip" },
    }
  );

const getUrlString = (input: string | URL): string => String(input);

describe("skills", () => {
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

  it("exposes a skills manager on the main client", () => {
    expect(client.skills).toBeDefined();
    expect(typeof client.skills.pull).toBe("function");
    expect(typeof client.skills.publish).toBe("function");
    expect(typeof client.skills.update).toBe("function");
    expect("create" in client.skills).toBe(false);
  });

  it("encodes identifiers and forwards pull query params", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          skill_collection: { id: "folder/my skill", name: "My Skill" },
          files: {},
          version: null,
        },
        200
      )
    );

    await client.skills.pull("folder/my skill", {
      label: "prod",
      version: 2,
      format: "json",
    });

    const [input, init] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toBe(
      "https://api.promptlayer.com/api/public/v2/skill-collections/folder%2Fmy%20skill?label=prod&version=2&format=json"
    );
    expect(init?.headers).toMatchObject({
      "X-API-KEY": "test-api-key",
    });
  });

  it("maps publish request bodies to the expected API shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          skill_collection: { id: "skill-id", name: "Docs Skill" },
          version: { id: 1, version: 1 },
        },
        201
      )
    );

    await client.skills.publish({
      name: "Docs Skill",
      folderId: 12,
      provider: "claude_code",
      files: [{ path: "SKILL.md", content: "hello" }],
      commitMessage: "Initial import",
    });

    const [input, init] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toBe(
      "https://api.promptlayer.com/api/public/v2/skill-collections"
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      name: "Docs Skill",
      folder_id: 12,
      provider: "claude_code",
      files: [{ path: "SKILL.md", content: "hello" }],
      commit_message: "Initial import",
    });
  });

  it("supports publishing a skill collection from a zip file", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          skill_collection: { id: "zip-skill", name: "Zip Skill" },
        },
        201
      )
    );

    await client.skills.publish({
      name: "Zip Skill",
      zipFile: new Blob(["zip-bytes"], { type: "application/zip" }),
      fileName: "zip-skill.zip",
      folderId: 9,
      provider: "claude_code",
      commitMessage: "Import zip",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "X-API-KEY": "test-api-key",
    });
    expect(init?.headers).not.toHaveProperty("Content-Type");

    const formData = init?.body as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("files")).toBeInstanceOf(Blob);
    expect(formData.get("json")).toBe(
      JSON.stringify({
        name: "Zip Skill",
        folder_id: 9,
        provider: "claude_code",
        commit_message: "Import zip",
      }),
    );
  });

  it("requires provider when publishing a skill collection", async () => {
    await expect(
      client.skills.publish({
        name: "Missing Provider Skill",
        files: [{ path: "SKILL.md", content: "hello" }],
      } as any),
    ).rejects.toThrow("provider is required when publishing a skill collection.");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid provider values when publishing a skill collection", async () => {
    await expect(
      client.skills.publish({
        name: "Invalid Provider Skill",
        provider: "cursor" as any,
        files: [{ path: "SKILL.md", content: "hello" }],
      }),
    ).rejects.toThrow("provider must be one of: claude_code, openai, openclaw.");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns binary data when pulling a zip", async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(new Uint8Array([1, 2, 3]), 200));

    const result = await client.skills.pull("skill-id", { format: "zip" });

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(result as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it("orchestrates rename-only updates with a single patch call", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          skill_collection: { id: "renamed-skill", name: "Renamed Skill" },
          version: null,
        },
        200
      )
    );

    const result = await client.skills.update("old skill", {
      name: "Renamed Skill",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toBe(
      "https://api.promptlayer.com/api/public/v2/skill-collections/old%20skill"
    );
    expect(init?.method).toBe("PATCH");
    expect(result).toEqual({
      success: true,
      skill_collection: { id: "renamed-skill", name: "Renamed Skill" },
      version: null,
    });
  });

  it("orchestrates version-save-only updates with a final pull", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: true,
            version: { id: 2, version: 2, release_label: "prod" },
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: true,
            skill_collection: { id: "skill-id", name: "Skill" },
            files: { "SKILL.md": "updated" },
            version: { id: 2, version: 2, release_label: "prod" },
          },
          200
        )
      );

    const result = await client.skills.update("skill-id", {
      fileUpdates: [{ path: "SKILL.md", content: "updated" }],
      commitMessage: "Refresh content",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getUrlString(fetchMock.mock.calls[0][0])).toBe(
      "https://api.promptlayer.com/api/public/v2/skill-collections/skill-id/versions"
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      file_updates: [{ path: "SKILL.md", content: "updated" }],
      commit_message: "Refresh content",
    });
    expect(getUrlString(fetchMock.mock.calls[1][0])).toBe(
      "https://api.promptlayer.com/api/public/v2/skill-collections/skill-id"
    );
    expect(result).toEqual({
      success: true,
      skill_collection: { id: "skill-id", name: "Skill" },
      files: { "SKILL.md": "updated" },
      version: { id: 2, version: 2, release_label: "prod" },
    });
  });

  it("uses the renamed identifier for a subsequent version save", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: true,
            skill_collection: { id: "renamed-skill", name: "Renamed Skill" },
            version: null,
          },
          200
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: true,
            version: { id: 3, version: 3 },
          },
          201
        )
      );

    const result = await client.skills.update("old/skill", {
      name: "Renamed Skill",
      fileUpdates: [{ path: "SKILL.md", content: "new body" }],
      releaseLabel: "staging",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getUrlString(fetchMock.mock.calls[0][0])).toBe(
      "https://api.promptlayer.com/api/public/v2/skill-collections/old%2Fskill"
    );
    expect(getUrlString(fetchMock.mock.calls[1][0])).toBe(
      "https://api.promptlayer.com/api/public/v2/skill-collections/renamed-skill/versions"
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      file_updates: [{ path: "SKILL.md", content: "new body" }],
      release_label: "staging",
    });
    expect(result).toEqual({
      success: true,
      skill_collection: { id: "renamed-skill", name: "Renamed Skill" },
      version: { id: 3, version: 3 },
    });
  });

  it("throws when update receives no rename or version fields", async () => {
    await expect(client.skills.update("skill-id", {})).rejects.toThrow(
      "At least one of name, fileUpdates, moves, deletes, commitMessage, releaseLabel, or provider must be provided."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
