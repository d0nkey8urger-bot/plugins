import assert from "node:assert/strict"
import test from "node:test"
import { Muse2apiPlugin } from "./index.mjs"

const ctx = { client: { app: { log: async () => {} }, auth: { set: async () => {} } } }
const signedIn = async () => ({ type: "api", key: "m2a_test_key" })

test("auth hook: the provider, a loader and one api method", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  assert.equal(hooks.auth.provider, "muse2api")
  assert.equal(typeof hooks.auth.loader, "function")
  assert.equal(hooks.auth.methods.length, 1)
  assert.equal(hooks.auth.methods[0].type, "api")
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

test("loader: a baseURL in the provider options wins, slashes trimmed", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.loader(signedIn, { options: { baseURL: "http://192.168.1.10:18610/v1/" } })
  assert.equal(out.baseURL, "http://192.168.1.10:18610/v1")
})

test("loader: MUSE2API_BASE_URL moves the instance when no option is set", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  process.env.MUSE2API_BASE_URL = "http://example.test:18610/v1"
  try {
    const out = await hooks.auth.loader(signedIn, {})
    assert.equal(out.baseURL, "http://example.test:18610/v1")
  } finally {
    delete process.env.MUSE2API_BASE_URL
  }
})

test("config hook: declares the provider, its protocol and its model", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const cfg = { provider: {} }
  await hooks.config(cfg)
  const p = cfg.provider.muse2api
  assert.equal(p.npm, "@ai-sdk/openai-compatible")
  assert.equal(p.api, "http://127.0.0.1:18610/v1")
  assert.deepEqual(Object.keys(p.models), ["muse-spark"])
  assert.equal(p.models["muse-spark"].name, "Muse Spark")
  assert.equal(p.models["muse-spark"].tool_call, true)
})

test("config hook: a user's own model entries survive", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const cfg = { provider: { muse2api: { models: { mine: { name: "Mine" } } } } }
  await hooks.config(cfg)
  assert.deepEqual(Object.keys(cfg.provider.muse2api.models).sort(), ["mine", "muse-spark"])
})
