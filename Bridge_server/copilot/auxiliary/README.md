# Copilot Auxiliary Providers

Alternatives to the default Anthropic provider in `copilot/default/`.
Each requires IT approval or additional infrastructure.
See `AI-notes.md` in the project root for full approval guidance.

Switch provider with one line in `.env` then restart the bridge:

```bash
COPILOT_PROVIDER=github      # GitHub Models — Claude Opus via existing Copilot licence
COPILOT_PROVIDER=azure       # Azure OpenAI — stays in corporate Azure tenant
COPILOT_PROVIDER=ollama      # Local Ollama   — fully on-premises, no external calls
COPILOT_PROVIDER=lmstudio    # Local LM Studio — fully on-premises, no external calls
```

---

## github-models.js  ←  Recommended first choice if Anthropic is blocked

Uses your existing GitHub Copilot licence. No new vendor. Gives Claude Opus.

### Create a GitHub PAT

github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)
→ Generate new token → scope: `models:read` only → copy the `ghp_...` token

### .env

```bash
COPILOT_PROVIDER=github
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_MODEL=claude-opus-4-5
```

### Available models

| Model | Notes |
|-------|-------|
| `claude-opus-4-5` | Most capable — recommended |
| `claude-sonnet-4-5` | Faster |
| `gpt-4o` | OpenAI via GitHub |
| `gpt-4o-mini` | Higher rate limits |

Rate limits (preview): 10 req/min, 50 req/day for high-tier models.

---

## azure-openai.js  ←  Best when IT requires Azure data boundary

IT needs to provision: Azure OpenAI resource + GPT-4o deployment + API key.

### .env

```bash
COPILOT_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_KEY=your-key-here
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

---

## ollama.js  ←  Fully on-premises, no external calls

```bash
# WSL2 — install and pull a model
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1

# .env
COPILOT_PROVIDER=ollama
OLLAMA_MODEL=llama3.1
OLLAMA_HOST=http://host.docker.internal:11434   # optional, this is the default
```

The bridge runs inside a Docker container, so `localhost` refers to the
container itself, not the machine Ollama is actually running on — use
`host.docker.internal` (already wired up via `extra_hosts` in
`docker-compose.yml`). The provider also auto-retries against
`host.docker.internal` if a configured `localhost`/`127.0.0.1` host is
unreachable, so the AI Config tab's default URL field (which browsers
correctly read as `localhost`) still works out of the box.

Minimum 8 GB RAM. GPU optional but significantly faster.

---

## lmstudio.js  ←  Fully on-premises, no external calls

For orgs that standardise on [LM Studio](https://lmstudio.ai) instead of Ollama.
LM Studio ships an OpenAI-compatible server, so no API key is needed.

```bash
# 1. Install LM Studio and download a model from its in-app catalog
#    (e.g. Qwen2.5-Coder, Llama-3.1, Mistral)
# 2. Developer tab → Start Server  (defaults to http://localhost:1234)
# 3. Verify:  curl http://localhost:1234/v1/models

# .env
COPILOT_PROVIDER=lmstudio
LMSTUDIO_MODEL=qwen2.5-coder-7b-instruct   # the loaded model's id
LMSTUDIO_HOST=http://localhost:1234        # optional, this is the default
```

`LMSTUDIO_MODEL` is optional — if omitted, LM Studio uses whichever model is
currently loaded. Minimum 8 GB RAM; GPU optional but significantly faster.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| GitHub 401 | Token expired or missing `models:read` scope — regenerate |
| GitHub 429 | Rate limited — wait 60s or switch to `gpt-4o-mini` |
| Azure 404 | Deployment name wrong — check Azure AI Studio exactly |
| Azure 401 | API key wrong — check Azure Portal → Keys and Endpoint |
| Ollama refused | Run `ollama serve` in WSL2 or `docker compose up ollama -d` |
| Ollama model missing | Run `ollama pull llama3.1` first |
| Ollama "not reachable" while connected to an LPAR | The bridge (not your browser) is making the request from inside the container — confirm Ollama is reachable from *inside* the container: `docker compose exec tn3270-bridge curl http://host.docker.internal:11434/api/tags` |
| LM Studio refused | Open LM Studio → Developer tab → Start Server |
| LM Studio 404 on model | `LMSTUDIO_MODEL` id must match one from `/v1/models`, or leave it unset |
