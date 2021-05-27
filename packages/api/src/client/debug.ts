import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IHttpClient, generateGenericJsonClient} from "./utils";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/debug";

/**
 * REST HTTP client for debug routes
 */
export function getClient(config: IBeaconConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes(config);
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
}