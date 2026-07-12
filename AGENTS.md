# AI Coding Agent Instructions

## DQL - Dynatrace Query Language

Before writing any DQL query, the agent must always use the knowledge base (`dql_search` tool) to search for relevant DQL documentation, syntax, and examples, whenever the tool is available.

## UI Components - Strato

Before using any Strato UI component, the agent must always use the knowledge base tools to search for relevant component documentation and usage examples, whenever the tools are available:
- Use the `strato_search` tool to search for available Strato components by name or keyword.
- Use the `strato_get_component` tool to retrieve detailed documentation, props, and code examples for a specific component.
- Use the `strato_get_usecase_details` tool to get code for specific component use cases and patterns.

## Project Overview
This repository contains a **Dynatrace App** built with the Dynatrace App Toolkit "dt-app", running on **Dynatrace AppEngine**. Use the **App Toolkit** during development and CI (`dt-app dev`, `dt-app build`, `dt-app deploy`).

The app auto-discovers "Applications" from live Dynatrace topology data: a root service (nothing upstream calls it) plus its full transitive dependency tree. It renders each application as an interactive Cytoscape.js graph and supports hierarchical CMDB export (JSON, CSV, XML).

## Entities API v2 — Known Constraints

The `getEntities` `fields` parameter does **not** support dotted sub-field notation. These patterns all cause a **"Constraints violated"** API error:

```
// ❌ WRONG — dotted sub-fields are rejected
fields: 'properties.serviceType,properties.technologyNames'
fields: 'fromRelationships.calls,toRelationships.runsOn'
```

Always request the top-level field and access keys in code:

```
// ✅ CORRECT
fields: 'properties,fromRelationships,toRelationships'
// Then in code: entity.properties?.['serviceType'], entity.fromRelationships?.['calls']
```

## Core Concepts
### Dynatrace Apps
- UI is **JavaScript/React** using **Strato Design System** components for consistent Dynatrace UX.
- Backend logic runs inside **App Functions** (serverless, `ui/api/*.function.ts`) in the **Dynatrace JavaScript runtime**. All Dynatrace API calls **must** go through App Functions — direct browser calls are blocked by CSP.
- Authentication is automatic: the `httpClient` singleton from `@dynatrace-sdk/http-client` carries the signed-in user's IAM credentials inside an App Function context.

### Topology Data
- All service dependency edges come from the **Entities API v2** (`MonitoredEntitiesClient`) with `fields: 'fromRelationships.calls'` — this is covered by the `environment-api:entities:read` scope and does not require special DQL smartscape permissions.
- The frontend performs unlimited-depth BFS graph traversal on the full edge set; there is no depth cap in the backend.

### Service Name Normalization
Dynatrace inferred remote services append a protocol suffix, e.g. `"oteldemo.ProductCatalogService (grpc://oteldemo.ProductCatalogService)"`. The `normalizeServiceName()` function in `ui/App.jsx` strips these with the regex `/\s+\([a-z][a-z0-9+\-.]*:\/\/[^)]*\)$/i` to prevent duplicate nodes.

### App Functions
- Located in `ui/api/` as `*.function.ts` files.
- Each file exports a single `default async function`.
- Called from the frontend via `fetch('/api/<functionName>', { method: 'POST', credentials: 'include' })`.
- Use `MonitoredEntitiesClient(httpClient)` — not the DQL client — for topology data.

## Strato Design System

Available packages:
- `@dynatrace/strato-components` — Core components: `Button`, `Flex`, `Surface`, `Page`, `TitleBar`, `Heading`, `Paragraph`, etc.
- `@dynatrace/strato-components-preview` — Extended components: `DataTable`, `ProgressCircle`, `Tabs`, `Tab`, `Checkbox`, etc.

### Importing Strato Components
**Always** import from the specific category subdirectory, never from the package root:

```javascript
// Correct
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import { DataTable } from '@dynatrace/strato-components/tables';
import { ProgressCircle } from '@dynatrace/strato-components/content';
import { Tabs, Tab } from '@dynatrace/strato-components/navigation';

// Wrong — do not import from package root
import { Flex, Heading } from '@dynatrace/strato-components';
```

### Strato API Notes
- `Page` uses compound components: `<Page.Header>` and `<Page.Main>` (not `PageHeader`/`PageDetails`).
- `TitleBar` uses compound components: `<TitleBar.Title>`, `<TitleBar.Subtitle>`, `<TitleBar.Suffix>`.
- `Checkbox` uses `children` for its label text, not a `label` prop.

## Graph Visualization
- Uses **Cytoscape.js** with the **cytoscape-dagre** layout extension for left-to-right hierarchical rendering.
- Layout direction is `rankDir: 'LR'` (root on the left, dependencies to the right).
- Node background colors are darkened versions of the Dynatrace brand accent color for that service type; icons are centered SVG data URIs.
- The `detectIconAndColor()` function in `ui/components/ApplicationMap.jsx` maps service name patterns to DT brand colors.

## Dynatrace Brand Palette
```javascript
const DT = {
  BLUE:    '#1C5BE5',  // Root / entry services
  INDIGO:  '#4635D6',  // Proxy / gateway / ingress
  SKY:     '#1497FF',  // Frontend / web / UI
  CYAN:    '#54C8E9',  // API / gRPC / GraphQL  (also edge color)
  PURPLE:  '#B23BE4',  // Queue / Kafka / event bus
  LIME:    '#BDDF28',  // Database / cache
  GREEN:   '#73BE28',  // Generic service (default)
  MAGENTA: '#E436FF',  // Email / notification
};
```

## Export Formats
- **JSON**: Nested tree (`buildTree`) — each node has `name` and `calls[]`.
- **CSV**: One row per root-to-leaf path; columns = depth of deepest path; children sorted A→Z at each level.
- **XML**: Nested `<service name="..."><calls>...</calls></service>` hierarchy.

## Development Workflow

### Commands
- **Dev Server**: `npm run start` — runs `dt-app dev`, opens browser, prompts SSO login
- **Build**: `npm run build` — bundles to `dist/`
- **Deploy**: `npm run deploy` — deploys to environment in `app.config.json`

### Configuration
- **App Metadata**: `app.config.json` — app name, id, version, required IAM scopes, target environment URL.
- **Bump `app.version`** in `app.config.json` before each deploy — the platform rejects re-deploying the same version with different content.
- **Environment URL**: Set `environmentUrl` in `app.config.json` to target tenant.

### TypeScript in App Functions
App Functions use a separate `ui/api/tsconfig.json` with `typeRoots` pointing to `@dynatrace/js-runtime` — do not mix this config with the main `ui/tsconfig.json`.

## Key Dependencies
| Package | Purpose |
|---|---|
| `@dynatrace/strato-components` | UI component library |
| `@dynatrace-sdk/client-classic-environment-v2` | Entities API v2 (`MonitoredEntitiesClient`) |
| `@dynatrace-sdk/http-client` | Authenticated HTTP client for App Functions (`httpClient` singleton) |
| `cytoscape` + `cytoscape-dagre` | Interactive graph visualization |
| `react-intl` | Required i18n wrapper (`IntlProvider`) |
