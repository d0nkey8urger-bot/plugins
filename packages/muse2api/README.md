# Muse (muse2api)

Use [Muse](https://muse.ai) (Meta's assistant) as a model in Codex, OpenCode and the other agents magpie drives — through a [muse2api](https://github.com/czg86389-hub/muse2api) instance you run yourself.

muse2api turns the muse.ai web app into an OpenAI-compatible API: it drives the site from a local Chromium, keeps the session alive, and serves chat, image and video endpoints. This plugin is the adapter between magpie and that instance — it declares the model, carries the instance's address and key, reads its live model list, and shows its account pool on magpie's usage card. The Muse account itself is imported into the instance; the plugin never sees it.

> muse2api is an unofficial bridge that drives muse.ai through its web UI. Requests use your own Muse account's web quota, and the project's own caveats (terms of service, account risk) apply — whether it fits how you use your account is your call.

## Step 0 — run muse2api

On the machine your agents run on (or any machine they can reach):

```sh
git clone https://github.com/czg86389-hub/muse2api
cd muse2api
cp .env.example .env   # set MUSE2API_KEY to a key of your own in .env
docker compose up -d
```

No Docker? muse2api also runs bare on Python 3.12 with a local Chrome — see its README. Either way it listens on `http://127.0.0.1:18610` by default, and its admin page is at `http://127.0.0.1:18610/admin?key=<your MUSE2API_KEY>`.

## Step 1 — give the instance your Muse account

```sh
python3 tools/get_muse_cookie.py
```

in the muse2api folder. It opens a throwaway Chrome window; sign in to muse.ai there and it imports the session by itself — no browser extension, no Tampermonkey script, nothing pasted into a chat. (The admin page offers the other import methods too.) Sessions renew themselves, so an instance typically keeps answering for weeks unattended.

Check it worked: the admin page lists your account, and

```sh
curl http://127.0.0.1:18610/v1/models -H "Authorization: Bearer <your MUSE2API_KEY>"
```

lists `muse-spark`.

## Step 2 — connect magpie to the instance

Install this plugin, then sign in:

```sh
magpie plugin login muse2api
```

Pick **Connect to a muse2api instance**. It asks for the instance address (the default `http://127.0.0.1:18610/v1` is prefilled) and its `MUSE2API_KEY`, and **checks both against the live instance before saving anything**:

- a dead address fails there — *"Couldn't reach a muse2api instance…"*
- a wrong key fails there — *"The instance … refused that key…"*
- an instance with no Muse account yet still connects, and tells you to finish step 1

The plain key method is also offered, if you would rather not be checked. An instance at a non-default address can also be named by the provider's `baseURL` option or the `MUSE2API_BASE_URL` environment variable; the address saved at connect wins over both.

**An instance on another machine.** Connecting works the same, and the sign-in says so at the time: the key and the account pool live at that address. The plugin deliberately reads an instance's pool (its `/admin` endpoints) only when the instance is on this machine — for a remote instance, connect checks the key without reading the pool, and the usage card cannot show it. If the remote instance is yours and you do want its pool read, set `MUSE2API_ALLOW_REMOTE_ADMIN=1` in the environment magpie runs in.

In OpenCode without magpie, add `"@magpie-community/opencode-muse2api-auth"` to the `plugin` array in `opencode.json`, then `opencode auth login` and pick muse2api. Either way the key is kept in the tool's own auth store, like every other package's sign-in.

## Step 3 — use it

```sh
magpie codex muse2api/muse-spark
```

or pick `muse2api/muse-spark` in any agent magpie configures. Verify the whole chain any time with

```sh
magpie provider test muse2api
```

That sends one real (tiny) request through magpie → this plugin → your instance → muse.ai.

magpie's usage card (`magpie quota`) shows the instance's account pool — how many Muse accounts it holds and how many are ready — read live from the instance. The instance serves a bounded number of concurrent generations (2 by default), so the package caps concurrency at 2 to match.

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `Couldn't reach a muse2api instance` at sign-in | nothing is listening at that address | start the instance (step 0); check the address and port |
| `refused that key` at sign-in | the key isn't the instance's `MUSE2API_KEY` | copy it from the instance's `.env`, exactly |
| `没有可用账号` ("no accounts available") from a test or an agent | the chain works; the instance has no usable Muse account | finish step 1, or re-import — the session may have expired |
| `401` from an agent but sign-in worked | the instance was restarted with a different key | sign in again so magpie holds the current key |
| `the account pool is read only from an instance on this machine` on the usage card | the instance is at a remote address and /admin reads are off by default | set `MUSE2API_ALLOW_REMOTE_ADMIN=1` if the remote instance is yours |
| model list shows only `muse-spark` | that's the instance's chat model | `muse-image` / `muse-video` are media endpoints, not chat models, and are deliberately not offered to agents |

Good to know: muse.ai's web API returns no structured tool calls, so muse2api reconstructs them from the model's reply. Ordinary agent work holds up; very exotic tool schemas are where it can fray — if an agent misbehaves on one specific tool, that layer is why.

## Development

```sh
bun test                              # in this folder
bun scripts/check.mjs muse2api        # from the repo root
```
