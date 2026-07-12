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
 * App Function: fetches all SERVICE entities with their "calls" relationships.
 * Uses the Entities API v2 with relationship fields — covered by environment-api:entities:read.
 * The frontend builds the full dependency graph (unlimited depth) from these edges.
 */
export default async function queryTopology(): Promise<object> {
  try {
    console.log('App Function: Fetching service topology via Entities API...');

    const client = new MonitoredEntitiesClient(httpClient);

    // Fetch all services with their outgoing "calls" relationships
    // pageSize=500 to get as many as possible in one shot
    const response = await client.getEntities({
      entitySelector: 'type("SERVICE")',
      fields: 'fromRelationships.calls',
      pageSize: 500,
    });

    const entities = ((response.entities as unknown) as EntityWithRelationships[]) || [];

    // Build a lookup map: entityId → displayName
    const nameMap: Record<string, string> = {};
    entities.forEach(e => { nameMap[e.entityId] = e.displayName; });

    // Flatten to source→target edges using display names
    const edges: EdgeResult[] = [];
    entities.forEach(entity => {
      const sourceName = entity.displayName;
      const calls = entity.fromRelationships?.calls || [];
      calls.forEach(rel => {
        const targetName = nameMap[rel.id];
        if (targetName) {
          edges.push({ source: sourceName, target: targetName });
        }
      });
    });

    console.log('App Function: Edges built, count:', edges.length);

    return {
      success: true,
      edges,
      count: edges.length,
    };
  } catch (error) {
    console.error('App Function Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      edges: [],
      count: 0,
    };
  }
}

function buildTopologyQuery(maxDepth: number): string {
  let query = `smartscapeNodes "SERVICE"
| traverse edgeTypes: {calls}, targetTypes: {SERVICE}, fieldsKeep: {id, name}
| fields
    source = getNodeName(dt.traverse.history[-1][\`id\`]),
    chain_path = concat(getNodeName(dt.traverse.history[-1][\`id\`]), " → ", getNodeName(id)),
    depth = 1`;

  if (maxDepth >= 2) {
    query += `
| append [
  smartscapeNodes "SERVICE"
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}, fieldsKeep: {id}
  | fields
      source = getNodeName(dt.traverse.history[-2][\`id\`]),
      chain_path = concat(getNodeName(dt.traverse.history[-2][\`id\`]), " → ", getNodeName(dt.traverse.history[-1][\`id\`]), " → ", getNodeName(id)),
      depth = 2
]`;
  }

  if (maxDepth >= 3) {
    query += `
| append [
  smartscapeNodes "SERVICE"
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}, fieldsKeep: {id}
  | fields
      source = getNodeName(dt.traverse.history[-3][\`id\`]),
      chain_path = concat(getNodeName(dt.traverse.history[-3][\`id\`]), " → ", getNodeName(dt.traverse.history[-2][\`id\`]), " → ", getNodeName(dt.traverse.history[-1][\`id\`]), " → ", getNodeName(id)),
      depth = 3
]`;
  }

  if (maxDepth >= 4) {
    query += `
| append [
  smartscapeNodes "SERVICE"
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}, fieldsKeep: {id}
  | fields
      source = getNodeName(dt.traverse.history[-4][\`id\`]),
      chain_path = concat(getNodeName(dt.traverse.history[-4][\`id\`]), " → ", getNodeName(dt.traverse.history[-3][\`id\`]), " → ", getNodeName(dt.traverse.history[-2][\`id\`]), " → ", getNodeName(dt.traverse.history[-1][\`id\`]), " → ", getNodeName(id)),
      depth = 4
]`;
  }

  if (maxDepth >= 5) {
    query += `
| append [
  smartscapeNodes "SERVICE"
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}
  | traverse edgeTypes: {calls}, targetTypes: {SERVICE}, fieldsKeep: {id}
  | fields
      source = getNodeName(dt.traverse.history[-5][\`id\`]),
      chain_path = concat(getNodeName(dt.traverse.history[-5][\`id\`]), " → ", getNodeName(dt.traverse.history[-4][\`id\`]), " → ", getNodeName(dt.traverse.history[-3][\`id\`]), " → ", getNodeName(dt.traverse.history[-2][\`id\`]), " → ", getNodeName(dt.traverse.history[-1][\`id\`]), " → ", getNodeName(id)),
      depth = 5
]`;
  }

  query += `
| dedup source, chain_path, depth
| sort source, depth`;

  return query;
}
