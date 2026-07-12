import { MonitoredEntitiesClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { httpClient } from '@dynatrace-sdk/http-client';

interface EdgeResult {
  source: string;
  target: string;
}

interface EntityRelationship {
  id: string;
}

interface EntityWithRelationships {
  entityId: string;
  displayName: string;
  fromRelationships?: {
    calls?: EntityRelationship[];
  };
}

/**
 * App Function: fetches ALL SERVICE entities across all pages, with their "calls"
 * relationships. Returns both the edge list and the full set of service names so the
 * frontend can surface isolated services that have no relationships.
 */
export default async function queryTopology(): Promise<object> {
  try {
    const client = new MonitoredEntitiesClient(httpClient);
    const allEntities: EntityWithRelationships[] = [];

    // First page
    const firstResponse = await client.getEntities({
      entitySelector: 'type("SERVICE")',
      fields: 'fromRelationships.calls',
      pageSize: 500,
    });

    const firstPage = ((firstResponse.entities as unknown) as EntityWithRelationships[]) || [];
    allEntities.push(...firstPage);

    // Follow pagination until exhausted
    let nextPageKey = firstResponse.nextPageKey;
    while (nextPageKey) {
      const page = await client.getEntities({ nextPageKey });
      const entities = ((page.entities as unknown) as EntityWithRelationships[]) || [];
      allEntities.push(...entities);
      nextPageKey = page.nextPageKey;
    }

    // Build entityId → displayName lookup
    const nameMap: Record<string, string> = {};
    allEntities.forEach(e => { nameMap[e.entityId] = e.displayName; });

    // Flatten to source→target edges using display names
    const edges: EdgeResult[] = [];
    allEntities.forEach(entity => {
      const calls = entity.fromRelationships?.calls || [];
      calls.forEach(rel => {
        const targetName = nameMap[rel.id];
        if (targetName) {
          edges.push({ source: entity.displayName, target: targetName });
        }
      });
    });

    // Return all service names so the frontend can detect isolated services
    const allServiceNames = Object.values(nameMap);

    return {
      success: true,
      edges,
      allServiceNames,
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
      count: 0,
      totalServices: 0,
    };
  }
}
