# DT Entity Topology Explorer

A **Dynatrace App** (AppEngine) that auto-discovers service "Applications" from live topology data, renders each as an interactive dependency graph, and exports the full hierarchy to any CMDB in JSON, CSV, or XML.

Built with the [Dynatrace App Toolkit](https://developer.dynatrace.com/) (React + Strato components). Topology is fetched via the **Entities API v2** through a serverless App Function; all graph traversal runs client-side for unlimited depth.

---

## What it does

On launch the app fetches every service-to-service `calls` relationship in your environment and automatically groups them into **Applications** — a root service (no incoming edges) plus its full transitive dependency tree. Each Application is shown as:

- An **interactive Cytoscape.js graph** (left-to-right dagre layout, dark background, DT brand colors, service-type icons)
- A **service chip list** color-coded by service type
- **Export buttons** (JSON · CSV · XML) for CMDB ingestion

A secondary **All Edges** tab shows the raw dependency table.

---

## Tabs

| Tab | What it shows |
|---|---|
| **Applications** | One card per auto-detected application: interactive dependency graph + service chips + export buttons |
| **All Edges** | Sortable table of every raw `source → target` dependency edge |

---

## Prerequisites

- **Node.js ≥ 18** and npm.
- A **Dynatrace SaaS** environment (Grail / AppEngine).
- A **platform token** for deployment with the scopes listed under [Deploying](#deploying).

---

## Setup

```bash
git clone https://github.com/nicholasgoss-dynatrace/dt-entity-topology-explorer.git
cd dt-entity-topology-explorer
npm install
```

### Configure the target environment

Set your tenant URL in **one** of these ways:

- Edit `environmentUrl` in `app.config.json`, **or**
- Pass `--environment-url https://<your-tenant>.apps.dynatrace.com` to `dt-app dev` / `dt-app deploy`

### App identity (optional)

`app.config.json` → `app.id` is `my.topologyexplorer`. Change it to your own reverse-domain ID (e.g. `my.acme.topology`) for your org — the ID is the app's permanent identifier in the environment. Changing it deploys a *new* app rather than updating the existing one.

### Scopes

The app requests these scopes (`app.config.json` → `app.scopes`); the signed-in user must also hold them via IAM policy:

| Scope | Purpose |
|---|---|
| `environment-api:entities:read` | Fetch service entities and `calls` relationships (Entities API v2) |
| `storage:entities:read` | DQL access to entity storage |
| `environment-api:topology:read` | Read smartscape topology data |

---

## Local development

```bash
npm run start          # dt-app dev — opens browser, prompts SSO login
```

The dev server proxies all API calls to your environment using your interactive login, so you see real data. On first run you'll be asked to consent to the app's scopes.

`npm run build` bundles the app to `dist/`.

---

## Deploying

Deployment requires a platform token with **app-install** scopes in addition to the read scopes above:

- `app-engine:apps:install`
- `app-engine:apps:run`
- plus all scopes the app declares in `app.config.json`

```bash
# bash
export DT_PLATFORM_TOKEN="dt0s16.XXXX.XXXXXXXX"
npx dt-app deploy --non-interactive --environment-url https://<your-tenant>.apps.dynatrace.com

# PowerShell
$env:DT_PLATFORM_TOKEN = "dt0s16.XXXX.XXXXXXXX"
npx dt-app deploy --non-interactive --environment-url https://<your-tenant>.apps.dynatrace.com
```

> **Important**: Bump `app.version` in `app.config.json` before each deploy — the platform rejects re-deploying the same version with different content. Never commit your token; `.dt-app/.tokens.json` is git-ignored.

After deploy the app is at `https://<your-tenant>.apps.dynatrace.com/ui/apps/my.topologyexplorer`.

---

## Export formats

Each Application card has three export buttons:

| Format | Structure |
|---|---|
| **JSON** | Nested tree — each node has `name` and `calls[]` |
| **CSV** | One row per root-to-leaf path; columns = depth of deepest path; children sorted A→Z per level |
| **XML** | Nested `<service name="..."><calls>...</calls></service>` hierarchy |

An **Export All (JSON)** button in the header exports every detected Application in a single file.

---

## How Applications are detected

1. All service-to-service `calls` edges are fetched from the Entities API v2.
2. Service names are normalized — Dynatrace appends protocol suffixes like `(grpc://...)` to inferred remote services; these are stripped to collapse duplicates.
3. **Root services** = services that are never a dependency target (nothing upstream calls them).
4. Each root + its full transitive dependency closure (unlimited-depth BFS) = one Application.
5. Applications are sorted A→Z by root service name.

---

## Graph visualization

Nodes are colored by service type using the Dynatrace brand palette:

| Service type | Color |
|---|---|
| Root / entry | `#1C5BE5` Dynatrace Blue |
| Frontend / web / UI | `#1497FF` Sky Blue |
| Proxy / gateway / ingress | `#4635D6` Indigo |
| API / gRPC / GraphQL | `#54C8E9` Cyan |
| Database / cache | `#BDDF28` Lime |
| Queue / Kafka / events | `#B23BE4` Purple |
| Email / notifications | `#E436FF` Magenta |
| Generic service | `#73BE28` Green |

Each node background is a darkened version of its accent color; the full accent color is used for the border glow and service chips.

---

## Project structure

```
app.config.json            app id/name, environmentUrl, scopes, version
package.json
ui/
  main.tsx                 React entry point
  App.jsx                  Application detection, normalization, export logic, tab shell
  api/
    getServices.function.ts      App Function: list all SERVICE entities
    queryTopology.function.ts    App Function: fetch all calls relationships → edge list
    tsconfig.json                Separate TS config for App Functions (js-runtime typeRoots)
  components/
    ApplicationMap.jsx     Cytoscape graph rendering, service chips, export buttons
    TopologyExplorer.jsx   Legacy Mermaid explorer (unused in main view)
```

---

## Available scripts

| Script | Command |
|---|---|
| `npm run start` | `dt-app dev` — local dev server with hot reload |
| `npm run build` | Bundle to `dist/` |
| `npm run deploy` | Deploy to environment in `app.config.json` |
