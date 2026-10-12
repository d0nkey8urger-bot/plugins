// Muse (muse.ai) for OpenCode and magpie, through a muse2api instance
// you run yourself.
//
// muse2api (https://github.com/czg86389-hub/muse2api) turns the muse.ai
// web app into an OpenAI-compatible API served from your own machine.
// That instance does all the work the other packages here do in their
// loaders — driving the site, keeping the sign-in alive — so this
// plugin is an adapter: it tells OpenCode / magpie where the instance
// lives, which key it takes and which models it serves.
//
// Signing in is connecting to an instance: the guided method asks for
// the instance's address and its MUSE2API_KEY, and checks both against
// the live instance before anything is saved — a wrong address or key
// fails there, in words, not later as a dead provider. The Muse
// account itself is imported into the instance, never here.
//
// The instance's /admin endpoints hold its account pool, so the
// plugin calls them only when the address is on this machine
// (loopback) — or when the user opts in for an instance elsewhere
// (MUSE2API_ALLOW_REMOTE_ADMIN=1). Checking a sign-in anywhere uses
// /v1/models, an ordinary authenticated endpoint.

const ID = "muse2api"
const CHAT = "@ai-sdk/openai-compatible"
const DEFAULT_BASE = "http://127.0.0.1:18610/v1"

// The instance's own list (its GET /v1/models) has three capabilities:
// muse-spark for chat and code, muse-image and muse-video for media.
// Only muse-spark is a chat model an agent can be given. The list is
// re-read from the instance when it answers (the models hook below);
// this static copy is what an agent sees before sign-in and whenever
// the instance does not answer. muse.ai routes behind its web UI and
// publishes no context size, so the limits stay 0 (not said), as the
// other packages leave what a vendor does not say.
const MODELS = [{ id: "muse-spark", name: "Muse Spark" }]
const MEDIA_ID = /image|video/

// Where the instance lives, best source first: the address saved with
// the sign-in (the guided method puts it in the auth metadata), the
// provider's baseURL option, MUSE2API_BASE_URL, the default.
function baseURL(provider, auth) {
  const fromAuth = auth?.metadata?.base
  const fromOptions = provider?.options?.baseURL ?? provider?.options?.baseUrl
  const raw = fromAuth || fromOptions || process.env.MUSE2API_BASE_URL || DEFAULT_BASE
  return String(raw).replace(/\/+$/, "")
}

// The instance's admin endpoints live at its root, not under /v1.
function adminURL(base, path) {
  return base.replace(/\/v1$/, "") + path
}

function isLoopback(base) {
  try {
    const h = new URL(base).hostname.replace(/^\[|\]$/g, "").toLowerCase()
    return h === "localhost" || h.endsWith(".localhost") || h === "::1" || h.startsWith("127.")
  } catch {
    return false
  }
}

function adminAllowed(base, env = process.env) {
  return isLoopback(base) || env.MUSE2API_ALLOW_REMOTE_ADMIN === "1"
}

function modelEntry(m) {
  return {
    name: m.name,
    limit: { context: 0, output: 0 },
    // the instance's chat endpoint hands tool calls back in OpenAI's
    // shape (it parses them out of the web model's reply), so an
    // agent's tools work as they do on a native endpoint
    tool_call: true,
  }
}

async function ask(base, key, url, timeoutMs = 10_000) {
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    throw new Error(`Couldn't reach a muse2api instance at ${base} — is it running? (${e?.cause?.message ?? e.message})`)
  }
}

// probe checks an address and key against the live instance and,
// where /admin may be called (see the header), reads its account
// pool. A wrong key and a dead address are different failures and
// are said differently; a pool that cannot be read is not fatal —
// the key was accepted, which is what sign-in promises. The pool of
// an instance elsewhere is "remote": deliberately not read.
async function probe(base, key) {
  const res = await ask(base, key, `${base}/models`)
  if (res.status === 401 || res.status === 403)
    throw new Error(`The instance at ${base} refused that key — it isn't the MUSE2API_KEY the instance was started with (see its .env).`)
  if (!res.ok) throw new Error(`The instance at ${base} answered /v1/models with ${res.status} — is that really a muse2api instance?`)
  if (!adminAllowed(base)) return "remote"
  try {
    const s = await ask(base, key, adminURL(base, "/admin/status"))
    if (s.ok) return (await s.json())?.stats ?? null
  } catch {}
  return null
}

// connect is the guided sign-in: the two prompts, checked live. The
// callback's result is what magpie keeps: an api sign-in whose key is
// the instance's and whose metadata.base is where it lives, as the
// other packages' browser sign-ins land.
async function connect(inputs) {
  const base = String(inputs?.base ?? "").trim().replace(/\/+$/, "") || DEFAULT_BASE
  const key = String(inputs?.key ?? "").trim()
  let u
  try {
    u = new URL(base)
  } catch {
    throw new Error(`"${base}" isn't an address — the instance address looks like ${DEFAULT_BASE}`)
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`"${base}" isn't an http(s) address — the instance address looks like ${DEFAULT_BASE}`)
  if (!key) throw new Error("Paste the instance's MUSE2API_KEY — it's the MUSE2API_KEY line in the .env the instance was started with.")
  const pool = await probe(base, key)
  const ready = pool && pool !== "remote" ? `${pool.healthy ?? 0} of ${pool.enabled ?? pool.total ?? 0} Muse accounts ready` : null
  return {
    url: "",
    instructions:
      pool === "remote"
        ? `Connected to the instance at ${base}. It is not on this machine: the key and the account pool live at that address, and the plugin reads an instance's pool only on this machine (or with MUSE2API_ALLOW_REMOTE_ADMIN=1), so the pool is not shown for it here.`
        : pool && (pool.total ?? 0) === 0
          ? `Connected to the instance at ${base}, but it has no Muse account yet — import one there (its tools/get_muse_cookie.py needs no browser extension), then this provider can answer.`
          : `Connected to the instance at ${base}${ready ? `: ${ready}` : ""}.`,
    method: "auto",
    callback: async () => ({ type: "success", provider: ID, key, metadata: { base } }),
  }
}

export async function Muse2apiPlugin({ client } = {}) {
  return {
    auth: {
      provider: ID,
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return {}
        // the instance takes its key as a plain bearer token, which is
        // what the AI SDK sends apiKey as — no signing fetch is needed
        const { key } = auth
        return { baseURL: baseURL(provider, auth), apiKey: key }
      },
      methods: [
        {
          type: "oauth",
          label: "Connect to a muse2api instance",
          prompts: [
            { type: "text", key: "base", message: "Your muse2api instance address (its key and account pool live at this address)", placeholder: DEFAULT_BASE },
            { type: "text", key: "key", message: "Its MUSE2API_KEY", placeholder: "m2a_…" },
          ],
          authorize: connect,
        },
        { type: "api", label: "muse2api key (the MUSE2API_KEY of your instance)" },
      ],
      // magpie's usage card: the instance's account pool, from its
      // /admin/status — how many Muse accounts it holds and how many
      // are ready to answer
      async usage(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return { error: "not signed in", signIn: "kept" }
        const base = baseURL(undefined, auth)
        if (!adminAllowed(base))
          return {
            error: "the account pool is read only from an instance on this machine — set MUSE2API_ALLOW_REMOTE_ADMIN=1 to read it from this remote instance",
            signIn: "kept",
          }
        let res
        try {
          res = await ask(base, auth.key, adminURL(base, "/admin/status"))
        } catch (e) {
          return { error: e.message, signIn: "kept" }
        }
        if (!res.ok) return { error: `the instance at ${base} answered /admin/status with ${res.status}`, signIn: "kept" }
        const stats = (await res.json().catch(() => null))?.stats
        if (!stats) return { error: `the instance at ${base} sent no account stats`, signIn: "kept" }
        if (!stats.total) return { error: "no Muse accounts imported into the instance yet", signIn: "kept" }
        const enabled = stats.enabled ?? stats.total
        const healthy = stats.healthy ?? 0
        return {
          plan: "muse2api instance",
          windows: [
            {
              name: "Accounts",
              used: enabled > 0 ? Math.round((100 * (enabled - healthy)) / enabled) : 0,
              display: `${healthy} of ${enabled} accounts ready`,
            },
          ],
          signIn: "kept",
        }
      },
    },
    async config(config) {
      config.provider ??= {}
      const was = config.provider[ID] ?? {}
      config.provider[ID] = {
        name: "Muse (muse2api)",
        npm: CHAT,
        api: baseURL(),
        ...was,
        models: { ...Object.fromEntries(MODELS.map((m) => [m.id, modelEntry(m)])), ...(was.models ?? {}) },
      }
    },
    // the instance's own list, read live: what it serves is the
    // account's answer, so a model the instance gains appears here
    // without a plugin update. Media models are endpoints an agent
    // cannot chat with and are left out. When the instance does not
    // answer, the declared list stands.
    provider: {
      id: ID,
      async models(provider, { auth } = {}) {
        if (auth?.type !== "api" || !auth.key) return provider.models
        try {
          const base = baseURL(provider, auth)
          const res = await ask(base, auth.key, `${base}/models`, 8_000)
          if (!res.ok) return provider.models
          const list = ((await res.json())?.data ?? []).filter((m) => m?.id && !MEDIA_ID.test(m.id))
          if (!list.length) return provider.models
          return Object.fromEntries(
            list.map((m) => [m.id, modelEntry({ id: m.id, name: m.id === "muse-spark" ? "Muse Spark" : m.id })]),
          )
        } catch {
          return provider.models
        }
      },
    },
  }
}
