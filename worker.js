import packageInfo from "./package.json" with { type: "json" };
import { CORS_HEADERS, handleProxyHttpRequest } from "./server/proxyCore.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/proxy") {
      try {
        return await handleProxyHttpRequest(request);
      } catch (error) {
        return Response.json({ error: String(error?.message || error) }, {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
        });
      }
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
