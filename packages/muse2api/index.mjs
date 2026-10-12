// Muse (muse.ai) for OpenCode and magpie, through a muse2api instance
// you run yourself.
//
// muse2api (https://github.com/czg86389-hub/muse2api) turns the muse.ai
// web app into an OpenAI-compatible API served from your own machine.
// That instance does all the work the other packages here do in their
// loaders — driving the site, keeping the sign-in alive — so this
// plugin is only an adapter: it tells OpenCode / magpie where the
// instance lives, which key it takes and which model it serves. Its
// "sign-in" is pasting the instance's MUSE2API_KEY; the Muse account
// itself is imported into the instance, never here.

const ID = "muse2api"
const CHAT = "@ai-sdk/openai-compatible"
const DEFAULT_BASE = "http://127.0.0.1:18610/v1"

// The instance's own list (its GET /v1/models) has three capabilities:
// muse-spark for chat and code, muse-image and muse-video for media.
// Only muse-spark is a chat model an agent can be given, so it is the
// only one declared. muse.ai routes behind its web UI and publishes no
// context size, so the limits stay 0 (not said), as the other packages
// leave what a vendor does not say.
const MODELS = [{ id: "muse-spark", name: "Muse Spark" }]

// Where the instance lives: the provider's baseURL option when the
// user set one, else MUSE2API_BASE_URL, else the instance's own
// default address on this machine.
function baseURL(provider) {
  const fromOptions = provider?.options?.baseURL ?? provider?.options?.baseUrl
  const raw = fromOptions || process.env.MUSE2API_BASE_URL || DEFAULT_BASE
  return String(raw).replace(/\/+$/, "")
}

function configModel(m) {
  return {
    name: m.name,
    limit: { context: 0, output: 0 },
    // the instance's chat endpoint hands tool calls back in OpenAI's
    // shape (it parses them out of the web model's reply), so an
    // agent's tools work as they do on a native endpoint
    tool_call: true,
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
        return { baseURL: baseURL(provider), apiKey: key }
      },
      methods: [
        { type: "api", label: "muse2api key (the MUSE2API_KEY of your instance)" },
      ],
    },
    async config(config) {
      config.provider ??= {}
      const was = config.provider[ID] ?? {}
      config.provider[ID] = {
        name: "Muse (muse2api)",
        npm: CHAT,
        api: baseURL(),
        ...was,
        models: { ...Object.fromEntries(MODELS.map((m) => [m.id, configModel(m)])), ...(was.models ?? {}) },
      }
    },
  }
}
