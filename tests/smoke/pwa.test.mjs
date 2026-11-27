import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";

const dist = new URL("../../dist/", import.meta.url);
const publicDir = new URL("../../public/", import.meta.url);
const appUrl = new URL("https://smoke.test/");

function readDist(path) {
  return readFileSync(new URL(path, dist), "utf8");
}

function assertDistFile(path) {
  const file = statSync(new URL(path, dist), { throwIfNoEntry: false });
  assert.ok(file?.isFile() && file.size > 0, `dist/${path} must be a non-empty file`);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function attribute(tag, name) {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

test("dist contains the app shell, icons, and offline JSON data", () => {
  for (const path of ["index.html", "manifest.webmanifest", "sw.js"]) {
    assertDistFile(path);
  }

  for (const [directory, extension] of [["icons", ".png"], ["data", ".json"]]) {
    const assets = readdirSync(new URL(`${directory}/`, publicDir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension));
    assert.ok(assets.length > 0, `public/${directory} must contain ${extension} assets`);
    for (const asset of assets) {
      assertDistFile(`${directory}/${encodeURIComponent(asset.name)}`);
    }
  }
});

test("the built manifest has app metadata and packaged 192, 512 and maskable icons", () => {
  const manifest = JSON.parse(readDist("manifest.webmanifest"));
  for (const key of ["name", "start_url", "display"]) {
    assert.ok(hasText(manifest?.[key]), `manifest.${key} must be a non-empty string`);
  }

  assert.ok(Array.isArray(manifest.icons), "manifest.icons must be an array");
  for (const icon of manifest.icons) {
    assert.ok(hasText(icon?.src), "each manifest icon must have a src");
    const url = new URL(icon.src, appUrl);
    assert.equal(url.origin, appUrl.origin, `icon must be packaged locally: ${icon.src}`);
    assertDistFile(`.${url.pathname}`);
  }

  for (const size of ["192x192", "512x512"]) {
    assert.ok(manifest.icons.some((icon) => icon.sizes?.toLowerCase().split(/\s+/).includes(size)),
      `manifest must declare a ${size} icon`);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose?.split(/\s+/).includes("maskable")),
    "manifest must declare a maskable icon");
});

test("the built service worker parses and registers install, activate and fetch handlers", () => {
  const handlers = new Map();
  const worker = {
    location: new URL("sw.js", appUrl),
    addEventListener(event, handler) {
      handlers.set(event, handler);
    },
  };
  worker.self = worker;

  const script = new Script(readDist("sw.js"), { filename: "dist/sw.js" });
  script.runInNewContext(worker, { timeout: 1000 });

  for (const event of ["install", "activate", "fetch"]) {
    assert.equal(typeof handlers.get(event), "function", `service worker must register ${event}`);
  }
});

test("the built index links the manifest and loads the service worker registration", () => {
  const html = readDist("index.html").replace(/<!--[\s\S]*?-->/g, "");
  const manifestLink = html.match(/<link\b[^>]*>/gi)?.find((tag) =>
    attribute(tag, "rel")?.toLowerCase().split(/\s+/).includes("manifest"));
  const href = manifestLink && attribute(manifestLink, "href");
  assert.ok(hasText(href), "dist/index.html must link the manifest");
  const manifestUrl = new URL(href, appUrl);
  assert.equal(manifestUrl.origin + manifestUrl.pathname, new URL("manifest.webmanifest", appUrl).href);

  // Vite moves the registration into a hashed script loaded by index.html.
  const registration = /\bserviceWorker\s*\.\s*register\s*\(\s*(["'`])(?:\.\/|\/)?sw\.js\1\s*[,)]/;
  for (const [, tag, inlineSource] of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi)) {
    const src = attribute(tag, "src");
    const scriptUrl = src && new URL(src, appUrl);
    if (scriptUrl && scriptUrl.origin !== appUrl.origin) continue;
    const source = scriptUrl ? readDist(`.${scriptUrl.pathname}`) : inlineSource;
    if (registration.test(source)) return;
  }
  assert.fail("dist/index.html must load a script that registers sw.js");
});
