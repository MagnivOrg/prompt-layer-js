import {
  PublishSkillCollection,
  PublishSkillCollectionResponse,
  PullSkillCollectionParams,
  PullSkillCollectionResponse,
  SkillCollection,
  SkillCollectionVersion,
  UpdateSkillCollection,
  UpdateSkillCollectionResponse,
} from "@/types";
import {
  publishSkillCollection,
  pullSkillCollection,
  saveSkillCollectionVersion,
  updateSkillCollection,
} from "@/utils/skills";

const hasItems = <T>(value?: T[]): boolean =>
  Array.isArray(value) && value.length > 0;

const hasVersionUpdates = (body: UpdateSkillCollection): boolean =>
  hasItems(body.fileUpdates) ||
  hasItems(body.moves) ||
  hasItems(body.deletes) ||
  body.commitMessage !== undefined ||
  body.releaseLabel !== undefined ||
  body.provider !== undefined;

const normalizeUpdateResponse = (
  response: Partial<UpdateSkillCollectionResponse> | Partial<PullSkillCollectionResponse> | null,
  skillCollection: SkillCollection,
  version: SkillCollectionVersion | null
): UpdateSkillCollectionResponse => ({
  ...(response ?? {}),
  success: response?.success ?? true,
  skill_collection: skillCollection,
  version,
});

export class SkillManager {
  apiKey: string;
  baseURL: string;
  throwOnError: boolean;

  constructor(apiKey: string, baseURL: string, throwOnError: boolean = true) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.throwOnError = throwOnError;
  }

  pull = (identifier: string, params?: Partial<PullSkillCollectionParams>) =>
    pullSkillCollection(
      this.apiKey,
      this.baseURL,
      identifier,
      params,
      this.throwOnError
    );

  publish = (body: PublishSkillCollection): Promise<PublishSkillCollectionResponse | null> =>
    publishSkillCollection(this.apiKey, this.baseURL, body, this.throwOnError);

  update = async (
    identifier: string,
    body: UpdateSkillCollection
  ): Promise<UpdateSkillCollectionResponse | null> => {
    const renameRequested = body.name !== undefined;
    const versionUpdatesRequested = hasVersionUpdates(body);

    if (!renameRequested && !versionUpdatesRequested) {
      throw new Error(
        "At least one of name, fileUpdates, moves, deletes, commitMessage, releaseLabel, or provider must be provided."
      );
    }

    let effectiveIdentifier = identifier;
    let latestResponse:
      | Partial<UpdateSkillCollectionResponse>
      | Partial<PullSkillCollectionResponse>
      | null = null;
    let skillCollection: SkillCollection | undefined;
    let version: SkillCollectionVersion | null = null;

    if (renameRequested) {
      const renameResponse = await updateSkillCollection(
        this.apiKey,
        this.baseURL,
        identifier,
        { name: body.name },
        this.throwOnError
      );
      if (!renameResponse) {
        return null;
      }

      latestResponse = renameResponse;
      skillCollection = renameResponse.skill_collection;
      version = renameResponse.version ?? null;
      effectiveIdentifier = String(renameResponse.skill_collection.id);
    }

    if (versionUpdatesRequested) {
      const versionResponse = await saveSkillCollectionVersion(
        this.apiKey,
        this.baseURL,
        effectiveIdentifier,
        {
          fileUpdates: body.fileUpdates,
          moves: body.moves,
          deletes: body.deletes,
          commitMessage: body.commitMessage,
          releaseLabel: body.releaseLabel,
          provider: body.provider,
        },
        this.throwOnError
      );
      if (!versionResponse) {
        return null;
      }

      latestResponse = versionResponse;
      skillCollection = versionResponse.skill_collection ?? skillCollection;
      version = versionResponse.version ?? version;
    }

    if (!skillCollection) {
      const pullResponse = await this.pull(effectiveIdentifier);
      if (!pullResponse) {
        return null;
      }
      if (pullResponse instanceof ArrayBuffer) {
        throw new Error("Expected JSON skill collection response but received binary data.");
      }

      latestResponse = pullResponse;
      skillCollection = pullResponse.skill_collection;
      version = pullResponse.version ?? version;
    }

    return normalizeUpdateResponse(latestResponse, skillCollection, version);
  };
}
