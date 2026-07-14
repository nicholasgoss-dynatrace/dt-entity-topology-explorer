import React, { useEffect, useMemo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  Handle, Position,
  useNodesState, useEdgesState, useNodesInitialized,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { Surface, Flex } from '@dynatrace/strato-components/layouts';
import { Button } from '@dynatrace/strato-components/buttons';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { AnalyticsIcon } from '@dynatrace/strato-icons';

// ── Brand palette ──────────────────────────────────────────────────────────────

const DT = {
  BLUE:   '#1C5BE5',
  INDIGO: '#4635D6',
  SKY:    '#1497FF',
  CYAN:   '#0e7bb5',
  LIME:   '#5b9300',
  GREEN:  '#3d7e00',
  PURPLE: '#8b1fc8',
  TEAL:   '#0097a7',
  STEEL:  '#546e7a',
};

const CANVAS_BG = '#f0f4f8';

// ── Problem severity → color ───────────────────────────────────────────────────

const PROBLEM_COLORS = {
  AVAILABILITY:              '#e53935',
  ERROR:                     '#f4511e',
  PERFORMANCE_DEGRADATION:   '#fb8c00',
  RESOURCE_CONTENTION:       '#fdd835',
  CUSTOM_ALERT:              '#1C5BE5',
};

function problemColor(severity) {
  return PROBLEM_COLORS[severity] || '#e53935';
}

// ── Accent by entity type / service name ──────────────────────────────────────

function serviceAccent(name) {
  const n = name.toLowerCase();
  if (n.includes('frontend') || n.includes('web') || n.includes('ui') || n.includes('browser')) return DT.SKY;
  if (n.includes('proxy') || n.includes('gateway') || n.includes('ingress') || n.includes('nginx')) return DT.INDIGO;
  if (n.includes('grpc') || n.includes('api') || n.includes('graphql') || n.includes('rest'))        return DT.CYAN;
  if (n.includes('db') || n.includes('database') || n.includes('mysql') ||
      n.includes('postgres') || n.includes('mongo') || n.includes('redis'))                          return DT.LIME;
  if (n.includes('queue') || n.includes('kafka') || n.includes('rabbit') ||
      n.includes('topic') || n.includes('event'))                                                    return DT.PURPLE;
  return DT.GREEN;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const LABEL_STYLE = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: '#8494a8',
  whiteSpace: 'nowrap', paddingTop: 1, lineHeight: 1.4,
};
const VALUE_STYLE  = { fontSize: 11, color: '#1f2937', lineHeight: 1.4, wordBreak: 'break-word' };
const MUTED_STYLE  = { ...VALUE_STYLE, color: '#9ca3af', fontStyle: 'italic' };

function Row({ label, value }) {
  return (
    <>
      <span style={LABEL_STYLE}>{label}</span>
      <span style={value ? VALUE_STYLE : MUTED_STYLE}>{value || '—'}</span>
    </>
  );
}

const SEV_LABEL = {
  AVAILABILITY:            'AVL',
  ERROR:                   'ERR',
  PERFORMANCE_DEGRADATION: 'PERF',
  RESOURCE_CONTENTION:     'RES',
  CUSTOM_ALERT:            'ALRT',
};
const SEV_FULL = {
  AVAILABILITY:            'Availability problem',
  ERROR:                   'Error problem',
  PERFORMANCE_DEGRADATION: 'Performance degradation',
  RESOURCE_CONTENTION:     'Resource contention',
  CUSTOM_ALERT:            'Custom alert',
};

function ProblemBadge({ severity }) {
  if (!severity) return null;
  const color = problemColor(severity);
  const label = SEV_LABEL[severity] || '!';
  const full  = SEV_FULL[severity]  || 'Open problem';
  return (
    <span
      role="img"
      aria-label={full}
      title={full}
      style={{
        position: 'absolute', top: -6, right: -6,
        background: color, color: '#fff',
        fontSize: 8, fontWeight: 800, letterSpacing: '0.04em',
        padding: '2px 5px', borderRadius: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        lineHeight: 1.2, zIndex: 10,
      }}>
      {label}
    </span>
  );
}

function NodeCard({ accent, header, children, handles = 'both', problem }) {
  return (
    <div style={{ position: 'relative', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <ProblemBadge severity={problem} />
      <div style={{
        background: '#fff', borderRadius: 8, overflow: 'hidden',
        border: `1.5px solid ${accent}`,
        boxShadow: '0 1px 6px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
        minWidth: 190, maxWidth: 290,
      }}>
        {/* Header */}
        <div style={{ background: accent, padding: '7px 11px' }}>
          {header}
        </div>
        {/* Body */}
        <div style={{
          padding: '8px 11px 6px',
          display: 'grid', gridTemplateColumns: '48px 1fr',
          columnGap: 8, rowGap: 4, alignItems: 'start',
        }}>
          {children}
        </div>
      </div>
      {(handles === 'both' || handles === 'target') && (
        <Handle type="target" position={Position.Left}
          style={{ background: accent, width: 8, height: 8, border: '2px solid white' }} />
      )}
      {(handles === 'both' || handles === 'source') && (
        <Handle type="source" position={Position.Right}
          style={{ background: accent, width: 8, height: 8, border: '2px solid white' }} />
      )}
    </div>
  );
}

// ── Node: DT APPLICATION ───────────────────────────────────────────────────────

function ApplicationNode({ data }) {
  const { displayName, appType, managementZones, tags, problem } = data;
  return (
    <NodeCard accent={DT.INDIGO} problem={problem} handles="source" header={
      <Flex alignItems="center" gap={6}>
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1.3, flex: 1, wordBreak: 'break-word' }}>
          {displayName}
        </span>
        <span style={{
          background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 9,
          fontWeight: 800, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
        }}>APP</span>
      </Flex>
    }>
      <Row label="Type" value={appType ? appType.replace(/_/g, ' ') : null} />
      <Row label="Zone" value={managementZones?.join(', ')} />
      {tags?.length > 0 && <Row label="Tags" value={tags.slice(0, 2).join(', ') + (tags.length > 2 ? ` +${tags.length - 2}` : '')} />}
    </NodeCard>
  );
}

// ── Node: SERVICE ──────────────────────────────────────────────────────────────

function ServiceNode({ data }) {
  const { name, isRoot, serviceType, technology, managementZones, tags, problem } = data;
  const accent = isRoot ? DT.BLUE : serviceAccent(name);
  const typeLabel = serviceType
    ? ({ WEB_REQUEST: 'Web Request', DATABASE: 'Database', MESSAGING_SERVICE: 'Messaging',
         CUSTOM_SERVICE: 'Custom', BACKGROUND: 'Background', INFERRED_SERVICE: 'Inferred',
         REMOTE_SERVICE: 'Remote' }[serviceType] || serviceType.replace(/_/g, ' ').toLowerCase())
    : null;
  return (
    <NodeCard accent={accent} problem={problem} handles="both" header={
      <Flex alignItems="center" gap={6}>
        <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1.3, flex: 1, wordBreak: 'break-word' }}>
          {name}
        </span>
        {isRoot && (
          <span style={{
            background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 8,
            fontWeight: 800, padding: '2px 5px', borderRadius: 4, whiteSpace: 'nowrap',
          }}>ROOT</span>
        )}
      </Flex>
    }>
      <Row label="Type"  value={typeLabel} />
      <Row label="Tech"  value={technology} />
      <Row label="Zone"  value={managementZones?.join(', ')} />
      {tags?.length > 0 && <Row label="Tags" value={tags.slice(0, 2).join(', ') + (tags.length > 2 ? ` +${tags.length - 2}` : '')} />}
    </NodeCard>
  );
}

// ── Node: PROCESS GROUP ────────────────────────────────────────────────────────

function ProcessGroupNode({ data }) {
  const { displayName, pgTechnologies, version, managementZones, problem } = data;
  return (
    <NodeCard accent={DT.TEAL} problem={problem} handles="both" header={
      <Flex alignItems="center" gap={6}>
        <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1.3, flex: 1, wordBreak: 'break-word' }}>
          {displayName}
        </span>
        <span style={{
          background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 8,
          fontWeight: 800, padding: '2px 5px', borderRadius: 4, whiteSpace: 'nowrap',
        }}>PG</span>
      </Flex>
    }>
      <Row label="Tech"    value={pgTechnologies} />
      <Row label="Version" value={version} />
      <Row label="Zone"    value={managementZones?.join(', ')} />
    </NodeCard>
  );
}

// ── Node: HOST ─────────────────────────────────────────────────────────────────

function HostNode({ data }) {
  const { displayName, osType, osVersion, ipAddresses, cloudType, managementZones, problem } = data;
  return (
    <NodeCard accent={DT.STEEL} problem={problem} handles="target" header={
      <Flex alignItems="center" gap={6}>
        <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1.3, flex: 1, wordBreak: 'break-word' }}>
          {displayName}
        </span>
        <span style={{
          background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 8,
          fontWeight: 800, padding: '2px 5px', borderRadius: 4, whiteSpace: 'nowrap',
        }}>HOST</span>
      </Flex>
    }>
      <Row label="OS"    value={osType ? `${osType}${osVersion ? ' ' + osVersion : ''}` : null} />
      <Row label="IP"    value={ipAddresses} />
      <Row label="Cloud" value={cloudType} />
      <Row label="Zone"  value={managementZones?.join(', ')} />
    </NodeCard>
  );
}

const NODE_TYPES = {
  applicationNode: ApplicationNode,
  serviceNode:     ServiceNode,
  processGroupNode: ProcessGroupNode,
  hostNode:        HostNode,
};

// ── Dagre layout ───────────────────────────────────────────────────────────────

function applyDagreLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 100, marginx: 40, marginy: 40 });
  nodes.forEach(n => {
    g.setNode(n.id, { width: n.measured?.width ?? 220, height: n.measured?.height ?? 120 });
  });
  edges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map(n => {
    const pos = g.node(n.id);
    return { ...n, position: {
      x: pos.x - (n.measured?.width  ?? 220) / 2,
      y: pos.y - (n.measured?.height ?? 120) / 2,
    }};
  });
}

// ── Edge styles by type ────────────────────────────────────────────────────────

function edgeStyle(edgeType) {
  if (edgeType === 'RUNS_ON')  return { stroke: DT.TEAL,  strokeDasharray: '5 3', opacity: 0.45 };
  if (edgeType === 'HOSTED_ON') return { stroke: DT.STEEL, strokeDasharray: '3 3', opacity: 0.35 };
  return { stroke: DT.BLUE, opacity: 0.50 };
}

// ── Flow graph ─────────────────────────────────────────────────────────────────

function FlowGraph({ app, entityDetails, allEdges, problems }) {
  // Build node list — APPLICATION (if real DT app) + services + PGs + hosts reachable from app
  const { rfNodes, rfEdges } = useMemo(() => {
    const nodes = [];
    const edges = [];
    const seenNode = new Set();
    const seenEdge = new Set();

    function addNode(id, type, data) {
      if (seenNode.has(id)) return;
      seenNode.add(id);
      nodes.push({ id, type, position: { x: 0, y: 0 }, data });
    }

    function addEdge(source, target, edgeType) {
      const key = `${source}||${target}`;
      if (seenEdge.has(key) || source === target) return;
      seenEdge.add(key);
      const style = edgeStyle(edgeType);
      edges.push({
        id: `e-${source}-${target}`,
        source, target,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        style: { strokeWidth: 1.5, ...style },
      });
    }

    // DT Application node (if real entity)
    if (app.isDtApp && app.appDetail) {
      const d = app.appDetail;
      addNode(app.entityId, 'applicationNode', {
        displayName: d.displayName,
        appType: d.appType,
        managementZones: d.managementZones,
        tags: d.tags,
        problem: problems[app.entityId],
      });
    }

    // Service nodes
    for (const svc of app.services) {
      const d = entityDetails[svc] || {};
      const isRoot = !app.isDtApp && svc === app.name;
      addNode(svc, 'serviceNode', {
        name: svc, isRoot,
        serviceType:     d.serviceType,
        technology:      d.technology,
        managementZones: d.managementZones,
        tags:            d.tags,
        entityId:        d.entityId,
        problem:         d.entityId ? problems[d.entityId] : undefined,
      });
    }

    // Service call edges
    for (const { source, target, edgeType } of app.edges) {
      if (edgeType === 'CALLS' || !edgeType) addEdge(source, target, 'CALLS');
    }

    // APP → first-entry service edges
    if (app.isDtApp) {
      const calledTargets = new Set(app.edges.map(e => e.target));
      for (const svc of app.services) {
        if (!calledTargets.has(svc)) addEdge(app.entityId, svc, 'CALLS');
      }
    }

    // Process group nodes + edges from services
    const appServicesSet = new Set(app.services);
    const appPgIds = new Set();
    for (const edge of allEdges) {
      if (edge.edgeType !== 'RUNS_ON') continue;
      if (!appServicesSet.has(edge.source)) continue;
      const pgDetail = entityDetails[edge.target];
      if (!pgDetail || pgDetail.entityType !== 'PROCESS_GROUP') continue;
      addNode(edge.target, 'processGroupNode', {
        displayName:     pgDetail.displayName,
        pgTechnologies:  pgDetail.pgTechnologies,
        version:         pgDetail.version,
        managementZones: pgDetail.managementZones,
        problem:         problems[edge.target],
      });
      addEdge(edge.source, edge.target, 'RUNS_ON');
      appPgIds.add(edge.target);
    }

    // Host nodes + edges from PGs
    for (const edge of allEdges) {
      if (edge.edgeType !== 'HOSTED_ON') continue;
      if (!appPgIds.has(edge.source)) continue;
      const hostDetail = entityDetails[edge.target];
      if (!hostDetail || hostDetail.entityType !== 'HOST') continue;
      addNode(edge.target, 'hostNode', {
        displayName:     hostDetail.displayName,
        osType:          hostDetail.osType,
        osVersion:       hostDetail.osVersion,
        ipAddresses:     hostDetail.ipAddresses,
        cloudType:       hostDetail.cloudType,
        managementZones: hostDetail.managementZones,
        problem:         problems[edge.target],
      });
      addEdge(edge.source, edge.target, 'HOSTED_ON');
    }

    return { rfNodes: nodes, rfEdges: edges };
  }, [app, entityDetails, allEdges, problems]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    if (nodesInitialized) setNodes(ns => applyDagreLayout(ns, edges));
  }, [nodesInitialized, edges, setNodes]);

  useEffect(() => {
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [rfNodes, rfEdges, setNodes, setEdges]);

  const totalNodes  = rfNodes.length;
  const graphHeight = Math.max(380, Math.min(1400, totalNodes * 130));

  return (
    <Flex flexDirection="column" gap={8}>
      <div style={{ height: graphHeight, borderRadius: 8, overflow: 'hidden',
                    border: '1px solid var(--dt-colors-border-neutral-default)' }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          fitView fitViewOptions={{ padding: 0.35, maxZoom: 0.75 }}
          minZoom={0.05} maxZoom={4}
          proOptions={{ hideAttribution: true }}
          style={{ background: CANVAS_BG }}
        >
          <Background color="#c8d4e0" gap={20} size={1} />
          <Controls showInteractive={false}
            style={{ bottom: 12, right: 12, left: 'auto', top: 'auto' }} />
        </ReactFlow>
      </div>

      {/* Legend */}
      <Flex flexWrap="wrap" gap={12} style={{ paddingLeft: 2 }}>
        {[
          { color: DT.INDIGO, label: 'Application (DT)' },
          { color: DT.BLUE,   label: 'Service root' },
          { color: DT.GREEN,  label: 'Service' },
          { color: DT.TEAL,   label: 'Process group', dashed: true },
          { color: DT.STEEL,  label: 'Host', dashed: true },
          { color: '#e53935', label: 'Open problem' },
        ].map(({ color, label, dashed }) => (
          <Flex key={label} alignItems="center" gap={5}>
            {dashed
              ? <svg width={14} height={10} aria-hidden="true"><line x1="0" y1="5" x2="14" y2="5"
                  stroke={color} strokeWidth={2} strokeDasharray="3 2" /></svg>
              : <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10,
                               borderRadius: 2, background: color, flexShrink: 0 }} />}
            <span style={{ fontSize: 11, color: 'var(--dt-colors-text-secondary-default)' }}>
              {label}
            </span>
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}

// ── Application card ───────────────────────────────────────────────────────────

function ApplicationCard({ app, entityDetails, allEdges, problems,
                           onExportJSON, onExportCSV, onExportXML, onExportCMDB }) {
  const accent = app.isDtApp ? DT.INDIGO : DT.BLUE;

  return (
    <Surface elevation="raised">
      <Flex flexDirection="column" gap={16} style={{ padding: 20 }}>
        <Flex justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={8}>
          <Flex flexDirection="column" gap={4}>
            <Flex alignItems="center" gap={8}>
              <Heading level={3} style={{ fontSize: 16, fontWeight: 700 }}>{app.name}</Heading>
              {app.isDtApp && (
                <span style={{
                  padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                  background: `color-mix(in oklab, ${DT.INDIGO} 12%, var(--dt-colors-background-container-default))`,
                  color: DT.INDIGO,
                  border: `1px solid color-mix(in oklab, ${DT.INDIGO} 30%, transparent)`,
                }}>Dynatrace App</span>
              )}
            </Flex>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                           textTransform: 'uppercase',
                           color: 'var(--dt-colors-text-secondary-default)' }}>
              {app.serviceCount} service{app.serviceCount !== 1 ? 's' : ''}
              {' · '}
              {(() => { const n = app.edges.filter(e => e.edgeType === 'CALLS' || !e.edgeType).length; return `${n} dependenc${n !== 1 ? 'ies' : 'y'}`; })()}
            </span>
          </Flex>
          <Flex gap={8} flexWrap="wrap">
            <Button variant="default" onClick={() => onExportCMDB(app)}>CMDB CSV</Button>
            <Button variant="default" onClick={() => onExportXML(app)}>XML</Button>
            <Button variant="default" onClick={() => onExportJSON(app)}>JSON</Button>
            <Button variant="default" onClick={() => onExportCSV(app)}>Paths CSV</Button>
          </Flex>
        </Flex>

        <ReactFlowProvider>
          <FlowGraph app={app} entityDetails={entityDetails}
                     allEdges={allEdges} problems={problems} />
        </ReactFlowProvider>

        {/* Service chips */}
        <Flex flexWrap="wrap" gap={6}>
          {[...app.services].sort((a, b) => a.localeCompare(b)).map(svc => {
            const a = serviceAccent(svc);
            const svcDetail = entityDetails[svc] || {};
            const hasProblem = svcDetail.entityId && problems[svcDetail.entityId];
            return (
              <span key={svc} style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
                background: `color-mix(in oklab, ${a} 12%, var(--dt-colors-background-container-default))`,
                color: hasProblem ? problemColor(problems[svcDetail.entityId]) : a,
                border: `1px solid color-mix(in oklab, ${hasProblem ? problemColor(problems[svcDetail.entityId]) : a} 35%, transparent)`,
              }}>
                {hasProblem && <span role="img" aria-label={`Problem: ${problems[svcDetail.entityId]}`}>⚠ </span>}{svc}
              </span>
            );
          })}
        </Flex>
      </Flex>
    </Surface>
  );
}

// ── Root export ────────────────────────────────────────────────────────────────

export default function ApplicationMap({
  applications, entityDetails, allEdges, problems,
  onExportJSON, onExportCSV, onExportXML, onExportCMDB,
}) {
  if (!applications.length) {
    return (
      <Surface elevation="raised" style={{ padding: 48 }}>
        <Flex flexDirection="column" alignItems="center" gap={16}>
          <Flex alignItems="center" justifyContent="center" style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'color-mix(in oklab, var(--dt-colors-background-primary-default) 12%, var(--dt-colors-background-container-default))',
          }}>
            <AnalyticsIcon size={24} style={{ color: 'var(--dt-colors-background-primary-default)' }} />
          </Flex>
          <Flex flexDirection="column" alignItems="center" gap={6}>
            <Heading level={3} style={{ fontSize: 16, fontWeight: 600 }}>No applications detected</Heading>
            <Paragraph style={{ color: 'var(--dt-colors-text-secondary-default)', fontSize: 13,
                                 textAlign: 'center', maxWidth: 380 }}>
              No service call relationships were found in this environment. Ensure services are
              instrumented and actively receiving traffic.
            </Paragraph>
          </Flex>
        </Flex>
      </Surface>
    );
  }

  return (
    <Flex flexDirection="column" gap={24} style={{ paddingTop: 8 }}>
      {applications.map(app => (
        <ApplicationCard
          key={app.entityId || app.name}
          app={app} entityDetails={entityDetails}
          allEdges={allEdges} problems={problems}
          onExportJSON={onExportJSON} onExportCSV={onExportCSV}
          onExportXML={onExportXML}  onExportCMDB={onExportCMDB}
        />
      ))}
    </Flex>
  );
}
