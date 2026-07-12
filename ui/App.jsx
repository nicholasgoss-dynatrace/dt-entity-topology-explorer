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
import { ProgressCircle, Skeleton } from '@dynatrace/strato-components/content';
import { CriticalIcon } from '@dynatrace/strato-icons';
import { getAppVersion } from '@dynatrace-sdk/app-environment';
import ApplicationMap from './components/ApplicationMap';

/**
 * Normalize service names by stripping protocol suffixes Dynatrace adds for
 * inferred remote services, e.g.:
 *   "oteldemo.ProductCatalogService (grpc://oteldemo.ProductCatalogService)"
 *   → "oteldemo.ProductCatalogService"
 *   "ruby email-* on port 8080 (http://...)"
 *   → "ruby email-* on port 8080"
 */
function normalizeServiceName(name) {
  // Strip trailing " (protocol://anything)" — handles grpc://, http://, https://, etc.
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
      // Drop self-loops created by normalization and deduplicate
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
  const calledBy = new Set(); // services that are called by something

  edges.forEach(({ source, target }) => {
    allNodes.add(source);
    allNodes.add(target);
    calledBy.add(target);
  });

  // Include isolated services (exist in DT but have no calls relationships)
  allServiceNames.forEach(name => allNodes.add(name));

  // Root services = nodes that are never a target (nothing upstream calls them)
  const roots = [...allNodes].filter(node => !calledBy.has(node));

  // Build adjacency list
  const adjacency = {};
  edges.forEach(({ source, target }) => {
    if (!adjacency[source]) adjacency[source] = [];
    adjacency[source].push(target);
  });

  // BFS from each root to find all reachable edges
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
  }).sort((a, b) => a.name.localeCompare(b.name)); // A → Z alphabetical
}

function AppContent() {
  const [edges, setEdges] = useState([]);
  const [applications, setApplications] = useState([]);
  const [totalServices, setTotalServices] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadTopology();
  }, []);

  const loadTopology = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/queryTopology', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const result = await response.json();

      if (!result.success) throw new Error(result.error || 'Failed to fetch topology');

      const rawEdges = result.edges || [];
      const fetchedEdges = normalizeEdges(rawEdges);

      // Normalize isolated service names the same way edges are normalized
      const rawServiceNames = result.allServiceNames || [];
      const normalizedServiceNames = [...new Set(rawServiceNames.map(normalizeServiceName))];

      setEdges(fetchedEdges);
      setApplications(detectApplications(fetchedEdges, normalizedServiceNames));
      setTotalServices(result.totalServices || normalizedServiceNames.length);
    } catch (err) {
      setError(err.message);
      console.error('Topology load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Export helpers ──────────────────────────────────────────────

  const exportFile = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const esc = s => String(s).replace(/[<>&'"]/g, c =>
    ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));

  /**
   * Build a nested dependency tree from an app's edge list.
   * Cycles are handled by marking already-visited nodes.
   */
  const buildTree = (app) => {
    const adjacency = {};
    app.edges.forEach(({ source, target }) => {
      if (!adjacency[source]) adjacency[source] = [];
      adjacency[source].push(target);
    });

    const buildNode = (name, visited = new Set()) => {
      const node = { name, calls: [] };
      if (visited.has(name)) { node._cyclic = true; return node; }
      const next = new Set(visited).add(name);
      (adjacency[name] || []).forEach(child => node.calls.push(buildNode(child, next)));
      return node;
    };

    return buildNode(app.name);
  };

  // JSON — nested tree
  const exportAppJSON = (app) => {
    const tree = buildTree(app);
    exportFile(JSON.stringify(tree, null, 2), `${app.name}-topology.json`, 'application/json');
  };

  // CSV — one row per unique root-to-leaf path.
  // Each column = one hop. Columns = however deep the deepest path goes.
  // Shorter paths leave trailing columns empty.
  const exportAppCSV = (app) => {
    const adjacency = {};
    app.edges.forEach(({ source, target }) => {
      if (!adjacency[source]) adjacency[source] = [];
      adjacency[source].push(target);
    });

    // DFS: collect every distinct root-to-leaf path (cycle-safe).
    // Children are sorted Z→A at every level so each column is alphabetically descending
    // relative to its parent.
    const allPaths = [];
    const dfs = (node, currentPath, visited) => {
      const path = [...currentPath, node];
      const children = (adjacency[node] || [])
        .filter(c => !visited.has(c))
        .sort((a, b) => a.localeCompare(b)); // A → Z at every level
      if (children.length === 0) {
        allPaths.push(path);
      } else {
        const next = new Set(visited).add(node);
        children.forEach(child => dfs(child, path, next));
      }
    };
    dfs(app.name, [], new Set());

    if (allPaths.length === 0) {
      allPaths.push([app.name]);
    }

    // Columns = depth of the longest path
    const maxDepth = Math.max(...allPaths.map(p => p.length));
    const header = Array.from({ length: maxDepth }, (_, i) => `Level ${i + 1}`).join(',');

    const rowLines = allPaths.map(path => {
      const padded = [
        ...path,
        ...Array(maxDepth - path.length).fill(''),
      ];
      return padded.map(cell => `"${cell}"`).join(',');
    });

    exportFile([header, ...rowLines].join('\n'), `${app.name}-topology.csv`, 'text/csv');
  };

  // XML — fully nested hierarchy
  const exportAppXML = (app) => {
    const indent = (n) => '  '.repeat(n);

    const renderNode = (node, depth) => {
      const hasCalls = node.calls && node.calls.length > 0;
      if (!hasCalls) {
        return `${indent(depth)}<service name="${esc(node.name)}" />`;
      }
      return [
        `${indent(depth)}<service name="${esc(node.name)}">`,
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

  // Export all apps as a single nested JSON
  const exportAllJSON = () => {
    const allTrees = applications.map(app => buildTree(app));
    exportFile(JSON.stringify(allTrees, null, 2), 'all-applications-topology.json', 'application/json');
  };

  // Table data for the Data tab
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
            <TitleBar.Title>Topology Explorer</TitleBar.Title>
            <TitleBar.Subtitle>Discovering applications...</TitleBar.Subtitle>
          </TitleBar>
        </Page.Header>
        <Page.Main>
          <Flex flexDirection="column" gap={16} style={{ padding: 16 }}>
            {/* Skeleton cards matching the final application card layout */}
            {[480, 320, 560].map((h, i) => (
              <Surface key={i} style={{ padding: 20 }}>
                <Flex flexDirection="column" gap={12}>
                  <Flex justifyContent="space-between" alignItems="center">
                    <Skeleton style={{ height: 22, width: 220, borderRadius: 4 }} />
                    <Skeleton style={{ height: 32, width: 180, borderRadius: 6 }} />
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
          <TitleBar.Title>Topology Explorer</TitleBar.Title>
          <TitleBar.Subtitle>
            {applications.length > 0
              ? `${applications.length} application${applications.length !== 1 ? 's' : ''} · ${totalServices} service${totalServices !== 1 ? 's' : ''} · ${edges.length} dependenc${edges.length !== 1 ? 'ies' : 'y'}`
              : `Visualize service dependencies and export to any CMDB${appVersion ? ` · v${appVersion}` : ''}`}
          </TitleBar.Subtitle>
          <TitleBar.Suffix>
            <Flex gap={8}>
              <Button variant="default" onClick={loadTopology}>Refresh</Button>
              {applications.length > 0 && (
                <Button variant="accent" onClick={exportAllJSON}>Export All (JSON)</Button>
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
                onExportJSON={exportAppJSON}
                onExportCSV={exportAppCSV}
                onExportXML={exportAppXML}
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
