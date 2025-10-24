import { promptLayerCreateGroup } from "@/utils/utils";

export class GroupManager {
  apiKey: string;
  baseURL: string;
  throwOnError: boolean;

  constructor(apiKey: string, baseURL: string, throwOnError: boolean = true) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.throwOnError = throwOnError;
  }

  create = () =>
    promptLayerCreateGroup(this.apiKey, this.baseURL, this.throwOnError);
}
