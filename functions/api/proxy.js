import { handleProxyHttpRequest } from "../../server/proxyCore.js";

export async function onRequest({ request }) {
  return handleProxyHttpRequest(request);
}
