import { handleProxyRequest, CORS_HEADERS } from "../../server/proxyCore.js";

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let payload;
  if (request.method === "GET") {
    const u = new URL(request.url);
    payload = { url: u.searchParams.get("url") || "", method: "GET" };
  } else if (request.method === "POST") {
    payload = await request.json().catch(() => ({}));
  } else {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const result = await handleProxyRequest(payload);
  return new Response(result.text, {
    status: result.status,
    headers: { ...CORS_HEADERS, ...result.headers },
  });
}
