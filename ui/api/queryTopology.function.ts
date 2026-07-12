import { MonitoredEntitiesClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { httpClient } from '@dynatrace-sdk/http-client';

interface EdgeResult {
  source: string;
  target: string;
}

interface EntityRelationship {
  id: string;
}

interface EntityDetail {
  entityId: string;
  serviceType: string | null;
  technology: string | null;
  managementZones: string[];
  tags: string[];
  firstSeen: string | null;
  lastSeen: string | null;
}

interface EntityWithRelationships {
  entityId: string;
  displayName: string;
  firstSeenTms?: number;
  lastSeenTms?: number;
  tags?: Array<{ context?: string; key?: string; value?: string; stringRepresentation?: string }>;
  managementZones?: Array<{ id?: string; name?: string }>;
  properties?: Record<string, unknown>;
  fromRelationships?: {
    calls?: EntityRelationship[];
  };
}

interface QueryRequest {
  from?: string;  // relative e.g. "now-2h" or ISO timestamp
  to?: string;
}

function fmtDate(tms: number | undefined): string | null {
  if (!tms) return null;
  return new Date(tms).toISOString().split('T')[0];
}

/**
 * App Function: fetches ALL SERVICE entities across every page, with their
 * "calls" relationships plus metadata fields used for CMDB export and card display.
 * Accepts optional `from`/`to` time range (relative DT expressions or ISO timestamps).
 */
export default async function queryTopology(payload: QueryRequest = {}): Promise<object> {
  try {
    const client = new MonitoredEntitiesClient(httpClient);
    const allEntities: EntityWithRelationships[] = [];

    const timeParams: { from?: string; to?: string } = {};
    if (payload.from) timeParams.from = payload.from;
    if (payload.to)   timeParams.to   = payload.to;

    // Request `properties` (whole object) — dotted sub-field notation is not supported.
    const firstResponse = await client.getEntities({
      entitySelector: 'type("SERVICE")',
      fields: 'fromRelationships.calls,tags,managementZones,properties,firstSeenTms,lastSeenTms',
      pageSize: 500,
      ...timeParams,
    });

    const firstPage = ((firstResponse.entities as unknown) as EntityWithRelationships[]) || [];
    allEntities.push(...firstPage);

    let nextPageKey = firstResponse.nextPageKey;
    while (nextPageKey) {
      const page = await client.getEntities({ nextPageKey });
      const entities = ((page.entities as unknown) as EntityWithRelationships[]) || [];
      allEntities.push(...entities);
      nextPageKey = page.nextPageKey;
    }

    const nameMap: Record<string, string> = {};
    allEntities.forEach(e => { nameMap[e.entityId] = e.displayName; });

    const edges: EdgeResult[] = [];
    allEntities.forEach(entity => {
      const calls = entity.fromRelationships?.calls || [];
      calls.forEach(rel => {
        const targetName = nameMap[rel.id];
        if (targetName) edges.push({ source: entity.displayName, target: targetName });
      });
    });

    const entityDetails: Record<string, EntityDetail> = {};
    allEntities.forEach(entity => {
      const props = entity.properties || {};
      const techNames = (props['technologyNames'] as string[]) || [];
      const serviceType = (props['serviceType'] as string) || null;

      entityDetails[entity.displayName] = {
        entityId: entity.entityId,
        serviceType,
        technology: techNames.length ? techNames.join(', ') : null,
        managementZones: (entity.managementZones || []).map(mz => mz.name || '').filter(Boolean),
        tags: (entity.tags || [])
          .map(t => t.stringRepresentation || (t.key ? `${t.key}${t.value ? ':' + t.value : ''}` : ''))
          .filter(Boolean),
        firstSeen: fmtDate(entity.firstSeenTms),
        lastSeen: fmtDate(entity.lastSeenTms),
      };
    });

    const allServiceNames = Object.values(nameMap);

    return {
      success: true,
      edges,
      allServiceNames,
      entityDetails,
      count: edges.length,
      totalServices: allEntities.length,
    };
  } catch (error) {
    console.error('App Function Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      edges: [],
      allServiceNames: [],
      entityDetails: {},
      count: 0,
      totalServices: 0,
    };
  }
}
