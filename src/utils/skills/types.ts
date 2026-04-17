import {
  InitialSkillFileUpdate,
  PublishSkillCollection,
  PublishSkillCollectionFromFiles,
  PublishSkillCollectionFromZip,
  PullSkillCollectionResponse,
  SaveSkillCollectionVersion,
  SkillFileMove,
  SkillFileUpdate,
  UpdateSkillCollection,
} from "@/types";

export interface CreateSkillCollectionRequestBody {
  name: PublishSkillCollectionFromFiles["name"];
  folder_id?: PublishSkillCollectionFromFiles["folderId"];
  provider: PublishSkillCollectionFromFiles["provider"];
  files?: InitialSkillFileUpdate[];
  commit_message?: PublishSkillCollectionFromFiles["commitMessage"];
}

export interface SaveSkillCollectionVersionRequestBody {
  file_updates?: SkillFileUpdate[];
  moves?: SkillFileMove[];
  deletes?: SaveSkillCollectionVersion["deletes"];
  commit_message?: SaveSkillCollectionVersion["commitMessage"];
  release_label?: SaveSkillCollectionVersion["releaseLabel"];
  provider?: SaveSkillCollectionVersion["provider"];
}

export type UpdateSkillCollectionRequestBody = Pick<UpdateSkillCollection, "name">;

export type PullSkillCollectionResult =
  | PullSkillCollectionResponse
  | ArrayBuffer
  | null;

export const isZipPublishRequest = (
  body: PublishSkillCollection
): body is PublishSkillCollectionFromZip => "zipFile" in body;
