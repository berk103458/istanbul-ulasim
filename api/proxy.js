import { handleProxyRequest, CORS_HEADERS } from "../server/proxyCore.js";

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") return res.status(204).end();

  let payload;
  if (req.method === "GET") {
    payload = { url: req.query?.url || "", method: "GET" };
  } else if (req.method === "POST") {
    payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const result = await handleProxyRequest(payload);
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  return res.status(result.status).send(result.text);
}
