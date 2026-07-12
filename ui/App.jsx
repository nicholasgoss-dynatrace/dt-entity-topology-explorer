import React, { useState, useEffect } from 'react';
import { IntlProvider } from 'react-intl';
import { Page } from '@dynatrace/strato-components/layouts';
import { TitleBar } from '@dynatrace/strato-components/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Surface } from '@dynatrace/strato-components/layouts';
import { Button } from '@dynatrace/strato-components/buttons';
import { Tabs, Tab } from '@dynatrace/strato-components/navigation';
import { Heading } from '@dynatrace/strato-components/typography';
import { Paragraph } from '@dynatrace/strato-components/typography';
import { DataTable } from '@dynatrace/strato-components/tables';
import { Skeleton } from '@dynatrace/strato-components/content';
import { TimeframeSelector } from '@dynatrace/strato-components/filters';
import { CriticalIcon } from '@dynatrace/strato-icons';
import { getAppVersion } from '@dynatrace-sdk/app-environment';
import ApplicationMap from './components/ApplicationMap';

/**
 * Normalize service names by stripping protocol suffixes Dynatrace adds for
 * inferred remote services, e.g.:
 *   "oteldemo.ProductCatalogService (grpc://oteldemo.ProductCatalogService)"
 *   → "oteldemo.ProductCatalogService"
 */
function normalizeServiceName(name) {
  return name.replace(/\s+\([a-z][a-z0-9+\-.]*:\/\/[^)]*\)$/i, '').trim();
}

function normalizeEdges(edges) {
  const seen = new Set();
  return edges
    .map(({ source, target }) => ({
      source: normalizeServiceName(source),
      target: normalizeServiceName(target),
    }))
    .filter(({ source, target }) => {
      if (source === target) return false;
      const key = `${source}||${target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Detect "Applications" from a flat edge list plus the full set of known service names.
 * An Application = a root service (nothing calls it) + its full transitive dependency tree.
 * Services with no relationships at all appear as single-node Applications.
 */
function detectApplications(edges, allServiceNames = []) {
  const allNodes = new Set();
  const calledBy = new Set();

  edges.forEach(({ source, target }) => {
    allNodes.add(source);
    allNodes.add(target);
    calledBy.add(target);
  });

  allServiceNames.forEach(name => allNodes.add(name));

  const roots = [...allNodes].filter(node => !calledBy.has(node));

  const adjacency = {};
  edges.forEach(({ source, target }) => {
    if (!adjacency[source]) adjacency[source] = [];
    adjacency[source].push(target);
  });

  return roots.map(root => {
    const visited = new Set();
    const reachableEdges = [];
    const queue = [root];

    while (queue.length > 0) {
      const node = queue.shift();
      if (visited.has(node)) continue;
      visited.add(node);
      (adjacency[node] || []).forEach(target => {
        reachableEdges.push({ source: node, target });
        if (!visited.has(target)) queue.push(target);
      });
    }

    return {
      name: root,
      serviceCount: visited.size,
      services: [...visited],
      edges: reachableEdges,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}


function AppContent() {
  const [edges, setEdges] = useState([]);
  const [applications, setApplications] = useState([]);
  const [entityDetails, setEntityDetails] = useState({});
  const [totalServices, setTotalServices] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState({ from: 'now-2h', to: 'now' });

  useEffect(() => { loadTopology('now-2h', 'now'); }, []);

  const loadTopology = async (from = 'now-2h', to = 'now') => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/queryTopology', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to fetch topology');

      const fetchedEdges = normalizeEdges(result.edges || []);

      // Normalize entity detail keys the same way edge names are normalized
      const rawDetails = result.entityDetails || {};
      const normalizedDetails = {};
      Object.entries(rawDetails).forEach(([name, details]) => {
        normalizedDetails[normalizeServiceName(name)] = details;
      });

      const rawServiceNames = result.allServiceNames || [];
      const normalizedServiceNames = [...new Set(rawServiceNames.map(normalizeServiceName))];

      setEdges(fetchedEdges);
      setEntityDetails(normalizedDetails);
      setApplications(detectApplications(fetchedEdges, normalizedServiceNames));
      setTotalServices(result.totalServices || normalizedServiceNames.length);
    } catch (err) {
      setError(err.message);
      console.error('Topology load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Export helpers ──────────────────────────────────────────────────────────

  const exportFile = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const esc = s => String(s).replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

  const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  /**
   * Build a nested dependency tree from an app's edge list.
   * Each node includes entity metadata for enriched JSON / XML export.
   */
  const buildTree = (app) => {
    const adjacency = {};
    app.edges.forEach(({ source, target }) => {
      if (!adjacency[source]) adjacency[source] = [];
      adjacency[source].push(target);
    });

    const buildNode = (name, visited = new Set()) => {
      const d = entityDetails[name] || {};
      const node = {
        name,
        entityId: d.entityId || null,
        serviceType: d.serviceType || null,
        technology: d.technology || null,
        managementZones: d.managementZones || [],
        tags: d.tags || [],
        firstSeen: d.firstSeen || null,
        lastSeen: d.lastSeen || null,
        calls: [],
      };
      if (visited.has(name)) { node._cyclic = true; return node; }
      const next = new Set(visited).add(name);
      (adjacency[name] || []).forEach(child => node.calls.push(buildNode(child, next)));
      return node;
    };

    return buildNode(app.name);
  };

  // JSON — enriched nested tree
  const exportAppJSON = (app) => {
    const tree = buildTree(app);
    exportFile(JSON.stringify(tree, null, 2), `${app.name}-topology.json`, 'application/json');
  };

  // CSV — one row per unique root-to-leaf dependency path (topology view)
  const exportAppCSV = (app) => {
    const adjacency = {};
    app.edges.forEach(({ source, target }) => {
      if (!adjacency[source]) adjacency[source] = [];
      adjacency[source].push(target);
    });

    const allPaths = [];
    const dfs = (node, currentPath, visited) => {
      const path = [...currentPath, node];
      const children = (adjacency[node] || [])
        .filter(c => !visited.has(c))
        .sort((a, b) => a.localeCompare(b));
      if (children.length === 0) {
        allPaths.push(path);
      } else {
        const next = new Set(visited).add(node);
        children.forEach(child => dfs(child, path, next));
      }
    };
    dfs(app.name, [], new Set());
    if (allPaths.length === 0) allPaths.push([app.name]);

    const maxDepth = Math.max(...allPaths.map(p => p.length));
    const header = Array.from({ length: maxDepth }, (_, i) => `Level ${i + 1}`).join(',');
    const rows = allPaths.map(path =>
      [...path, ...Array(maxDepth - path.length).fill('')].map(csvCell).join(',')
    );

    exportFile([header, ...rows].join('\n'), `${app.name}-topology.csv`, 'text/csv');
  };

  // XML — enriched nested hierarchy with entity metadata as attributes
  const exportAppXML = (app) => {
    const indent = n => '  '.repeat(n);

    const renderNode = (node, depth) => {
      const attrs = [
        `name="${esc(node.name)}"`,
        node.entityId     ? `entityId="${esc(node.entityId)}"` : null,
        node.serviceType  ? `serviceType="${esc(node.serviceType)}"` : null,
        node.technology   ? `technology="${esc(node.technology)}"` : null,
        node.managementZones?.length
          ? `managementZones="${esc(node.managementZones.join(', '))}"` : null,
        node.firstSeen    ? `firstSeen="${node.firstSeen}"` : null,
        node.lastSeen     ? `lastSeen="${node.lastSeen}"` : null,
      ].filter(Boolean).join(' ');

      if (!node.calls?.length) return `${indent(depth)}<service ${attrs} />`;
      return [
        `${indent(depth)}<service ${attrs}>`,
        `${indent(depth + 1)}<calls>`,
        ...node.calls.map(child => renderNode(child, depth + 2)),
        `${indent(depth + 1)}</calls>`,
        `${indent(depth)}</service>`,
      ].join('\n');
    };

    const tree = buildTree(app);
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<application name="${esc(app.name)}" services="${app.serviceCount}" dependencies="${app.edges.length}">`,
      renderNode(tree, 1),
      '</application>',
    ].join('\n');

    exportFile(xml, `${app.name}-topology.xml`, 'application/xml');
  };

  /**
   * CMDB CSV — flat ServiceNow-compatible inventory.
   * One row per service with all entity metadata + direct relationships.
   * Column names match common ServiceNow cmdb_ci_service field patterns.
   */
  const exportAppCMDB = (app) => {
    const header = [
      'Name', 'Entity ID', 'Service Type', 'Technology',
      'Management Zones', 'Tags', 'First Seen', 'Last Seen',
      'Application Root', 'Calls (Direct Dependencies)', 'Called By',
    ].map(csvCell).join(',');

    // Build reverse lookup: what calls each service?
    const calledBy = {};
    app.edges.forEach(({ source, target }) => {
      if (!calledBy[target]) calledBy[target] = [];
      calledBy[target].push(source);
    });

    const rows = [...app.services].sort((a, b) => a.localeCompare(b)).map(svc => {
      const d = entityDetails[svc] || {};
      const calls = app.edges.filter(e => e.source === svc).map(e => e.target).join('; ');
      const callers = (calledBy[svc] || []).join('; ');
      return [
        svc,
        d.entityId || '',
        d.serviceType || '',
        d.technology || '',
        (d.managementZones || []).join('; '),
        (d.tags || []).join('; '),
        d.firstSeen || '',
        d.lastSeen || '',
        app.name,
        calls,
        callers,
      ].map(csvCell).join(',');
    });

    exportFile([header, ...rows].join('\n'), `${app.name}-cmdb.csv`, 'text/csv');
  };

  // Export all apps
  const exportAllJSON = () => {
    const allTrees = applications.map(app => buildTree(app));
    exportFile(JSON.stringify(allTrees, null, 2), 'all-applications-topology.json', 'application/json');
  };

  const exportAllCMDB = () => {
    const header = [
      'Name', 'Entity ID', 'Service Type', 'Technology',
      'Management Zones', 'Tags', 'First Seen', 'Last Seen',
      'Application Root', 'Calls (Direct Dependencies)', 'Called By',
    ].map(csvCell).join(',');

    const rows = [];
    applications.forEach(app => {
      const calledBy = {};
      app.edges.forEach(({ source, target }) => {
        if (!calledBy[target]) calledBy[target] = [];
        calledBy[target].push(source);
      });
      [...app.services].sort((a, b) => a.localeCompare(b)).forEach(svc => {
        const d = entityDetails[svc] || {};
        const calls = app.edges.filter(e => e.source === svc).map(e => e.target).join('; ');
        const callers = (calledBy[svc] || []).join('; ');
        rows.push([
          svc, d.entityId || '', d.serviceType || '', d.technology || '',
          (d.managementZones || []).join('; '), (d.tags || []).join('; '),
          d.firstSeen || '', d.lastSeen || '',
          app.name, calls, callers,
        ].map(csvCell).join(','));
      });
    });

    exportFile([header, ...rows].join('\n'), 'all-services-cmdb.csv', 'text/csv');
  };

  const tableColumns = [
    { id: 'source', header: 'Source Service', accessor: 'source' },
    { id: 'target', header: 'Calls', accessor: 'target' },
  ];

  const appVersion = getAppVersion();

  if (loading) {
    return (
      <Page>
        <Page.Header>
          <TitleBar>
            <TitleBar.Title>Entity Explorer</TitleBar.Title>
            <TitleBar.Subtitle>Discovering applications...</TitleBar.Subtitle>
          </TitleBar>
        </Page.Header>
        <Page.Main>
          <Flex flexDirection="column" gap={16} style={{ padding: 16 }}>
            {[480, 320, 560].map((h, i) => (
              <Surface key={i} style={{ padding: 20 }}>
                <Flex flexDirection="column" gap={12}>
                  <Flex justifyContent="space-between" alignItems="center">
                    <Skeleton style={{ height: 22, width: 220, borderRadius: 4 }} />
                    <Skeleton style={{ height: 32, width: 220, borderRadius: 6 }} />
                  </Flex>
                  <Skeleton style={{ height: h, borderRadius: 8 }} />
                  <Flex gap={6} flexWrap="wrap">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <Skeleton key={j} style={{ height: 24, width: 80 + (j % 3) * 24, borderRadius: 12 }} />
                    ))}
                  </Flex>
                </Flex>
              </Surface>
            ))}
          </Flex>
        </Page.Main>
      </Page>
    );
  }

  return (
    <Page>
      <Page.Header>
        <TitleBar>
          <TitleBar.Title>Entity Explorer</TitleBar.Title>
          <TitleBar.Subtitle>
            {applications.length > 0
              ? `${applications.length} application${applications.length !== 1 ? 's' : ''} · ${totalServices} service${totalServices !== 1 ? 's' : ''} · ${edges.length} dependenc${edges.length !== 1 ? 'ies' : 'y'}`
              : `Visualize service dependencies and export to any CMDB${appVersion ? ` · v${appVersion}` : ''}`}
          </TitleBar.Subtitle>
          <TitleBar.Suffix>
            <Flex gap={8} alignItems="center">
              <TimeframeSelector
                value={timeframe}
                onChange={(tf) => {
                  if (!tf) return;
                  setTimeframe(tf);
                  loadTopology(tf.from.value, tf.to.value);
                }}
              >
                <TimeframeSelector.Presets>
                  <TimeframeSelector.PresetItem value={{ from: 'now-30m', to: 'now' }}>Last 30 minutes</TimeframeSelector.PresetItem>
                  <TimeframeSelector.PresetItem value={{ from: 'now-2h',  to: 'now' }}>Last 2 hours</TimeframeSelector.PresetItem>
                  <TimeframeSelector.PresetItem value={{ from: 'now-6h',  to: 'now' }}>Last 6 hours</TimeframeSelector.PresetItem>
                  <TimeframeSelector.PresetItem value={{ from: 'now-1d',  to: 'now' }}>Last 24 hours</TimeframeSelector.PresetItem>
                  <TimeframeSelector.PresetItem value={{ from: 'now-3d',  to: 'now' }}>Last 3 days</TimeframeSelector.PresetItem>
                  <TimeframeSelector.PresetItem value={{ from: 'now-7d',  to: 'now' }}>Last 7 days</TimeframeSelector.PresetItem>
                  <TimeframeSelector.PresetItem value={{ from: 'now-1mo', to: 'now' }}>Last month</TimeframeSelector.PresetItem>
                </TimeframeSelector.Presets>
              </TimeframeSelector>
              <Button variant="default" onClick={() => {
                const from = timeframe?.from?.value ?? 'now-2h';
                const to   = timeframe?.to?.value   ?? 'now';
                loadTopology(from, to);
              }}>Refresh</Button>
              {applications.length > 0 && (
                <>
                  <Button variant="default" onClick={exportAllCMDB}>Export All (CMDB)</Button>
                  <Button variant="accent" onClick={exportAllJSON}>Export All (JSON)</Button>
                </>
              )}
            </Flex>
          </TitleBar.Suffix>
        </TitleBar>
      </Page.Header>

      <Page.Main>
        <Flex flexDirection="column" gap={16} style={{ padding: 16 }}>
          {error && (
            <Flex alignItems="center" gap={10} role="alert" style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'color-mix(in oklab, var(--dt-colors-background-critical-default) 10%, var(--dt-colors-background-container-default))',
              border: '1px solid color-mix(in oklab, var(--dt-colors-background-critical-default) 45%, transparent)',
            }}>
              <CriticalIcon size={16} style={{ color: 'var(--dt-colors-text-critical-default)', flexShrink: 0 }} />
              <Paragraph style={{ color: 'var(--dt-colors-text-critical-default)', margin: 0, fontSize: 13 }}>
                <strong>Failed to load topology.</strong> {error}
              </Paragraph>
            </Flex>
          )}

          <Tabs>
            <Tab title={`Applications (${applications.length})`}>
              <ApplicationMap
                applications={applications}
                entityDetails={entityDetails}
                onExportJSON={exportAppJSON}
                onExportCSV={exportAppCSV}
                onExportXML={exportAppXML}
                onExportCMDB={exportAppCMDB}
              />
            </Tab>

            <Tab title={`All Edges (${edges.length})`}>
              {edges.length > 0 ? (
                <DataTable data={edges} columns={tableColumns} sortable fullWidth />
              ) : (
                <Flex justifyContent="center" style={{ padding: 48 }}>
                  <Paragraph>No dependency data available.</Paragraph>
                </Flex>
              )}
            </Tab>
          </Tabs>
        </Flex>
      </Page.Main>
    </Page>
  );
}

export default function App() {
  return (
    <IntlProvider locale="en">
      <AppContent />
    </IntlProvider>
  );
}
