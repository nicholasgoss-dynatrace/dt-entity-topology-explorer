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

// ── Normalisation ──────────────────────────────────────────────────────────────

function normalizeServiceName(name) {
  return name.replace(/\s+\([a-z][a-z0-9+\-.]*:\/\/[^)]*\)$/i, '').trim();
}

function normalizeEdges(edges) {
  const seen = new Set();
  return edges
    .map(({ source, target, edgeType }) => ({
      source: normalizeServiceName(source),
      target: normalizeServiceName(target),
      edgeType: edgeType || 'CALLS',
    }))
    .filter(({ source, target }) => {
      if (source === target) return false;
      const key = `${source}||${target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ── Application detection ──────────────────────────────────────────────────────

/**
 * Build application objects.
 *
 * Prefers real Dynatrace APPLICATION entities as roots. If none are found (or
 * an APPLICATION has no reachable service edges) falls back to inferring roots
 * from the service call graph (nothing-calls-it heuristic).
 */
function detectApplications(serviceEdges, allServiceNames, dtApplications, entityDetails) {
  const nameMap = {}; // entityId → displayName for services
  Object.values(entityDetails).forEach(d => {
    if (d.entityType === 'SERVICE') nameMap[d.entityId] = d.displayName;
  });

  // Build service adjacency
  const adjacency = {};
  const allNodes   = new Set(allServiceNames.map(normalizeServiceName));

  serviceEdges.forEach(({ source, target }) => {
    if (!adjacency[source]) adjacency[source] = [];
    adjacency[source].push(target);
    allNodes.add(source);
    allNodes.add(target);
  });

  function bfs(root) {
    const visited = new Set();
    const reachableEdges = [];
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (visited.has(node)) continue;
      visited.add(node);
      (adjacency[node] || []).forEach(target => {
        reachableEdges.push({ source: node, target, edgeType: 'CALLS' });
        if (!visited.has(target)) queue.push(target);
      });
    }
    return { visited, reachableEdges };
  }

  const apps = [];

  // ── Try real DT APPLICATION entities first ────────────────────────────────
  if (dtApplications && dtApplications.length > 0) {
    for (const dtApp of dtApplications) {
      // Entry services are those the DT app directly calls (by entityId → name)
      const entryServices = (dtApp.calledServiceIds || [])
        .map(id => nameMap[id])
        .filter(Boolean)
        .map(normalizeServiceName)
        .filter(name => allNodes.has(name));

      // BFS from each entry service (deduplicate edges across multiple entry points)
      const appVisited  = new Set();
      const seenEdgeKey = new Set();
      const appEdges    = [];
      for (const entry of entryServices) {
        const { visited, reachableEdges } = bfs(entry);
        visited.forEach(n => appVisited.add(n));
        reachableEdges.forEach(e => {
          const k = `${e.source}||${e.target}`;
          if (!seenEdgeKey.has(k)) { seenEdgeKey.add(k); appEdges.push(e); }
        });
      }

      if (appVisited.size === 0 && entryServices.length === 0) continue;

      // Include the DT app entity itself as a node
      const entityDetail = entityDetails[dtApp.entityId] || {
        entityId: dtApp.entityId, entityType: 'APPLICATION',
        displayName: dtApp.displayName,
        appType: dtApp.appType,
        managementZones: dtApp.managementZones || [],
        tags: dtApp.tags || [],
      };

      apps.push({
        name:         dtApp.displayName,
        entityId:     dtApp.entityId,
        isDtApp:      true,
        serviceCount: appVisited.size,
        services:     [...appVisited],
        entryServices,
        edges:        appEdges,
        appDetail:    entityDetail,
        managementZones: dtApp.managementZones || [],
      });
    }
  }

  // ── Fall back to inferred roots for any services not claimed by a DT app ──
  const claimedServices = new Set(apps.flatMap(a => a.services));
  const unclaimedNodes  = [...allNodes].filter(n => !claimedServices.has(n));
  const unclaimedSet    = new Set(unclaimedNodes);
  const unclaimedCalledBy = new Set(
    serviceEdges
      .filter(e => unclaimedSet.has(e.source) || unclaimedSet.has(e.target))
      .map(e => e.target)
  );
  const inferredRoots = unclaimedNodes.filter(n => !unclaimedCalledBy.has(n));

  for (const root of inferredRoots) {
    const { visited, reachableEdges } = bfs(root);
    apps.push({
      name:         root,
      entityId:     null,
      isDtApp:      false,
      serviceCount: visited.size,
      services:     [...visited],
      edges:        reachableEdges,
      appDetail:    null,
      managementZones: [...new Set([...visited].flatMap(svc => (entityDetails[svc]?.managementZones || [])))],
    });
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

// ── AppContent ─────────────────────────────────────────────────────────────────

function AppContent() {
  const [applications,     setApplications]     = useState([]);
  const [entityDetails,    setEntityDetails]     = useState({});
  const [allEdges,         setAllEdges]          = useState([]);
  const [problems,         setProblems]          = useState({});
  const [allMZs,           setAllMZs]            = useState([]);
  const [selectedMZs,      setSelectedMZs]       = useState([]);
  const [counts,           setCounts]            = useState({});
  const [loading,          setLoading]           = useState(true);
  const [error,            setError]             = useState(null);
  const [timeframe,        setTimeframe]         = useState({ from: 'now-2h', to: 'now' });

  const loadSeqRef = React.useRef(0);

  useEffect(() => { loadTopology('now-2h', 'now'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTopology = async (from = 'now-2h', to = 'now') => {
    const seq = ++loadSeqRef.current;
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
      if (seq !== loadSeqRef.current) return;
      if (!result.success) throw new Error(result.error || 'Failed to fetch topology');

      // Normalize entity detail keys (strip protocol suffixes)
      const rawDetails = result.entityDetails || {};
      const normalizedDetails = {};
      Object.entries(rawDetails).forEach(([key, val]) => {
        const d = val;
        if (d.entityType === 'SERVICE') {
          normalizedDetails[normalizeServiceName(d.displayName)] = d;
          // Also keep entityId key for cross-type lookups
          normalizedDetails[d.entityId] = d;
        } else {
          normalizedDetails[d.entityId] = d;
        }
      });

      const serviceEdges = normalizeEdges(result.serviceEdges || []);
      const allEdgesFull = normalizeEdges(result.edges || []);
      const normalizedServiceNames = [...new Set(
        (result.allServiceNames || []).map(normalizeServiceName)
      )];

      setEntityDetails(normalizedDetails);
      setAllEdges(allEdgesFull);
      setProblems(result.problems || {});
      setAllMZs(result.allManagementZones || []);
      setCounts(result.counts || {});
      setApplications(detectApplications(
        serviceEdges, normalizedServiceNames,
        result.dtApplications || [],
        normalizedDetails,
      ));
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      console.error('Topology load error:', err);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  // ── Management zone filter ─────────────────────────────────────────────────

  const toggleMZ = (mz) => setSelectedMZs(prev =>
    prev.includes(mz) ? prev.filter(m => m !== mz) : [...prev, mz]
  );

  const filteredApplications = selectedMZs.length === 0
    ? applications
    : applications.filter(app =>
        app.managementZones.some(mz => selectedMZs.includes(mz))
      );

  // ── Export helpers ─────────────────────────────────────────────────────────

  const safeFilename = (name) => name.replace(/[\\/:*?"<>|]/g, '_').trim();

  const exportFile = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const esc     = s => String(s).replace(/[<>&'"]/g,
    c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const csvCell = v => { const s = String(v ?? '').replace(/"/g, '""'); return `"${/^[=+\-@\t\r]/.test(s) ? "'" + s : s}"`; };

  const buildTree = (app) => {
    const adj = {};
    app.edges.forEach(({ source, target }) => {
      if (!adj[source]) adj[source] = [];
      adj[source].push(target);
    });
    const buildNode = (name, visited = new Set()) => {
      const d = entityDetails[name] || {};
      const node = {
        name, entityId: d.entityId || null, serviceType: d.serviceType || null,
        technology: d.technology || null, managementZones: d.managementZones || [],
        tags: d.tags || [], firstSeen: d.firstSeen || null, lastSeen: d.lastSeen || null,
        hasProblem: d.entityId ? !!problems[d.entityId] : false,
        problemSeverity: d.entityId ? (problems[d.entityId] || null) : null,
        calls: [],
      };
      if (visited.has(name)) { node._cyclic = true; return node; }
      const next = new Set(visited).add(name);
      (adj[name] || []).forEach(child => node.calls.push(buildNode(child, next)));
      return node;
    };
    if (app.isDtApp && Array.isArray(app.entryServices) && app.entryServices.length) {
      return {
        name: app.name,
        entityId: app.entityId || null,
        calls: app.entryServices.map(svc => buildNode(svc, new Set())),
      };
    }
    return buildNode(app.name);
  };

  const exportAppJSON = (app) => {
    const tree = buildTree(app);
    exportFile(JSON.stringify(tree, null, 2), `${safeFilename(app.name)}-topology.json`, 'application/json');
  };

  const exportAppCSV = (app) => {
    const adj = {};
    app.edges.forEach(({ source, target }) => {
      if (!adj[source]) adj[source] = [];
      adj[source].push(target);
    });
    const allPaths = [];
    const dfs = (node, path, visited) => {
      const full = [...path, node];
      const children = (adj[node] || []).filter(c => !visited.has(c)).sort((a, b) => a.localeCompare(b));
      if (!children.length) { allPaths.push(full); return; }
      const next = new Set(visited).add(node);
      children.forEach(c => dfs(c, full, next));
    };
    const roots = app.isDtApp && app.entryServices?.length ? app.entryServices : [app.name];
    roots.forEach(root => dfs(root, app.isDtApp ? [app.name] : [], new Set(app.isDtApp ? [app.name] : [])));
    if (!allPaths.length) allPaths.push([app.name]);
    const maxDepth = allPaths.reduce((m, p) => Math.max(m, p.length), 0);
    const header = Array.from({ length: maxDepth }, (_, i) => `Level ${i + 1}`).join(',');
    const rows   = allPaths.map(p =>
      [...p, ...Array(maxDepth - p.length).fill('')].map(csvCell).join(',')
    );
    exportFile([header, ...rows].join('\n'), `${safeFilename(app.name)}-topology.csv`, 'text/csv');
  };

  const exportAppXML = (app) => {
    const indent = n => '  '.repeat(n);
    const renderNode = (node, depth) => {
      const attrs = [
        `name="${esc(node.name)}"`,
        node.entityId    ? `entityId="${esc(node.entityId)}"` : null,
        node.serviceType ? `serviceType="${esc(node.serviceType)}"` : null,
        node.technology  ? `technology="${esc(node.technology)}"` : null,
        node.managementZones?.length ? `managementZones="${esc(node.managementZones.join(', '))}"` : null,
        node.firstSeen   ? `firstSeen="${node.firstSeen}"` : null,
        node.lastSeen    ? `lastSeen="${node.lastSeen}"` : null,
        node.problemSeverity ? `problemSeverity="${node.problemSeverity}"` : null,
      ].filter(Boolean).join(' ');
      if (!node.calls?.length) return `${indent(depth)}<service ${attrs} />`;
      return [
        `${indent(depth)}<service ${attrs}>`,
        `${indent(depth + 1)}<calls>`,
        ...node.calls.map(c => renderNode(c, depth + 2)),
        `${indent(depth + 1)}</calls>`,
        `${indent(depth)}</service>`,
      ].join('\n');
    };
    const tree = buildTree(app);
    const xml  = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<application name="${esc(app.name)}" services="${app.serviceCount}" dependencies="${app.edges.length}">`,
      renderNode(tree, 1),
      '</application>',
    ].join('\n');
    exportFile(xml, `${safeFilename(app.name)}-topology.xml`, 'application/xml');
  };

  // CMDB CSV — flat ServiceNow-compatible, includes PG + host data
  const CMDB_HEADER = [
    'Name', 'Entity ID', 'Entity Type', 'Service Type', 'Technology',
    'Management Zones', 'Tags', 'First Seen', 'Last Seen',
    'Application Root', 'Application Entity ID',
    'Calls (Direct Dependencies)', 'Called By',
    'Process Group', 'Process Group ID', 'PG Technology', 'PG Version',
    'Host', 'Host ID', 'OS Type', 'OS Version', 'IP Addresses', 'Cloud Type',
    'Problem Severity',
  ].map(csvCell).join(',');

  function buildCMDBRows(app, csvCellFn) {
    const calledBy = {};
    const callsBy  = {};
    app.edges.forEach(({ source, target }) => {
      (calledBy[target] ||= []).push(source);
      (callsBy[source]  ||= []).push(target);
    });

    // Pre-index allEdges by edgeType+source to avoid O(edges) scans per service
    const runsOnBySrc   = {};
    const hostedOnBySrc = {};
    allEdges.forEach(e => {
      if (e.edgeType === 'RUNS_ON')   { (runsOnBySrc[e.source]   ||= []).push(e); }
      if (e.edgeType === 'HOSTED_ON') { (hostedOnBySrc[e.source] ||= []).push(e); }
    });

    return [...app.services].sort((a, b) => a.localeCompare(b)).map(svc => {
      const d   = entityDetails[svc] || {};
      const eid = d.entityId || '';

      // Find PGs hosting this service
      const pgEdges   = runsOnBySrc[svc] || [];
      const pgDetails = pgEdges.map(e => entityDetails[e.target]).filter(Boolean);
      const pgNames   = pgDetails.map(p => p.displayName).join('; ');
      const pgIds     = pgDetails.map(p => p.entityId).join('; ');
      const pgTechs   = pgDetails.map(p => p.pgTechnologies || '').join('; ');
      const pgVers    = pgDetails.map(p => p.version || '').join('; ');

      // Find hosts these PGs run on (deduplicate by entityId — multiple PGs may share a host)
      const hostDetails = [...new Map(
        pgEdges.flatMap(pgEdge => {
          const hostEdges = hostedOnBySrc[pgEdge.target] || [];
          return hostEdges.map(e => entityDetails[e.target]).filter(Boolean);
        }).map(h => [h.entityId, h])
      ).values()];
      const hostNames = hostDetails.map(h => h.displayName).join('; ');
      const hostIds   = hostDetails.map(h => h.entityId).join('; ');
      const osList    = hostDetails.map(h => h.osType    || '').join('; ');
      const osVerList = hostDetails.map(h => h.osVersion || '').join('; ');
      const ipList    = hostDetails.map(h => h.ipAddresses || '').join('; ');
      const cloudList = hostDetails.map(h => h.cloudType || '').join('; ');

      const calls    = (callsBy[svc] || []).join('; ');
      const callers  = (calledBy[svc] || []).join('; ');
      const severity = eid ? (problems[eid] || '') : '';

      return [
        svc, eid, 'SERVICE',
        d.serviceType || '', d.technology || '',
        (d.managementZones || []).join('; '), (d.tags || []).join('; '),
        d.firstSeen || '', d.lastSeen || '',
        app.name, app.entityId || '',
        calls, callers,
        pgNames, pgIds, pgTechs, pgVers,
        hostNames, hostIds, osList, osVerList, ipList, cloudList,
        severity,
      ].map(csvCellFn).join(',');
    });
  }

  const exportAppCMDB = (app) => {
    const rows = buildCMDBRows(app, csvCell);
    exportFile([CMDB_HEADER, ...rows].join('\n'), `${safeFilename(app.name)}-cmdb.csv`, 'text/csv');
  };

  const exportAllJSON = () => {
    exportFile(JSON.stringify(applications.map(buildTree), null, 2),
      'all-applications-topology.json', 'application/json');
  };

  const exportAllCMDB = () => {
    const rows = applications.flatMap(app => buildCMDBRows(app, csvCell));
    exportFile([CMDB_HEADER, ...rows].join('\n'), 'all-services-cmdb.csv', 'text/csv');
  };

  // ── Table columns ──────────────────────────────────────────────────────────

  const tableColumns = [
    { id: 'source', header: 'Source Service', accessor: 'source' },
    { id: 'target', header: 'Calls',          accessor: 'target' },
    { id: 'edgeType', header: 'Relationship', accessor: 'edgeType' },
  ];

  const appVersion = React.useMemo(() => getAppVersion(), []);

  // ── Loading skeleton ───────────────────────────────────────────────────────

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
                </Flex>
              </Surface>
            ))}
          </Flex>
        </Page.Main>
      </Page>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  const totalProblems = counts.openProblems ?? 0;

  return (
    <Page>
      <Page.Header>
        <TitleBar>
          <TitleBar.Title>Entity Explorer</TitleBar.Title>
          <TitleBar.Subtitle>
            {filteredApplications.length > 0
              ? [
                  counts.applications > 0 && `${counts.applications} DT app${counts.applications !== 1 ? 's' : ''}`,
                  counts.services     > 0 && `${counts.services} service${counts.services !== 1 ? 's' : ''}`,
                  counts.processGroups > 0 && `${counts.processGroups} process group${counts.processGroups !== 1 ? 's' : ''}`,
                  counts.hosts        > 0 && `${counts.hosts} host${counts.hosts !== 1 ? 's' : ''}`,
                  totalProblems       > 0 && `${totalProblems} open problem${totalProblems !== 1 ? 's' : ''}`,
                ].filter(Boolean).join(' · ')
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
                  <Button variant="accent"  onClick={exportAllJSON}>Export All (JSON)</Button>
                </>
              )}
            </Flex>
          </TitleBar.Suffix>
        </TitleBar>
      </Page.Header>

      <Page.Main>
        <Flex flexDirection="column" gap={16} style={{ padding: 16 }}>

          {/* Error banner */}
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
            <Tab title={`Applications (${filteredApplications.length})`}>
              <Flex flexDirection="column" gap={16}>

                {/* Management zone filter */}
                {allMZs.length > 0 && (
                  <Flex alignItems="center" gap={8} flexWrap="wrap" style={{ paddingTop: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--dt-colors-text-secondary-default)',
                                   letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      Management Zone
                    </span>
                    {allMZs.map(mz => {
                      const active = selectedMZs.includes(mz);
                      return (
                        <button
                          key={mz}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleMZ(mz)}
                          style={{
                            padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                            cursor: 'pointer', transition: 'all 0.15s',
                            background: active
                              ? 'var(--dt-colors-background-primary-default)'
                              : 'var(--dt-colors-background-container-neutral-default)',
                            color: active
                              ? 'var(--dt-colors-text-primary-reversed-default)'
                              : 'var(--dt-colors-text-neutral-default)',
                            border: active ? '1px solid transparent' : '1px solid var(--dt-colors-border-neutral-default)',
                          }}
                        >
                          {mz}
                        </button>
                      );
                    })}
                    {selectedMZs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedMZs([])}
                        style={{
                          padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                          border: 'none', background: 'transparent',
                          color: 'var(--dt-colors-text-secondary-default)',
                          textDecoration: 'underline',
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </Flex>
                )}

                <ApplicationMap
                  applications={filteredApplications}
                  entityDetails={entityDetails}
                  allEdges={allEdges}
                  problems={problems}
                  onExportJSON={exportAppJSON}
                  onExportCSV={exportAppCSV}
                  onExportXML={exportAppXML}
                  onExportCMDB={exportAppCMDB}
                />
              </Flex>
            </Tab>

            <Tab title={`All Edges (${allEdges.length})`}>
              {allEdges.length > 0 ? (
                <DataTable data={allEdges} columns={tableColumns} sortable fullWidth />
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
