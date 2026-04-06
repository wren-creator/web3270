# AI-notes.md — Copilot Integration Options

Notes on AI provider options for the WebTerm/3270 Copilot panel,
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

The Copilot panel in WebTerm/3270 makes a direct HTTPS call to an
AI provider's REST API. The provider is configurable — see options below.

---

## Option 1 — Anthropic API (current implementation)

**What it is:** Direct calls to `api.anthropic.com/v1/messages` using
Claude (the model this tooling was designed and tested with).

**Pros:**
- Already implemented and working
- Excellent comprehension of mainframe terminology, JCL, ISPF, REXX
- Strong at generating structured macro JSON from plain-English descriptions

**Cons:**
- Requires an Anthropic API key
- External API — data leaves the corporate network
- May require IT policy exception

**Cost:** Approximately $0.001–$0.003 per Copilot question
(screen context ~1,920 chars + question + response).

**API key:** Obtain from [console.anthropic.com](https://console.anthropic.com).

**Code location:** `macros/macro-client.js` and `copilot-panel.html`
— the endpoint and model string are the only values that need changing
when switching providers.

---

## Option 2 — Microsoft Azure OpenAI Service ✅ Recommended for corporate use

**What it is:** Microsoft's enterprise REST API giving access to GPT-4
and other OpenAI models, hosted within your company's Azure tenant.
This is the same underlying model that powers Microsoft Copilot,
accessed via a compliant corporate API rather than the consumer UI.

**Pros:**
- Data stays within your company's Azure tenant and data boundary
- Almost certainly already approved or straightforward to approve
  through IT — it is a Microsoft product on corporate Azure
- Same REST API shape as OpenAI — minimal code change
- Full audit logging, cost controls, and access management via Azure
- Microsoft 365 / Enterprise Agreement customers may already have
  quota available

**Cons:**
- Requires an Azure OpenAI resource to be provisioned by IT
- Slightly more setup than a consumer API key

**What IT needs to provision:**
- An Azure OpenAI resource in your tenant
- A GPT-4 (or GPT-4o) model deployment
- An API key and endpoint URL in the form:
  `https://YOUR-RESOURCE.openai.azure.com/`

**Code change required:** One-line swap in the bridge proxy endpoint.
The request/response format is nearly identical to the Anthropic API
with minor field name differences.

```javascript
// Current (Anthropic)
const response = await fetch('https://api.anthropic.com/v1/messages', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-20250514', ... })
});

// Azure OpenAI equivalent
const response = await fetch(
  'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01',
  {
    headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
    body: JSON.stringify({ messages: [...], max_tokens: 1000 })
  }
);
```

**Recommended path:** Request an Azure OpenAI resource from IT, citing
that it is a Microsoft product within the corporate Azure tenant used
for an internal mainframe tooling project with no customer PII.

---

## Option 3 — Microsoft Copilot Studio / Copilot API

**What it is:** If your organisation has Microsoft 365 Copilot licences,
Microsoft offers Copilot Studio — a platform for building custom Copilot
extensions with a REST API for programmatic integration into your own
applications. This is Microsoft's officially sanctioned route for
embedding Copilot capability into internal tooling.

**Pros:**
- Fully within the Microsoft ecosystem
- Uses existing M365 Copilot licences if already purchased
- IT security teams are typically comfortable with it

**Cons:**
- Requires M365 Copilot licences (not all organisations have them)
- More complex setup than a simple API key
- Copilot Studio is a low-code platform — custom integrations require
  some configuration work
- API is more opinionated than a raw completion endpoint

**Useful if:** Your company already has M365 Copilot and IT will not
approve any new external API connections, not even Azure OpenAI.

---

## Option 4 — Ollama (local, fully on-premises)

**What it is:** An open-source tool that runs large language models
locally on the bridge server or a dedicated machine. No external API
calls — everything stays on the corporate network.

**Recommended models:**
- `llama3.1` — best general quality for the size
- `mistral` — fast, good at code and structured output
- `codellama` — strong at JCL, REXX, and code generation specifically

**Pros:**
- Zero external network calls — data never leaves the building
- No API key, no usage costs, no approval needed for external services
- Can run on the same Windows machine as the bridge (WSL2 or Docker)
- Fully air-gapped deployments supported

**Cons:**
- Response quality is noticeably lower than GPT-4 or Claude for
  complex mainframe questions
- Requires a machine with reasonable RAM (8GB minimum, 16GB+ preferred)
  — GPU optional but significantly faster
- IT still needs to approve installation of Ollama itself

**Setup (WSL2):**

```bash
# Install Ollama inside WSL2
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model (one-time download, ~4GB)
ollama pull llama3.1

# Ollama runs as a local API on port 11434
# Test it:
curl http://localhost:11434/api/generate \
  -d '{"model":"llama3.1","prompt":"What is ISPF?","stream":false}'
```

**Code change required:** Point the fetch call at the local Ollama
endpoint and adjust the request format:

```javascript
const response = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama3.1',
    messages: chatHistory,
    stream: false
  })
});
const data = await response.json();
const reply = data.message.content;
```

---

## Option 5 — Apply for an Anthropic exception

If the current implementation (Option 1) is the preferred technical
choice, it may be worth applying for a policy exception. Useful
arguments for the request:

- This is a purely internal tool — no customer data, no PII
- The only data sent to the API is the 3270 screen text (which is
  internal system output) and the user's question
- Screen content can be sanitised before sending (passwords on the
  TSO logon screen are masked by the mainframe itself — they appear
  as blank fields, not transmitted characters)
- Anthropic offers enterprise agreements with data processing
  agreements (DPAs) and zero data retention options
- Usage is limited to a small team of mainframe developers

---

## Option 6 — GitHub Models API via GitHub Copilot licence ✅ Most promising near-term path

**What it is:** GitHub exposes a Models API at
`models.inference.ai.azure.com` that gives access to multiple AI
models — including Claude Opus and Claude Sonnet — using a standard
GitHub personal access token or GitHub App token. If your organisation
already has GitHub Copilot licences (which you do), this is the same
credential infrastructure IT has already approved for VS Code use.

**Available models include:**
- `claude-opus-4-5` — Anthropic's most capable model (same as Opus in VS Code Copilot)
- `claude-sonnet-4-5` — faster, strong for most tasks
- `gpt-4o` — OpenAI via GitHub
- `gpt-4o-mini` — lighter OpenAI option
- `Meta-Llama-3.1-70B-Instruct` — open-weight option

**Pros:**
- Your company **already has this licence** — GitHub Copilot is approved
- Uses the same GitHub token already trusted by IT for VS Code
- Access to Claude Opus without a separate Anthropic API key
- OpenAI-compatible request format — minimal code change
- No new vendor approval — GitHub/Microsoft is already in the supply chain
- Hosted on Azure infrastructure (Microsoft data boundary)

**Cons:**
- GitHub Models API is currently in public preview — production SLA
  is not yet formally defined
- Token must be a GitHub PAT with `models:read` scope or a GitHub
  App token — needs IT to issue or approve the token type
- Rate limits are more conservative than direct API access during
  preview period
- Requires network access to `models.inference.ai.azure.com` from
  the bridge server

**The IT conversation:**
> *"We already have GitHub Copilot approved, which gives our developers
> access to Claude Opus inside VS Code. The GitHub Models API uses the
> same GitHub authentication we already have. We're asking to use the
> same models, with the same credential, from our internal bridge server
> rather than only from VS Code."*

This is a significantly easier ask than introducing a new external
vendor.

**GitHub token required scopes:**
- `models:read` — query the Models API
- No repository or org scopes needed — this is models-only access

**Request format** (OpenAI-compatible):

```javascript
const response = await fetch(
  'https://models.inference.ai.azure.com/chat/completions',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      messages: chatHistory,
      max_tokens: 1000,
      temperature: 0.3
    })
  }
);
```

**Implementation:** A fully self-contained integration module is
provided at `copilot/providers/github-models.js`. It is completely
separate from the current Anthropic implementation and is only
activated when `COPILOT_PROVIDER=github` is set in `.env`.
See `copilot/providers/README.md` for setup instructions.

**Environment variables:**

```bash
# GitHub Models API
COPILOT_PROVIDER=github
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_MODEL=claude-opus-4-5      # or claude-sonnet-4-5, gpt-4o, etc.
```

---

## Comparison summary

| Option | Data boundary | Approval complexity | Quality | Cost |
|--------|--------------|---------------------|---------|------|
| Anthropic API | External | Medium — new vendor | ★★★★★ | ~$0.002/msg |
| Azure OpenAI | Azure tenant | Low — Microsoft product | ★★★★☆ | Pay per token |
| Copilot Studio | M365 tenant | Low — existing licence | ★★★★☆ | M365 licence |
| Ollama (local) | On-premises | Low — no external API | ★★★☆☆ | Free |
| Browser Copilot | N/A | N/A — not possible | N/A | N/A |
| **GitHub Models** | **Azure (GitHub)** | **Very low — existing licence** | **★★★★★** | **Included in Copilot licence** |

---

## Recommended approach (updated)

1. **Immediate / lowest friction:** Try the GitHub Models API using
   your existing GitHub Copilot tokens. This requires no new vendor
   approval and gives access to Claude Opus — the same model available
   in VS Code. Implementation is ready in `copilot/providers/github-models.js`.

2. **Short term if GitHub Models is not approved:** Request an Azure
   OpenAI resource from IT. Still a Microsoft product within the
   corporate Azure tenant.

3. **Fallback / fully offline:** Ollama on the bridge server — no
   external calls at all.

4. **Longer term:** If the tool is adopted widely, revisit an
   Anthropic enterprise agreement for the strongest mainframe domain
   knowledge and zero data retention guarantees.

---

## Implementation note

The AI provider is intentionally isolated behind a provider interface
in `copilot/providers/`. Switching providers is a single environment
variable change — the browser client and Copilot UI panel do not
change regardless of which provider is active.

```bash
# In .env — switch by changing one line
COPILOT_PROVIDER=anthropic   # current default
COPILOT_PROVIDER=github      # GitHub Models (Claude Opus via Copilot licence)
COPILOT_PROVIDER=azure       # Azure OpenAI
COPILOT_PROVIDER=ollama      # local Ollama
```

Provider files:

```
copilot/providers/
├── README.md                  Setup guide for all providers
├── index.js                   Provider router — reads COPILOT_PROVIDER
├── anthropic.js               Current implementation (default)
├── github-models.js           GitHub Models API / Claude Opus
├── azure-openai.js            Azure OpenAI stub
└── ollama.js                  Ollama local model stub
```

Environment variables for each provider:

```bash
# Anthropic (current default)
COPILOT_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx

# GitHub Models
COPILOT_PROVIDER=github
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_MODEL=claude-opus-4-5

# Azure OpenAI
COPILOT_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_KEY=your-api-key-here
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-02-01

# Ollama (local)
COPILOT_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.1
```
