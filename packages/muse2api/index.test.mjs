import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"
import { Muse2apiPlugin } from "./index.mjs"

const ctx = { client: { app: { log: async () => {} }, auth: { set: async () => {} } } }
const signedIn = async () => ({ type: "api", key: "m2a_test_key" })

// A stub muse2api instance: /v1/models and /admin/status behind the
// one key, 401 without it — the shape the real service answers in.
async function stubInstance(t, stats = { total: 3, enabled: 3, healthy: 2 }) {
  const server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer m2a_test_key") {
      res.writeHead(401, { "content-type": "application/json" })
      return res.end(JSON.stringify({ error: "unauthorized" }))
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "muse-spark" }, { id: "muse-image" }, { id: "muse-video" }],
        }),
      )
    }
    if (req.url === "/admin/status") {
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(JSON.stringify({ stats }))
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}/v1`
}

test("auth hook: the provider, a loader, a guided connect and a key method", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  assert.equal(hooks.auth.provider, "muse2api")
  assert.equal(typeof hooks.auth.loader, "function")
  assert.equal(hooks.auth.methods.length, 2)
  const [connect, key] = hooks.auth.methods
  assert.equal(connect.type, "oauth")
  assert.equal(typeof connect.authorize, "function")
  assert.deepEqual(
    connect.prompts.map((p) => p.key),
    ["base", "key"],
  )
  assert.equal(key.type, "api")
})

test("loader: nothing until signed in with a key", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  assert.deepEqual(await hooks.auth.loader(async () => undefined), {})
  assert.deepEqual(await hooks.auth.loader(async () => ({ type: "oauth" })), {})
  assert.deepEqual(await hooks.auth.loader(async () => ({ type: "api" })), {})
})

test("loader: the instance's default address and the pasted key", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.loader(signedIn)
  assert.equal(out.apiKey, "m2a_test_key")
  assert.equal(out.baseURL, "http://127.0.0.1:18610/v1")
})

test("loader: the address saved by the guided connect wins over everything", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const auth = async () => ({ type: "api", key: "m2a_test_key", metadata: { base: "http://10.0.0.9:18610/v1" } })
  const out = await hooks.auth.loader(auth, { options: { baseURL: "http://192.168.1.10:18610/v1" } })
  assert.equal(out.baseURL, "http://10.0.0.9:18610/v1")
})

test("loader: a baseURL in the provider options wins, slashes trimmed", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.loader(signedIn, { options: { baseURL: "http://192.168.1.10:18610/v1/" } })
  assert.equal(out.baseURL, "http://192.168.1.10:18610/v1")
})

test("loader: MUSE2API_BASE_URL moves the instance when nothing else is set", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  process.env.MUSE2API_BASE_URL = "http://example.test:18610/v1"
  try {
    const out = await hooks.auth.loader(signedIn, {})
    assert.equal(out.baseURL, "http://example.test:18610/v1")
  } finally {
    delete process.env.MUSE2API_BASE_URL
  }
})

test("connect: a live instance is checked, then the sign-in is saved with its address", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const connect = hooks.auth.methods[0]
  const offer = await connect.authorize({ base, key: "m2a_test_key" })
  assert.equal(offer.method, "auto")
  assert.match(offer.instructions, /2 of 3 Muse accounts ready/)
  const done = await offer.callback()
  assert.equal(done.type, "success")
  assert.equal(done.provider, "muse2api")
  assert.equal(done.key, "m2a_test_key")
  assert.equal(done.metadata.base, base)
})

test("connect: an empty address falls back to the instance's default", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const connect = hooks.auth.methods[0]
  // the stub is not at the default address, so this cannot succeed —
  // and whichever way it fails (nothing there, or an instance that
  // refuses the stub's key), the error names the default address,
  // which is what proves the default was used
  await assert.rejects(() => connect.authorize({ base: "", key: "m2a_test_key" }), /127\.0\.0\.1:18610/)
  assert.ok(base)
})

test("connect: a wrong key is refused in words", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  await assert.rejects(() => hooks.auth.methods[0].authorize({ base, key: "m2a_wrong" }), /refused that key/)
})

test("connect: a dead address is unreachable in words", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  await assert.rejects(
    () => hooks.auth.methods[0].authorize({ base: "http://127.0.0.1:1/v1", key: "m2a_test_key" }),
    /Couldn't reach a muse2api instance/,
  )
})

test("connect: a bad address and a missing key are said plainly", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  await assert.rejects(() => hooks.auth.methods[0].authorize({ base: "not a url", key: "x" }), /isn't an address/)
  await assert.rejects(
    () => hooks.auth.methods[0].authorize({ base: "http://127.0.0.1:18610/v1", key: " " }),
    /MUSE2API_KEY/,
  )
})

test("models hook: the instance's live list, media models left out", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const auth = { type: "api", key: "m2a_test_key", metadata: { base } }
  const out = await hooks.provider.models({ models: { stale: { name: "Stale" } } }, { auth })
  assert.deepEqual(Object.keys(out), ["muse-spark"])
  assert.equal(out["muse-spark"].name, "Muse Spark")
  assert.equal(out["muse-spark"].tool_call, true)
})

test("models hook: the declared list stands when the instance does not answer", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const declared = { "muse-spark": { name: "Muse Spark" } }
  const auth = { type: "api", key: "m2a_test_key", metadata: { base: "http://127.0.0.1:1/v1" } }
  assert.deepEqual(await hooks.provider.models({ models: declared }, { auth }), declared)
  assert.deepEqual(await hooks.provider.models({ models: declared }, { auth: undefined }), declared)
})

test("usage: the account pool as magpie's card shows it", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const getAuth = async () => ({ type: "api", key: "m2a_test_key", metadata: { base } })
  const out = await hooks.auth.usage(getAuth)
  assert.equal(out.plan, "muse2api instance")
  assert.equal(out.windows[0].name, "Accounts")
  assert.equal(out.windows[0].display, "2 of 3 accounts ready")
  assert.equal(out.windows[0].used, 33)
  assert.equal(out.signIn, "kept")
})

test("usage: an instance with no accounts says so", async (t) => {
  const base = await stubInstance(t, { total: 0, enabled: 0, healthy: 0 })
  const hooks = await Muse2apiPlugin(ctx)
  const getAuth = async () => ({ type: "api", key: "m2a_test_key", metadata: { base } })
  const out = await hooks.auth.usage(getAuth)
  assert.match(out.error, /no Muse accounts imported/)
})

test("usage: not signed in is an error, not a crash", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.usage(async () => undefined)
  assert.equal(out.error, "not signed in")
})

test("config hook: declares the provider, its protocol and its model", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const cfg = { provider: {} }
  await hooks.config(cfg)
  const p = cfg.provider.muse2api
  assert.equal(p.npm, "@ai-sdk/openai-compatible")
  assert.equal(p.api, "http://127.0.0.1:18610/v1")
  assert.deepEqual(Object.keys(p.models), ["muse-spark"])
  assert.equal(p.models["muse-spark"].tool_call, true)
})

test("config hook: a user's own model entries survive", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const cfg = { provider: { muse2api: { models: { mine: { name: "Mine" } } } } }
  await hooks.config(cfg)
  assert.deepEqual(Object.keys(cfg.provider.muse2api.models).sort(), ["mine", "muse-spark"])
})

// ---- the /admin boundary: an instance's pool is read only on this
// machine, unless the user opts in for a remote one -----------------

// fetch replaced for one test: the module reads the global at call
// time, so a remote instance is simulated without a network.
function stubFetch(t, handler) {
  const real = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return handler(String(url))
  }
  t.after(() => {
    globalThis.fetch = real
  })
  return calls
}
const jsonRes = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const remoteAuth = async () => ({ type: "api", key: "m2a_remote", metadata: { base: "http://10.0.0.9:18610/v1" } })

test("connect: a remote instance is validated by /v1 only — its pool is never read", async (t) => {
  const calls = stubFetch(t, (url) =>
    url.endsWith("/v1/models") ? jsonRes(200, { object: "list", data: [{ id: "muse-spark" }] }) : jsonRes(404, {}),
  )
  const hooks = await Muse2apiPlugin(ctx)
  const offer = await hooks.auth.methods[0].authorize({ base: "http://10.0.0.9:18610/v1", key: "m2a_remote" })
  assert.match(offer.instructions, /not on this machine/)
  assert.match(offer.instructions, /account pool live at that address/)
  assert.ok(calls.length > 0 && calls.every((u) => !u.includes("/admin/")), `no /admin call, got: ${calls}`)
  const done = await offer.callback()
  assert.equal(done.type, "success")
  assert.equal(done.metadata.base, "http://10.0.0.9:18610/v1")
})

test("connect: a remote instance still refuses a wrong key in words", async (t) => {
  stubFetch(t, () => jsonRes(401, { error: "unauthorized" }))
  const hooks = await Muse2apiPlugin(ctx)
  await assert.rejects(
    () => hooks.auth.methods[0].authorize({ base: "http://10.0.0.9:18610/v1", key: "m2a_wrong" }),
    /refused that key/,
  )
})

test("usage: a remote instance's pool is not read without the opt-in", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.usage(remoteAuth)
  assert.match(out.error, /MUSE2API_ALLOW_REMOTE_ADMIN=1/)
  assert.equal(out.signIn, "kept")
})

test("usage: the opt-in reads a remote instance's pool", async (t) => {
  stubFetch(t, (url) =>
    url.endsWith("/admin/status") ? jsonRes(200, { stats: { total: 2, enabled: 2, healthy: 1 } }) : jsonRes(404, {}),
  )
  process.env.MUSE2API_ALLOW_REMOTE_ADMIN = "1"
  t.after(() => delete process.env.MUSE2API_ALLOW_REMOTE_ADMIN)
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.usage(remoteAuth)
  assert.equal(out.windows[0].display, "1 of 2 accounts ready")
})

test("connect: with the opt-in, a remote instance's pool is read and reported", async (t) => {
  stubFetch(t, (url) => {
    if (url.endsWith("/v1/models")) return jsonRes(200, { object: "list", data: [{ id: "muse-spark" }] })
    if (url.endsWith("/admin/status")) return jsonRes(200, { stats: { total: 2, enabled: 2, healthy: 1 } })
    return jsonRes(404, {})
  })
  process.env.MUSE2API_ALLOW_REMOTE_ADMIN = "1"
  t.after(() => delete process.env.MUSE2API_ALLOW_REMOTE_ADMIN)
  const hooks = await Muse2apiPlugin(ctx)
  const offer = await hooks.auth.methods[0].authorize({ base: "http://10.0.0.9:18610/v1", key: "m2a_remote" })
  assert.match(offer.instructions, /1 of 2 Muse accounts ready/)
})
