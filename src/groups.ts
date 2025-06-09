import { promptLayerCreateGroup } from "@/utils/utils";

export class GroupManager {
  apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  create = () => promptLayerCreateGroup(this.apiKey);
}
