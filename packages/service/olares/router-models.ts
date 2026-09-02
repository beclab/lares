import type { LaresEnv } from "../config/env.js";
import { type RouterCatalogRow } from "@olares/lares-core/router/catalog";
import {
  fetchRouterModels as loadRouterModels,
  isChatModel,
  isChatModelId,
  isPlaceholderModelId,
  modelsFromRouterCatalog,
  pickChatModelId,
} from "@olares/lares-core/router/models";

export type RouterModelEntry = RouterCatalogRow;
export type RouterModelsEnv = Pick<LaresEnv, "routerUrl" | "routerApiKey" | "olaresAppId" | "dataDir">;
export {
  isChatModel,
  isChatModelId,
  isPlaceholderModelId,
  modelsFromRouterCatalog,
  pickChatModelId,
};

export function fetchRouterModels(env: RouterModelsEnv): Promise<RouterModelEntry[]> {
  return loadRouterModels(env);
}
