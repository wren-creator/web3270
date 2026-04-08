# Copilot Auxiliary Providers

Alternatives to the default Anthropic provider in `copilot/default/`.
Each requires IT approval or additional infrastructure.
See `AI-notes.md` in the project root for full approval guidance.

Switch provider with one line in `.env` then restart the bridge:

```bash
COPILOT_PROVIDER=github      # GitHub Models — Claude Opus via existing Copilot licence
COPILOT_PROVIDER=azure       # Azure OpenAI — stays in corporate Azure tenant
COPILOT_PROVIDER=ollama      # Local Ollama  — fully on-premises, no external calls
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
```

Minimum 8 GB RAM. GPU optional but significantly faster.

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
