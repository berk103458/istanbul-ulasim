import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Capacitor packages dist with an app ID", () => {
  const config = JSON.parse(readFileSync(new URL("../../capacitor.config.json", import.meta.url), "utf8"));
  assert.equal(config.webDir, "dist");
  assert.ok(typeof config.appId === "string" && config.appId.trim(), "appId must be a non-empty string");
});

test("the shared proxy core and Cloudflare Pages proxy entry point can be imported", async () => {
  const { handleProxyHttpRequest } = await import("../../server/proxyCore.js");
  const { onRequest } = await import("../../functions/api/proxy.js");
  assert.equal(typeof handleProxyHttpRequest, "function");
  assert.equal(typeof onRequest, "function");
});
