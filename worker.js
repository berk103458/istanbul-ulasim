import packageInfo from "./package.json" with { type: "json" };
import { handleProxyHttpRequest } from "./server/proxyCore.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/proxy") {
      return handleProxyHttpRequest(request);
    }

    if (pathname === "/health") {
      return Response.json({
        ok: true,
        service: "istanbul-ulasim",
        version: packageInfo.version,
        runtime: "cloudflare-workers",
      });
    }

    return env.ASSETS.fetch(request);
  },
};
