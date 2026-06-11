# AI-notes.md — Copilot Integration Options

Notes on AI provider options for the WebTerm/3270 AI Assist panel,
written in the context of corporate policy that currently restricts
external AI APIs to limited cases.

---

## Why Microsoft Copilot (browser built-in) cannot be used

Microsoft Copilot in Edge is a browser UI feature — a sidebar that
a user interacts with manually. It has no JavaScript API that a web
page can call programmatically. There is no `window.copilot.ask()`
or equivalent. Microsoft deliberately does not expose it to web pages;
if they did, any website could silently query it on your behalf.

What the browser exposes to web pages:

```
✅ fetch()           — HTTP requests to APIs you control
✅ localStorage      — local data storage
✅ WebSocket         — connect to bridge servers
❌ Microsoft Copilot — no programmatic access
❌ Edge AI features  — no web API surface
```

The AI Assist panel in WebTerm/3270 makes a direct HTTPS call to an
AI provider's REST API from the bridge server. The provider is
configurable — see options below.

---

## Current implementation

The bridge loads the active provider from `copilot/router.js` based
on the `COPILOT_PROVIDER` environment variable. The browser UI
discovers the active provider at connect time via a `copilot.info`
WebSocket message and updates the ⚙ AI tab chip accordingly.

Provider files live under `copilot/`:

```
copilot/
├── router.js                   Reads COPILOT_PROVIDER, loads provider
├── copilot-handler.js          WebSocket handler (copilot.chat messages)
├── default/
│   └── anthropic-default.js   ← DEFAULT (Anthropic Claude)
└── auxiliary/
    ├── README.md
    ├── github-models.js
    ├── azure-openai.js
    ├── openai.js
    ├── gemini.js
    └── ollama.js
```

Switching providers is a single environment variable change — the
browser UI and all other code are unaffected.

---

## Option 1 — Anthropic API (current default)

**What it is:** Direct calls to `api.anthropic.com/v1/messages`.

**Pros:**
- Already implemented and working
- Best mainframe domain knowledge (JCL, ISPF, REXX, TSO, CP/CMS)
- Strong at generating structured macro JSON from plain-English descriptions

**Cons:**
- Requires an Anthropic API key
- External API — data leaves the corporate network
- May require IT policy exception

**Cost:** Approximately $0.001–$0.003 per question
(screen context ~1,920 chars + question + response).

**API key:** Obtain from [console.anthropic.com](https://console.anthropic.com).

**Available models (as of June 2026):**
- `claude-sonnet-4-20250514` — recommended (fast, capable)
- `claude-opus-4-20250514` — most capable
- `claude-haiku-4-5-20251001` — fastest, lowest cost

**Environment variables:**

```bash
COPILOT_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx
```

---

## Option 2 — Microsoft Azure OpenAI Service ✅ Recommended for corporate use

**What it is:** Microsoft's enterprise REST API giving access to GPT-4
and other OpenAI models, hosted within your company's Azure tenant.

**Pros:**
- Data stays within your company's Azure tenant and data boundary
- Almost certainly already approved or straightforward to approve through IT
- Full audit logging, cost controls, and access management via Azure
- Microsoft 365 / Enterprise Agreement customers may already have quota

**Cons:**
- Requires an Azure OpenAI resource to be provisioned by IT
- Slightly more setup than a consumer API key

**Environment variables:**

```bash
COPILOT_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_KEY=your-api-key-here
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-02-01
```

---

## Option 3 — GitHub Models API ✅ Most promising near-term path

**What it is:** GitHub exposes a Models API at
`models.inference.ai.azure.com` that gives access to multiple AI
models — including Claude — using a standard GitHub personal access
token. If your organisation already has GitHub Copilot licences,
this is the same credential infrastructure IT has already approved.

**Available models include:**
- `claude-opus-4-5` — Anthropic's most capable (same as VS Code Copilot)
- `claude-sonnet-4-5` — fast, strong for most tasks
- `gpt-4o` — OpenAI via GitHub
- `Meta-Llama-3.1-70B-Instruct` — open-weight option

**Pros:**
- Your company may already have this licence
- Same GitHub token already trusted by IT for VS Code
- No new vendor approval — GitHub/Microsoft already in the supply chain
- Hosted on Azure infrastructure (Microsoft data boundary)

**Cons:**
- GitHub Models API is in public preview — no formal production SLA yet
- Rate limits more conservative than direct API access during preview
- Requires network access to `models.inference.ai.azure.com`

**Environment variables:**

```bash
COPILOT_PROVIDER=github
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_MODEL=claude-opus-4-5      # or claude-sonnet-4-5, gpt-4o, etc.
```

---

## Option 4 — OpenAI direct

**Environment variables:**

```bash
COPILOT_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxxxxxxxxx
```

---

## Option 5 — Google Gemini

**Environment variables:**

```bash
COPILOT_PROVIDER=gemini
GEMINI_API_KEY=AIzaxxxxxxxxxxxx
```

---

## Option 6 — Ollama (local, fully on-premises)

**What it is:** An open-source tool that runs large language models
locally on the bridge server or a dedicated machine. No external API
calls — everything stays on the corporate network.

**Recommended models:**
- `llama3.1` — best general quality for the size
- `mistral` — fast, good at code and structured output
- `codellama` — strong at JCL, REXX, and code generation

**Pros:**
- Zero external network calls — data never leaves the building
- No API key, no usage costs, no external service approval
- Can run on the same machine as the bridge (WSL2 or Docker)
- Fully air-gapped deployments supported

**Cons:**
- Response quality is noticeably lower than GPT-4 or Claude for
  complex mainframe questions
- Requires a machine with reasonable RAM (8GB minimum, 16GB+ preferred)
- IT still needs to approve installation of Ollama itself

**Setup (WSL2):**

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1
```

**Environment variables:**

```bash
COPILOT_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.1
```

---

## Comparison summary

| Option | Data boundary | Approval complexity | Quality | Cost |
|--------|--------------|---------------------|---------|------|
| Anthropic API | External | Medium — new vendor | ★★★★★ | ~$0.002/msg |
| Azure OpenAI | Azure tenant | Low — Microsoft product | ★★★★☆ | Pay per token |
| **GitHub Models** | **Azure (GitHub)** | **Very low — existing licence** | **★★★★★** | **Included in Copilot licence** |
| OpenAI direct | External | Medium — new vendor | ★★★★☆ | Pay per token |
| Google Gemini | External | Medium — new vendor | ★★★★☆ | Pay per token |
| Ollama (local) | On-premises | Low — no external API | ★★★☆☆ | Free |
| Browser Copilot | N/A | N/A — not possible | N/A | N/A |

---

## Recommended approach

1. **Immediate / lowest friction:** Try the GitHub Models API using
   your existing GitHub Copilot tokens. No new vendor approval needed.

2. **Short term if GitHub Models is not approved:** Request an Azure
   OpenAI resource from IT. Still a Microsoft product.

3. **Fallback / fully offline:** Ollama on the bridge server.

4. **Longer term:** Anthropic enterprise agreement for strongest
   mainframe domain knowledge and zero data retention guarantees.

---

## Security notes

- API keys are entered in the ⚙ AI tab in the browser UI and held
  **in memory only** — never written to disk by the client.
- The bridge server reads provider credentials from environment
  variables or `.env` (which is gitignored).
- Screen content sent to the AI never includes password field values —
  NONDISPLAY fields are masked at the protocol layer before rendering.
- Credentials must never be stored in macro JSON files.
