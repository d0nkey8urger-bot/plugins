# muse2api — Muse (muse.ai) in OpenCode and magpie

Signs in to: **a [muse2api](https://github.com/czg86389-hub/muse2api)
instance you run yourself**, which serves **Muse (muse.ai)** as an
OpenAI-compatible API. Provider id: `muse2api`.

Unlike the other packages here, this plugin does not talk to the
vendor's site. muse2api does that part: it drives the muse.ai web app
from a local Chromium, keeps the session alive (48h auto-renewal), and
exposes chat, image and video endpoints. This plugin only tells
OpenCode / magpie where the instance lives, which key it takes and
which model it serves — so signing in here means pasting the
instance's `MUSE2API_KEY`, nothing more.

## Before you sign in

1. Run muse2api on your machine (Docker Compose, or plain Python —
   no other dependencies) and set its `MUSE2API_KEY`.
2. Import your Muse account into the instance once: its browser
   extension, its Tampermonkey script, or `tools/get_muse_cookie.py`
   (a standard-library Python script that opens a throwaway Chrome
   window for you to sign in to muse.ai in — no extension needed).
3. Check the instance answers at `http://127.0.0.1:18610/v1/models`.

## Use

magpie:

```
magpie plugin add @magpie-community/opencode-muse2api-auth
magpie plugin login muse2api        # paste the instance's MUSE2API_KEY
```

OpenCode, in `opencode.json`:

```
{ "plugin": ["@magpie-community/opencode-muse2api-auth"] }
```

then `opencode auth login` and pick muse2api.

The key is kept in OpenCode's / magpie's own auth store, like every
other package's sign-in.

## Models

| Model | What it is |
| --- | --- |
| `muse-spark` | Muse Spark — chat and code, streaming, with tool calls |

The instance also serves `muse-image` and `muse-video`; those are
media endpoints, not chat models, so they are not declared here.
muse.ai routes behind its web UI and publishes no context size, so
the model declares no limits.

## Where the instance lives

Default: `http://127.0.0.1:18610/v1`. To point at an instance running
elsewhere (another machine, a VPS, a different port), set either:

- the provider's `baseURL` option in your config, or
- the environment variable `MUSE2API_BASE_URL`

The provider option wins over the environment variable.

## Notes

- Requests burn your own Muse account's web quota, through the
  instance. muse2api is an unofficial reverse-engineering project;
  its own README's caveats (terms of service, account risk) apply.
- The instance serves a bounded number of concurrent generations
  (2 by default), so the package caps concurrency at 2.
