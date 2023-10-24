import { promptLayerCreateGroup } from "@/utils";

const create = async (): Promise<number | boolean> =>
  await promptLayerCreateGroup();

export { create };
