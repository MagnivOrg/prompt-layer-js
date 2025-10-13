import { promptLayerCreateGroup } from "@/utils/utils";

export class GroupManager {
  apiKey: string;
  throwOnError: boolean;

  constructor(apiKey: string, throwOnError: boolean = true) {
    this.apiKey = apiKey;
    this.throwOnError = throwOnError;
  }

  create = () => promptLayerCreateGroup(this.apiKey, this.throwOnError);
}
