import {
  PublishSkillCollection,
  SkillCollectionProvider,
  PublishSkillCollectionResponse,
  PullSkillCollectionParams,
  PullSkillCollectionResponse,
  SaveSkillCollectionVersion,
  UpdateSkillCollectionResponse,
} from "@/types";
import {
  fetchWithRetry,
  getCommonHeaders,
  warnOnBadResponse,
} from "@/utils/utils";
import {
  skillCollectionEndpoint,
  skillCollectionsEndpoint,
  skillCollectionVersionsEndpoint,
} from "@/utils/endpoints";
import {
  omitUndefined,
  parseSkillResponseData,
  toZipBlob,
} from "./helpers";
import {
  CreateSkillCollectionRequestBody,
  isZipPublishRequest,
  PullSkillCollectionResult,
  SaveSkillCollectionVersionRequestBody,
  UpdateSkillCollectionRequestBody,
} from "./types";

const SKILL_COLLECTION_PROVIDERS: SkillCollectionProvider[] = [
  "claude_code",
  "openai",
  "openclaw",
];

const assertValidSkillCollectionProvider = (
  provider: string | undefined,
  operation: "publishing" | "updating"
) => {
  if (!provider) {
    if (operation === "publishing") {
      throw new Error("provider is required when publishing a skill collection.");
    }
    return;
  }

  if (!SKILL_COLLECTION_PROVIDERS.includes(provider as SkillCollectionProvider)) {
    throw new Error(
      `provider must be one of: ${SKILL_COLLECTION_PROVIDERS.join(", ")}.`
    );
  }
};

export const pullSkillCollection = async (
  apiKey: string,
  baseURL: string,
  identifier: string,
  params?: Partial<PullSkillCollectionParams>,
  throwOnError: boolean = true
): Promise<PullSkillCollectionResult> => {
  const url = new URL(skillCollectionEndpoint(baseURL, identifier));
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.append(key, String(value));
    }
  });

  const response = await fetchWithRetry(url, {
    headers: { "X-API-KEY": apiKey, ...getCommonHeaders() },
  });

  if (response.status !== 200) {
    const data = await parseSkillResponseData(response);
    const errorMessage =
      data.message || data.error || "Failed to pull skill collection";
    if (throwOnError) {
      throw new Error(errorMessage);
    }

    warnOnBadResponse(
      data,
      "WARNING: While pulling a skill collection PromptLayer had the following error"
    );
    return null;
  }

  if (params?.format === "zip") {
    return response.arrayBuffer();
  }

  return (await response.json()) as PullSkillCollectionResponse;
};

export const publishSkillCollection = async (
  apiKey: string,
  baseURL: string,
  body: PublishSkillCollection,
  throwOnError: boolean = true
): Promise<PublishSkillCollectionResponse | null> => {
  assertValidSkillCollectionProvider(body.provider, "publishing");

  const publishBody = isZipPublishRequest(body)
    ? (() => {
        const formData = new FormData();
        const jsonBody = omitUndefined({
          name: body.name,
          folder_id: body.folderId,
          provider: body.provider,
          commit_message: body.commitMessage,
        });

        formData.append(
          "files",
          toZipBlob(body.zipFile),
          body.fileName ?? "skill-collection.zip"
        );
        formData.append("json", JSON.stringify(jsonBody));
        return formData;
      })()
    : JSON.stringify(
        omitUndefined({
          name: body.name,
          folder_id: body.folderId,
          provider: body.provider,
          files: body.files,
          commit_message: body.commitMessage,
        }) as CreateSkillCollectionRequestBody
      );

  const response = isZipPublishRequest(body)
    ? await fetchWithRetry(skillCollectionsEndpoint(baseURL), {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          ...getCommonHeaders(),
        },
        body: publishBody,
      })
    : await fetchWithRetry(skillCollectionsEndpoint(baseURL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
          ...getCommonHeaders(),
        },
        body: publishBody,
      });

  const data = await parseSkillResponseData(response);
  if (response.status !== 201) {
    const errorMessage =
      data.message || data.error || "Failed to publish skill collection";
    if (throwOnError) {
      throw new Error(errorMessage);
    }

    warnOnBadResponse(
      data,
      "WARNING: While publishing a skill collection PromptLayer had the following error"
    );
    return null;
  }

  return data as PublishSkillCollectionResponse;
};

export const updateSkillCollection = async (
  apiKey: string,
  baseURL: string,
  identifier: string,
  body: UpdateSkillCollectionRequestBody,
  throwOnError: boolean = true
): Promise<UpdateSkillCollectionResponse | null> => {
  const response = await fetchWithRetry(skillCollectionEndpoint(baseURL, identifier), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      ...getCommonHeaders(),
    },
    body: JSON.stringify(omitUndefined(body)),
  });

  const data = await parseSkillResponseData(response);
  if (response.status !== 200) {
    const errorMessage =
      data.message || data.error || "Failed to update skill collection";
    if (throwOnError) {
      throw new Error(errorMessage);
    }

    warnOnBadResponse(
      data,
      "WARNING: While updating a skill collection PromptLayer had the following error"
    );
    return null;
  }

  return data as UpdateSkillCollectionResponse;
};

export const saveSkillCollectionVersion = async (
  apiKey: string,
  baseURL: string,
  identifier: string,
  body: SaveSkillCollectionVersion,
  throwOnError: boolean = true
): Promise<UpdateSkillCollectionResponse | null> => {
  assertValidSkillCollectionProvider(body.provider, "updating");

  const requestBody: SaveSkillCollectionVersionRequestBody = omitUndefined({
    file_updates: body.fileUpdates,
    moves: body.moves,
    deletes: body.deletes,
    commit_message: body.commitMessage,
    release_label: body.releaseLabel,
    provider: body.provider,
  });

  const response = await fetchWithRetry(
    skillCollectionVersionsEndpoint(baseURL, identifier),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        ...getCommonHeaders(),
      },
      body: JSON.stringify(requestBody),
    }
  );

  const data = await parseSkillResponseData(response);
  if (response.status !== 201) {
    const errorMessage =
      data.message || data.error || "Failed to save skill collection version";
    if (throwOnError) {
      throw new Error(errorMessage);
    }

    warnOnBadResponse(
      data,
      "WARNING: While saving a skill collection version PromptLayer had the following error"
    );
    return null;
  }

  return data as UpdateSkillCollectionResponse;
};
