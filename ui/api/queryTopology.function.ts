import { MonitoredEntitiesClient, ProblemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { httpClient } from '@dynatrace-sdk/http-client';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EntityRelationship { id: string }

interface RawEntity {
  entityId:      string;
  displayName:   string;
  firstSeenTms?: number;
  lastSeenTms?:  number;
  tags?:         Array<{ context?: string; key?: string; value?: string; stringRepresentation?: string }>;
  managementZones?: Array<{ id?: string; name?: string }>;
  properties?:   Record<string, unknown>;
  fromRelationships?: Record<string, EntityRelationship[]>;
  toRelationships?:   Record<string, EntityRelationship[]>;
}

export interface EntityDetail {
  entityId:        string;
  entityType:      'APPLICATION' | 'SERVICE' | 'PROCESS_GROUP' | 'HOST';
  displayName:     string;
  // Service-specific
  serviceType?:    string | null;
  technology?:     string | null;
  firstSeen?:      string | null;
  lastSeen?:       string | null;
  // Process group
  pgTechnologies?: string | null;
  version?:        string | null;
  // Host
  osType?:         string | null;
  osVersion?:      string | null;
  ipAddresses?:    string | null;
  cloudType?:      string | null;
  // Application
  appType?:        string | null;
  // Shared
  managementZones: string[];
  tags:            string[];
}

interface EdgeResult {
  source:    string;   // source node ID
  target:    string;   // target node ID
  edgeType:  'CALLS' | 'RUNS_ON' | 'HOSTED_ON';
}

interface QueryRequest {
  from?: string;
  to?:   string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(tms: number | undefined): string | null {
  if (!tms) return null;
  return new Date(tms).toISOString().split('T')[0];
}

function extractTags(entity: RawEntity): string[] {
  return (entity.tags || [])
    .map(t => t.stringRepresentation || (t.key ? `${t.key}${t.value ? ':' + t.value : ''}` : ''))
    .filter(Boolean);
}

function extractMZs(entity: RawEntity): string[] {
  return (entity.managementZones || []).map(mz => mz.name || '').filter(Boolean);
}

function rel(entity: RawEntity, direction: 'from' | 'to', name: string): EntityRelationship[] {
  const map = direction === 'from' ? entity.fromRelationships : entity.toRelationships;
  return (map && map[name]) ? map[name] : [];
}

// Paginate any entity query
async function fetchAll(
  client: MonitoredEntitiesClient,
  params: Parameters<MonitoredEntitiesClient['getEntities']>[0],
): Promise<RawEntity[]> {
  const all: RawEntity[] = [];
  const first = await client.getEntities(params);
  all.push(...(((first.entities as unknown) as RawEntity[]) || []));
  let nextPageKey = first.nextPageKey;
  while (nextPageKey) {
    const page = await client.getEntities({ nextPageKey });
    all.push(...(((page.entities as unknown) as RawEntity[]) || []));
    nextPageKey = page.nextPageKey;
  }
  return all;
}

// Severity ordering (higher index = less severe)
const SEV_RANK: Record<string, number> = {
  AVAILABILITY:          0,
  ERROR:                 1,
  PERFORMANCE_DEGRADATION: 2,
  RESOURCE_CONTENTION:   3,
  CUSTOM_ALERT:          4,
};

// ── Main function ──────────────────────────────────────────────────────────────

export default async function queryTopology(payload: QueryRequest = {}): Promise<object> {
  try {
    const client   = new MonitoredEntitiesClient(httpClient);
    const probClient = new ProblemsClient(httpClient);

    const timeParams: { from?: string; to?: string } = {};
    if (payload.from) timeParams.from = payload.from;
    if (payload.to)   timeParams.to   = payload.to;

    const BASE_FIELDS = 'tags,managementZones,properties';
    const REL_FIELDS  = 'fromRelationships,toRelationships';

    // Parallel fetch — all entity types + open problems
    const [apps, services, processGroups, hosts, problemsRes] = await Promise.all([
      fetchAll(client, {
        entitySelector: 'type("APPLICATION")',
        fields: `${BASE_FIELDS},${REL_FIELDS}`,
        pageSize: 500, ...timeParams,
      }),
      fetchAll(client, {
        entitySelector: 'type("SERVICE")',
        fields: `${BASE_FIELDS},${REL_FIELDS},firstSeenTms,lastSeenTms`,
        pageSize: 500, ...timeParams,
      }),
      fetchAll(client, {
        entitySelector: 'type("PROCESS_GROUP")',
        fields: `${BASE_FIELDS},${REL_FIELDS}`,
        pageSize: 500, ...timeParams,
      }),
      fetchAll(client, {
        entitySelector: 'type("HOST")',
        fields: `${BASE_FIELDS},${REL_FIELDS}`,
        pageSize: 500, ...timeParams,
      }),
      probClient.getProblems({
        problemSelector: 'status("OPEN")',
        fields: 'affectedEntities,severityLevel',
        pageSize: 500,
        ...timeParams,
      }).catch(() => ({ problems: [] })),
    ]);

    // ── Build entity ID → displayName lookup ──────────────────────────────────

    const nameMap: Record<string, string> = {};
    for (const e of [...apps, ...services, ...processGroups, ...hosts]) {
      nameMap[e.entityId] = e.displayName;
    }

    // ── Problems map: entityId → worst severity ───────────────────────────────

    const problems: Record<string, string> = {};
    const rawProblems = (problemsRes as { problems?: unknown[] }).problems || [];
    for (const p of rawProblems as Array<{ severityLevel?: string; affectedEntities?: Array<{ entityId: { id: string } }> }>) {
      const sev = p.severityLevel || 'CUSTOM_ALERT';
      for (const ae of p.affectedEntities || []) {
        const eid = ae?.entityId?.id ?? (ae as unknown as string);
        if (!eid) continue;
        if (!(eid in problems) || SEV_RANK[sev] < SEV_RANK[problems[eid]]) {
          problems[eid] = sev;
        }
      }
    }

    // ── Build entity detail map ───────────────────────────────────────────────

    const entityDetails: Record<string, EntityDetail> = {};

    for (const e of apps) {
      const props = e.properties || {};
      entityDetails[e.entityId] = {
        entityId: e.entityId, entityType: 'APPLICATION', displayName: e.displayName,
        appType:         (props['applicationType'] as string) || null,
        managementZones: extractMZs(e),
        tags:            extractTags(e),
      };
    }

    for (const e of services) {
      const props = e.properties || {};
      entityDetails[e.entityId] = {
        entityId: e.entityId, entityType: 'SERVICE', displayName: e.displayName,
        serviceType:     (props['serviceType'] as string) || null,
        technology:      ((props['technologyNames'] as string[]) || []).join(', ') || null,
        firstSeen:       fmtDate(e.firstSeenTms),
        lastSeen:        fmtDate(e.lastSeenTms),
        managementZones: extractMZs(e),
        tags:            extractTags(e),
      };
    }

    for (const e of processGroups) {
      const props = e.properties || {};
      const techArr = (props['softwareTechnologies'] as Array<{ type?: string; edition?: string; version?: string }>) || [];
      const techStr = techArr.map(t => [t.type, t.version].filter(Boolean).join(' ')).join(', ') || null;
      const ver = techArr.length ? (techArr[0].version || null) : null;
      entityDetails[e.entityId] = {
        entityId: e.entityId, entityType: 'PROCESS_GROUP', displayName: e.displayName,
        pgTechnologies:  techStr,
        version:         ver,
        managementZones: extractMZs(e),
        tags:            extractTags(e),
      };
    }

    for (const e of hosts) {
      const props = e.properties || {};
      const ips   = (props['ipAddresses'] as string[]) || [];
      entityDetails[e.entityId] = {
        entityId: e.entityId, entityType: 'HOST', displayName: e.displayName,
        osType:          (props['osType']       as string) || null,
        osVersion:       (props['osVersion']    as string) || null,
        cloudType:       (props['cloudType']    as string) || null,
        ipAddresses:     ips.join(', ') || null,
        managementZones: extractMZs(e),
        tags:            extractTags(e),
      };
    }

    // ── Build edges ───────────────────────────────────────────────────────────

    const edges: EdgeResult[] = [];
    const seenEdge = new Set<string>();

    function addEdge(src: string, tgt: string, type: EdgeResult['edgeType']) {
      const key = `${type}|${src}|${tgt}`;
      if (seenEdge.has(key) || src === tgt) return;
      seenEdge.add(key);
      edges.push({ source: src, target: tgt, edgeType: type });
    }

    // APPLICATION → SERVICE (via fromRelationships.calls or toRelationships.calls)
    for (const app of apps) {
      for (const { id } of [...rel(app, 'from', 'calls'), ...rel(app, 'to', 'calls')]) {
        if (nameMap[id]) addEdge(app.entityId, id, 'CALLS');
      }
    }

    // SERVICE → SERVICE (service-to-service calls — use displayName as node key for compat)
    for (const svc of services) {
      for (const { id } of rel(svc, 'from', 'calls')) {
        if (nameMap[id]) addEdge(svc.displayName, nameMap[id], 'CALLS');
      }
    }

    // SERVICE → PROCESS_GROUP
    for (const svc of services) {
      const targets = [
        ...rel(svc, 'from', 'runsOn'),
        ...rel(svc, 'to',   'runsOn'),
      ];
      for (const { id } of targets) {
        if (entityDetails[id]?.entityType === 'PROCESS_GROUP') {
          addEdge(svc.displayName, id, 'RUNS_ON');
        }
      }
    }

    // PROCESS_GROUP → HOST
    for (const pg of processGroups) {
      const targets = [
        ...rel(pg, 'from', 'isRunningOn'),
        ...rel(pg, 'to',   'runsOn'),
        ...rel(pg, 'from', 'runsOn'),
      ];
      for (const { id } of targets) {
        if (entityDetails[id]?.entityType === 'HOST') {
          addEdge(pg.entityId, id, 'HOSTED_ON');
        }
      }
    }

    // SERVICE-only edges (display names, for backward-compat with App.jsx detectApplications)
    const serviceEdges = edges
      .filter(e => e.edgeType === 'CALLS' && !e.source.startsWith('APPLICATION-'))
      .map(e => ({ source: e.source, target: e.target }));

    const allServiceNames = services.map(s => s.displayName);

    // ── Collect all management zones ──────────────────────────────────────────

    const mzSet = new Set<string>();
    for (const d of Object.values(entityDetails)) {
      d.managementZones.forEach(mz => mzSet.add(mz));
    }

    return {
      success: true,
      // Full edge list (all entity types)
      edges,
      // Service-only edges for backward-compat application detection
      serviceEdges,
      allServiceNames,
      entityDetails,
      // Real DT APPLICATION entities
      dtApplications: apps.map(a => ({
        entityId:        a.entityId,
        displayName:     a.displayName,
        appType:         (a.properties?.['applicationType'] as string) || null,
        managementZones: extractMZs(a),
        tags:            extractTags(a),
        // Which service entityIds this app directly calls
        calledServiceIds: [
          ...rel(a, 'from', 'calls').map(r => r.id),
          ...rel(a, 'to',   'calls').map(r => r.id),
        ].filter(id => entityDetails[id]?.entityType === 'SERVICE'),
      })),
      problems,
      allManagementZones: [...mzSet].sort(),
      counts: {
        applications: apps.length,
        services:     services.length,
        processGroups: processGroups.length,
        hosts:        hosts.length,
        openProblems: rawProblems.length,
      },
    };
  } catch (error) {
    console.error('App Function Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      edges: [], serviceEdges: [], allServiceNames: [],
      entityDetails: {}, dtApplications: [], problems: {},
      allManagementZones: [],
      counts: { applications: 0, services: 0, processGroups: 0, hosts: 0, openProblems: 0 },
    };
  }
}
