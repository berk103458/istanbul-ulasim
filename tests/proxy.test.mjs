import test from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/proxy.js";
import { sharedCache } from "../server/cacheLayer.js";
import { gateway } from "../server/apiGateway.js";
import worker from "../worker.js";

const PROXY_URL = "https://example.test/api/proxy";
const ALLOWED_URL = "https://api.ibb.gov.tr/__proxy_test__/upstream";

const ALLOWED_HOSTS = [
  "api.ibb.gov.tr",
  "sehirhatlari.istanbul",
  "www.sehirhatlari.istanbul",
  "tkmservices.ibb.gov.tr",
  "api.transitous.org",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, SOAPAction",
};

const SENSITIVE_HEADERS = {
  Authorization: "Bearer secret-token",
  Cookie: "session=secret; other=secret",
  "Proxy-Authorization": "Basic c2VjcmV0",
  Host: "127.0.0.1",
  Origin: "http://localhost",
  Referer: "http://localhost/admin",
  "X-Forwarded-For": "127.0.0.1",
  "X-Forwarded-Host": "127.0.0.1",
  "X-Real-IP": "127.0.0.1",
  "X-Api-Key": "secret-key",
  "X-Auth-Token": "secret-token",
  "CF-Connecting-IP": "127.0.0.1",
  "True-Client-IP": "127.0.0.1",
  Forwarded: "for=127.0.0.1;host=localhost",
  Via: "1.1 localhost",
  Connection: "close",
  "Content-Length": "999999",
  "Transfer-Encoding": "chunked",
  Expect: "100-continue",
  "Keep-Alive": "timeout=5",
  TE: "trailers",
  Upgrade: "websocket",
  "User-Agent": "attacker-controlled",
};

function resetProxyState() {
  sharedCache.mem.clear();
  sharedCache.redisUrl = "";
  gateway.breakers.clear();
  gateway.inFlight.clear();
}

function assertCors(response) {
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), CORS["Access-Control-Allow-Origin"]);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), CORS["Access-Control-Allow-Methods"]);
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), CORS["Access-Control-Allow-Headers"]);
}

function jsonPost(payload, { headers = {}, rawBody } = {}) {
  return new Request(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: rawBody !== undefined ? rawBody : JSON.stringify(payload),
  });
}

function getProxy(url, { headers = {} } = {}) {
  return new Request(`${PROXY_URL}?url=${encodeURIComponent(url)}`, { method: "GET", headers });
}

function upstream(text = "upstream-ok", { status = 200, headers = {} } = {}) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

async function withStubbedFetch(stub, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return stub(url, options, calls);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function lowerHeaderNames(headers) {
  return Object.keys(headers).map((k) => k.toLowerCase()).sort();
}

test("OPTIONS preflight returns 204, CORS headers, and does not call upstream", async () => {
  resetProxyState();
  await withStubbedFetch(() => {
    throw new Error("OPTIONS must not call upstream fetch");
  }, async (calls) => {
    const response = await onRequest({
      request: new Request(PROXY_URL, {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, SOAPAction",
        },
      }),
    });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assertCors(response);
    assert.equal(calls.length, 0);
  });
});

test("izinli host'lar geçer", async () => {
  resetProxyState();
  for (const host of ALLOWED_HOSTS) {
    await withStubbedFetch(() => upstream("ok"), async (calls) => {
      const target = `https://${host}/__proxy_test__/allowed?case=${encodeURIComponent(host)}`;
      const response = await onRequest({ request: jsonPost({ url: target, method: "GET" }) });

      assert.equal(response.status, 200, `${host} should pass`);
      assert.equal(await response.text(), "ok");
      assertCors(response);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, target);
      assert.equal(calls[0].options.method, "GET");
    });
  }
});

test("http ve https protokolleri allowlisted host ile kabul edilir; diğer protokoller reddedilir", async () => {
  resetProxyState();
  await withStubbedFetch(() => upstream("ok"), async (calls) => {
    const httpResponse = await onRequest({ request: jsonPost({ url: "http://api.ibb.gov.tr/__proxy_test__/http", method: "GET" }) });
    assert.equal(httpResponse.status, 200);
    assert.equal(calls.length, 1);
  });

  await withStubbedFetch(() => {
    throw new Error("non-http(s) protocol must not call upstream");
  }, async (calls) => {
    for (const url of [
      "file:///etc/passwd",
      "file://api.ibb.gov.tr/etc/passwd",
      "data:text/plain,hello",
      "javascript:alert(1)",
      "ftp://api.ibb.gov.tr/x",
      "gopher://api.ibb.gov.tr/x",
      "about:blank",
    ]) {
      const response = await onRequest({ request: jsonPost({ url, method: "GET" }) });
      assert.equal(response.status, 403, `${url} should be forbidden`);
      assertCors(response);
    }
    assert.equal(calls.length, 0);
  });
});

test("izinsiz host 403", async () => {
  resetProxyState();
  const disallowed = [
    "https://example.com/",
    "https://example.test/secret",
    "https://api.ibb.gov.tr.evil.test/",
    "https://api.ibb.gov.tr@evil.test/",
    "https://api.ibb.gov.tr:443@evil.test/",
    "https://api.ibb.gov.tr%2f@evil.test/",
    "https://evil.test@api.ibb.gov.tr.evil.test/",
    "https://evil.test\\@api.ibb.gov.tr/",
    "https://evil.test/@api.ibb.gov.tr",
    "https://evil.test#api.ibb.gov.tr",
    "https://evil.test?api.ibb.gov.tr",
    "https://evil.test/api.ibb.gov.tr",
    "https://api.ibb.gov.tr.evil.test/api.ibb.gov.tr",
    "https://www.api.ibb.gov.tr/",
    "https://api.ibb.gov.tr./",
    "not-a-url",
    "://",
    "https://",
    "http://",
    "https://api.ibb.gov.tr:notaport/",
    "",
    "   ",
  ];

  await withStubbedFetch(() => {
    throw new Error("disallowed target must not call upstream");
  }, async (calls) => {
    for (const url of disallowed) {
      const response = await onRequest({ request: jsonPost({ url, method: "GET" }) });
      assert.equal(response.status, 403, `${url || "<empty>"} should be forbidden`);
      const body = await response.json();
      assert.equal(body.error, "Forbidden target host");
      assertCors(response);
    }
    assert.equal(calls.length, 0);
  });
});

test("izinsiz IP ve localhost hedefleri 403", async () => {
  resetProxyState();
  const disallowed = [
    "http://localhost/",
    "http://localhost:8080/",
    "http://localhost.",
    "http://LOCALHOST/",
    "http://127.0.0.1/",
    "http://127.0.0.1:8080/",
    "http://127.1/",
    "http://127.0.0.1./",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://017700000001/",
    "http://[::1]/",
    "http://[::1]:8080/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://10.255.255.255/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.0.1/",
    "http://192.168.255.255/",
    "http://169.254.169.254/",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.0.1/",
    "http://metadata.google.internal/",
    "http://api.ibb.gov.tr@localhost/",
    "http://api.ibb.gov.tr@127.0.0.1/",
    "http://api.ibb.gov.tr@169.254.169.254/",
    "http://api.ibb.gov.tr.localhost/",
  ];

  await withStubbedFetch(() => {
    throw new Error("localhost/IP target must not call upstream");
  }, async (calls) => {
    for (const url of disallowed) {
      const response = await onRequest({ request: jsonPost({ url, method: "GET" }) });
      assert.equal(response.status, 403, `${url} should be forbidden`);
      assert.equal((await response.json()).error, "Forbidden target host");
      assertCors(response);
    }
    assert.equal(calls.length, 0);
  });
});

test("GET ?url= kullanır ve proxy isteğindeki hassas header'ları upstream'e taşımaz", async () => {
  resetProxyState();
  const target = "https://api.ibb.gov.tr/__proxy_test__/get?x=1&y=2";

  await withStubbedFetch(() => upstream("get-ok"), async (calls) => {
    const response = await onRequest({
      request: getProxy(target, {
        headers: {
          ...SENSITIVE_HEADERS,
          "Content-Type": "application/json",
          Accept: "application/json",
          "SOAPAction": '"http://tempuri.org/Test"',
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "get-ok");
    assertCors(response);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, target);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.body, undefined);

    const sent = calls[0].options.headers;
    assert.ok(sent["User-Agent"], "fixed User-Agent must be set");
    assert.notEqual(sent["User-Agent"], SENSITIVE_HEADERS["User-Agent"]);
    for (const name of lowerHeaderNames(sent)) {
      assert.ok(!["authorization", "cookie", "proxy-authorization", "host", "origin", "referer"].includes(name), `${name} leaked`);
      assert.ok(!name.startsWith("x-"), `${name} leaked`);
      assert.ok(!["forwarded", "via", "connection", "content-length", "transfer-encoding", "expect", "keep-alive", "te", "upgrade"].includes(name), `${name} leaked`);
    }
    // GET adapterı payload.headers üretmez; incoming request header'ları hiç okunmaz.
    assert.ok(!("Content-Type" in sent));
    assert.ok(!("SOAPAction" in sent));
    assert.ok(!("Accept" in sent));
  });
});

test("POST JSON allowed host'u geçirir, POST body'yi string olarak iletir ve sensitive header'ları süzer", async () => {
  resetProxyState();
  const target = "https://api.ibb.gov.tr/__proxy_test__/post";
  const body = "<?xml version=\"1.0\"?><x>hello</x>";

  await withStubbedFetch(() => upstream("post-ok"), async (calls) => {
    const response = await onRequest({
      request: jsonPost({
        url: target,
        method: "POST",
        headers: {
          ...SENSITIVE_HEADERS,
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '"http://tempuri.org/Test"',
          Accept: "text/xml",
          "content-type": "application/json",
          accept: "*/*",
        },
        body,
      }, {
        headers: {
          ...SENSITIVE_HEADERS,
          Authorization: "Bearer proxy-secret",
          Cookie: "proxy=secret",
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "post-ok");
    assertCors(response);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, target);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.body, body);

    const sent = calls[0].options.headers;
    assert.ok(sent["User-Agent"]);
    assert.notEqual(sent["User-Agent"], "attacker-controlled");
    assert.ok(sent["Content-Type"] || sent["content-type"], "Content-Type should be forwarded");
    assert.ok(sent["SOAPAction"] || sent["soapaction"], "SOAPAction should be forwarded");
    assert.ok(sent["Accept"] || sent["accept"], "Accept should be forwarded");

    const lowerNames = lowerHeaderNames(sent);
    for (const forbidden of [
      "authorization",
      "cookie",
      "proxy-authorization",
      "host",
      "origin",
      "referer",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-real-ip",
      "x-api-key",
      "x-auth-token",
      "cf-connecting-ip",
      "true-client-ip",
      "forwarded",
      "via",
      "connection",
      "content-length",
      "transfer-encoding",
      "expect",
      "keep-alive",
      "te",
      "upgrade",
    ]) {
      assert.ok(!lowerNames.includes(forbidden), `${forbidden} must not be forwarded upstream`);
    }
  });
});

test("sabit User-Agent kullanılır; payload User-Agent ile override edilemez", async () => {
  resetProxyState();
  await withStubbedFetch(() => upstream("ok"), async (calls) => {
    const response = await onRequest({
      request: jsonPost({
        url: ALLOWED_URL,
        method: "GET",
        headers: { "User-Agent": "evil-agent", "user-agent": "evil-agent-2" },
      }),
    });
    assert.equal(response.status, 200);
    const sent = calls[0].options.headers;
    assert.ok(sent["User-Agent"]);
    assert.notEqual(sent["User-Agent"], "evil-agent");
    assert.notEqual(sent["User-Agent"], "evil-agent-2");
    assert.ok(!lowerHeaderNames(sent).includes("user-agent") || sent["User-Agent"] !== "evil-agent");
    assert.equal(lowerHeaderNames(sent).filter((n) => n === "user-agent").length, 1);
  });
});

test("yöntem kısıtları: dış istek yalnızca GET/POST/OPTIONS; proxy payload yalnızca GET/POST", async () => {
  resetProxyState();

  await withStubbedFetch(() => {
    throw new Error("method rejection must not call upstream");
  }, async (calls) => {
    for (const method of ["PUT", "PATCH", "DELETE", "HEAD", "PROPFIND"]) {
      const response = await onRequest({ request: new Request(PROXY_URL, { method }) });
      assert.equal(response.status, 405, `outer ${method} should be 405`);
      assertCors(response);
      assert.equal((await response.json()).error, "Method not allowed");
    }
    assert.equal(calls.length, 0);
  });

  await withStubbedFetch(() => upstream("ok"), async (calls) => {
    for (const method of ["DELETE", "PUT", "PATCH", "OPTIONS", "HEAD", "CONNECT", "TRACE", "PROPFIND", "GET,POST", "GET POST", "GET\n"]) {
      const response = await onRequest({ request: jsonPost({ url: ALLOWED_URL, method }) });
      assert.equal(response.status, 405, `payload method ${method} should be 405`);
      assert.equal((await response.json()).error, "Method not allowed");
      assertCors(response);
    }
    assert.equal(calls.length, 0);
  });

  // küçük harf method adları kabul edilir; eksik method GET varsayılır.
  await withStubbedFetch(() => upstream("ok"), async (calls) => {
    const lower = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=lower-get`, method: "get" }) });
    assert.equal(lower.status, 200);
    assert.equal(calls.at(-1).options.method, "GET");

    const lowerPost = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=lower-post`, method: "post", body: "x" }) });
    assert.equal(lowerPost.status, 200);
    assert.equal(calls.at(-1).options.method, "POST");

    const missing = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=missing-method` }) });
    assert.equal(missing.status, 200);
    assert.equal(calls.at(-1).options.method, "GET");
  });
});

test("CORS başlıkları 200/403/405/502 yanıtlarında da mevcuttur", async () => {
  resetProxyState();

  await withStubbedFetch(() => upstream("ok"), async () => {
    const ok = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=cors-ok`, method: "GET" }) });
    assert.equal(ok.status, 200);
    assertCors(ok);
  });

  await withStubbedFetch(() => upstream("ok"), async () => {
    const forbidden = await onRequest({ request: jsonPost({ url: "https://example.com/", method: "GET" }) });
    assert.equal(forbidden.status, 403);
    assertCors(forbidden);

    const methodNotAllowed = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=cors-405`, method: "DELETE" }) });
    assert.equal(methodNotAllowed.status, 405);
    assertCors(methodNotAllowed);
  });

  await withStubbedFetch(() => {
    throw new Error("boom");
  }, async () => {
    const badGateway = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=cors-502`, method: "GET" }) });
    assert.equal(badGateway.status, 502);
    assertCors(badGateway);
  });
});

test("upstream yanıtı geçirilir; hassas upstream response header'ları sızdırılmaz", async () => {
  resetProxyState();
  await withStubbedFetch(() => upstream("upstream-body", {
    status: 201,
    headers: {
      "Content-Type": "application/vnd.test+json",
      "Set-Cookie": "secret=1; HttpOnly",
      "Authorization": "Bearer secret",
      "WWW-Authenticate": "Basic realm=secret",
      "Proxy-Authenticate": "Basic",
      Location: "http://127.0.0.1/secret",
      "X-Secret": "secret",
    },
  }), async () => {
    const response = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=upstream-headers`, method: "GET" }) });
    assert.equal(response.status, 201);
    assert.equal(await response.text(), "upstream-body");
    assert.equal(response.headers.get("Content-Type"), "application/vnd.test+json");
    assertCors(response);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Authorization"), null);
    assert.equal(response.headers.get("WWW-Authenticate"), null);
    assert.equal(response.headers.get("Proxy-Authenticate"), null);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("X-Secret"), null);
  });
});

test("geçersiz gövde 400", async (t) => {
  resetProxyState();

  await t.test("malformed JSON body returns 400", async () => {
    await withStubbedFetch(() => {
      throw new Error("invalid body must not call upstream");
    }, async (calls) => {
      const response = await onRequest({ request: jsonPost(null, { rawBody: "not-json" }) });
      assert.equal(response.status, 400);
      assertCors(response);
      assert.equal(calls.length, 0);
    });
  });

  await t.test("empty POST body returns 400", async () => {
    await withStubbedFetch(() => {
      throw new Error("invalid body must not call upstream");
    }, async (calls) => {
      const response = await onRequest({ request: jsonPost(null, { rawBody: "" }) });
      assert.equal(response.status, 400);
      assertCors(response);
      assert.equal(calls.length, 0);
    });
  });

  await t.test("non-object JSON bodies return 400", async () => {
    await withStubbedFetch(() => {
      throw new Error("invalid body must not call upstream");
    }, async (calls) => {
      for (const rawBody of ["null", "[]", '"string"', "123", "true"]) {
        const response = await onRequest({ request: jsonPost(null, { rawBody }) });
        assert.equal(response.status, 400, `body ${rawBody} should be 400`);
        assertCors(response);
      }
      assert.equal(calls.length, 0);
    });
  });

  await t.test("invalid JSON content type is still invalid body when body is not JSON", async () => {
    await withStubbedFetch(() => {
      throw new Error("invalid body must not call upstream");
    }, async (calls) => {
      const response = await onRequest({
        request: new Request(PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "not-json",
        }),
      });
      assert.equal(response.status, 400);
      assertCors(response);
      assert.equal(calls.length, 0);
    });
  });
});

test("yönlendirme hileleri 403: allowlisted host redirect/disallowed'a geçemez", async (t) => {
  resetProxyState();

  await t.test("input URL redirect-like tricks targeting disallowed hosts are forbidden", async () => {
    await withStubbedFetch(() => {
      throw new Error("redirect-like disallowed target must not call upstream");
    }, async (calls) => {
      const disallowed = [
        "https://api.ibb.gov.tr.evil.test/",
        "https://api.ibb.gov.tr@evil.test/",
        "https://evil.test\\@api.ibb.gov.tr/",
        "https://evil.test#api.ibb.gov.tr",
        "https://evil.test?next=https://api.ibb.gov.tr",
        "https://evil.test/redirect?to=https://api.ibb.gov.tr",
      ];

      for (const url of disallowed) {
        const response = await onRequest({ request: jsonPost({ url, method: "GET" }) });
        assert.equal(response.status, 403, `${url} should be forbidden`);
        assertCors(response);
      }
      assert.equal(calls.length, 0);
    });
  });

  await t.test("upstream redirect to disallowed host is not followed and returns 403", async () => {
    await withStubbedFetch((url, options, calls) => {
      if (String(url).startsWith("https://api.ibb.gov.tr/")) {
        return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/secret" } });
      }
      calls.push({ url: String(url), options });
      return upstream("should-not-happen");
    }, async (calls) => {
      const response = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=redirect`, method: "GET" }) });
      assert.equal(response.status, 403);
      assertCors(response);
      assert.ok(!calls.some((c) => c.url.includes("127.0.0.1")), "disallowed redirect target must not be fetched");
      assert.ok(!calls.some((c) => c.url.includes("localhost")), "localhost redirect target must not be fetched");
    });
  });

  await t.test("proxy asks fetch for manual redirects", async () => {
    await withStubbedFetch(() => upstream("ok"), async (calls) => {
      const response = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=manual-redirect`, method: "GET" }) });
      assert.equal(response.status, 200);
      assert.equal(calls[0].options.redirect, "manual");
    });
  });
});

for (const [name, requestProxy] of [
  ["Pages", (request) => onRequest({ request })],
  ["Workers", (request) => worker.fetch(request)],
]) {
  test(`${name} validates proxy requests and redirect chains`, async (t) => {
    resetProxyState();

    await t.test("rejects invalid JSON envelopes and media types before fetching", async () => {
      const invalidRequests = [
        ...["", "{", "null", "[]", '"string"', "123", "false"].map(
          (rawBody) => jsonPost(null, { rawBody }),
        ),
        jsonPost({ url: ALLOWED_URL }, { headers: { "Content-Type": "text/plain" } }),
        new Request(PROXY_URL, {
          method: "POST",
          body: new TextEncoder().encode(JSON.stringify({ url: ALLOWED_URL })),
        }),
      ];
      await withStubbedFetch(() => upstream(), async (calls) => {
        for (const request of invalidRequests) {
          const response = await requestProxy(request);
          assert.equal(response.status, 400);
          assertCors(response);
          assert.equal(typeof (await response.json()).error, "string");
        }
        assert.equal(calls.length, 0);
      });
    });

    await t.test("follows relative and absolute allowed redirects with manual fetches", async () => {
      const redirectUrl = new URL("./next", ALLOWED_URL).href;
      const finalUrl = "https://api.transitous.org/__proxy_test__/final";
      await withStubbedFetch((url) => {
        if (url === ALLOWED_URL) return new Response(null, { status: 307, headers: { Location: "./next" } });
        if (url === redirectUrl) return Response.redirect(finalUrl, 303);
        return upstream();
      }, async (calls) => {
        const response = await requestProxy(jsonPost({
          url: ALLOWED_URL,
          method: "POST",
          body: "payload",
          headers: { "Content-Type": "text/xml" },
        }, { headers: { "Content-Type": "Application/JSON; charset=utf-8" } }));
        assert.equal(response.status, 200);
        assert.equal(await response.text(), "upstream-ok");
        assert.deepEqual(calls.map(({ url }) => url), [ALLOWED_URL, redirectUrl, finalUrl]);
        assert.ok(calls.every(({ options }) => options.redirect === "manual"));
        assert.deepEqual(calls.map(({ options }) => [options.method, options.body]), [
          ["POST", "payload"], ["POST", "payload"], ["GET", undefined],
        ]);
      });
    });

    await t.test("rejects a disallowed target after an allowed hop", async () => {
      const redirectUrl = new URL("./next", ALLOWED_URL).href;
      await withStubbedFetch((url) => new Response(null, {
        status: 302,
        headers: { Location: url === ALLOWED_URL ? "./next" : "//example.test/blocked" },
      }), async (calls) => {
        const response = await requestProxy(getProxy(ALLOWED_URL));
        assert.equal(response.status, 403);
        assertCors(response);
        assert.deepEqual(calls.map(({ url }) => url), [ALLOWED_URL, redirectUrl]);
        assert.ok(calls.every(({ options }) => options.redirect === "manual"));
      });
    });

    await t.test("stops redirect loops after five hops", async () => {
      await withStubbedFetch(() => new Response(null, {
        status: 308,
        headers: { Location: ALLOWED_URL },
      }), async (calls) => {
        const response = await requestProxy(getProxy(ALLOWED_URL));
        assert.equal(response.status, 502);
        assertCors(response);
        assert.equal(calls.length, 6);
      });
    });
  });
}

test("upstream hata davranışı", async (t) => {
  resetProxyState();

  await t.test("upstream HTTP error status is passed through without converting to 502", async () => {
    await withStubbedFetch(() => upstream("upstream-error", { status: 500, headers: { "Content-Type": "application/json" } }), async () => {
      const response = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=upstream-500`, method: "GET" }) });
      assert.equal(response.status, 500);
      assert.equal(await response.text(), "upstream-error");
      assertCors(response);
    });
  });

  await t.test("upstream 404 is passed through", async () => {
    await withStubbedFetch(() => upstream("not-found", { status: 404 }), async () => {
      const response = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=upstream-404`, method: "GET" }) });
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "not-found");
    });
  });

  await t.test("fetch rejection returns 502 JSON", async () => {
    await withStubbedFetch(() => {
      throw new Error("network down");
    }, async () => {
      const response = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=fetch-error`, method: "GET" }) });
      assert.equal(response.status, 502);
      assertCors(response);
      const body = await response.json();
      assert.equal(body.error, "network down");
    });
  });

  await t.test("upstream response body read error returns 502 JSON", async () => {
    await withStubbedFetch(() => {
      const res = new Response("x");
      res.text = async () => { throw new Error("body read failed"); };
      return res;
    }, async () => {
      const response = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=body-error`, method: "GET" }) });
      assert.equal(response.status, 502);
      assertCors(response);
      assert.equal((await response.json()).error, "body read failed");
    });
  });
});

test("upstream timeout davranışı", async (t) => {
  resetProxyState();

  await t.test("AbortSignal is passed upstream; abort/timeout rejection returns 502", async () => {
    await withStubbedFetch((url, options) => {
      assert.ok(options.signal instanceof AbortSignal, "upstream fetch must receive AbortSignal");
      assert.equal(options.signal.aborted, false);
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }, async () => {
      const response = await onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=abort-error`, method: "GET" }) });
      assert.equal(response.status, 502);
      assertCors(response);
      const body = await response.json();
      assert.ok(typeof body.error === "string");
    });
  });

  await t.test("pending upstream is aborted after 25s timeout and returns 502", async (t) => {
    const originalFetch = globalThis.fetch;
    t.mock.timers.enable({ apis: ["setTimeout"] });

    globalThis.fetch = (url, options = {}) => new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    });

    const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

    try {
      let settled = false;
      const pending = onRequest({ request: jsonPost({ url: `${ALLOWED_URL}?case=timeout-25s`, method: "GET" }) });
      pending.then(() => { settled = true; }, () => { settled = true; });

      // handler'ın async prolog'unu ve setTimeout(..., 25000) kaydını bekle
      await nextTurn();
      assert.equal(settled, false, "should not settle before upstream returns");

      t.mock.timers.tick(24_999);
      await nextTurn();
      assert.equal(settled, false, "should not settle before 25s timeout");

      t.mock.timers.tick(1);
      await nextTurn();
      const response = await pending;
      assert.equal(response.status, 502);
      assertCors(response);
    } finally {
      globalThis.fetch = originalFetch;
      t.mock.timers.reset();
    }
  });
});
