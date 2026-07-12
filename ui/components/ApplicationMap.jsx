import React, { useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  Handle, Position,
  useNodesState, useEdgesState, useNodesInitialized, useReactFlow,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { Surface } from '@dynatrace/strato-components/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Button } from '@dynatrace/strato-components/buttons';
import { Heading } from '@dynatrace/strato-components/typography';
import { Paragraph } from '@dynatrace/strato-components/typography';
import { AnalyticsIcon } from '@dynatrace/strato-icons';

// ── Dynatrace brand palette ────────────────────────────────────────────────────

const DT = {
  BLUE:    '#1C5BE5',
  INDIGO:  '#4635D6',
  SKY:     '#1497FF',
  CYAN:    '#54C8E9',
  PURPLE:  '#B23BE4',
  LIME:    '#5b9300',  // darkened for text contrast
  GREEN:   '#3d7e00',
  MAGENTA: '#c020d4',
};

const CANVAS_BG  = '#f0f4f8';
const EDGE_COLOR = '#1C5BE5';

// ── Service type → accent color ────────────────────────────────────────────────

function detectAccent(name, isRoot) {
  if (isRoot) return DT.BLUE;
  const n = name.toLowerCase();
  if (n.includes('frontend') || n.includes('web') || n.includes('ui') || n.includes('browser'))
    return DT.SKY;
  if (n.includes('proxy') || n.includes('gateway') || n.includes('ingress') || n.includes('nginx'))
    return DT.INDIGO;
  if (n.includes('grpc') || n.includes('api') || n.includes('graphql') || n.includes('rest'))
    return '#0e7bb5';
  if (n.includes('db') || n.includes('database') || n.includes('mysql') ||
      n.includes('postgres') || n.includes('mongo') || n.includes('redis'))
    return DT.LIME;
  if (n.includes('queue') || n.includes('kafka') || n.includes('rabbit') ||
      n.includes('topic') || n.includes('event'))
    return '#8b1fc8';
  if (n.includes('email') || n.includes('notification') || n.includes('alert'))
    return '#a010a0';
  return DT.GREEN;
}

// ── Service type label ─────────────────────────────────────────────────────────

const SERVICE_TYPE_LABELS = {
  WEB_REQUEST:                  'Web Request',
  DATABASE:                     'Database',
  MESSAGING_SERVICE:            'Messaging',
  CUSTOM_SERVICE:               'Custom Service',
  ENTERPRISE_SERVICE_BUS:       'ESB',
  OPAQUE_AND_MESSAGING_SERVICE: 'Messaging',
  BACKGROUND:                   'Background',
  INFERRED_SERVICE:             'Inferred',
  REMOTE_SERVICE:               'Remote Service',
};

function fmtServiceType(raw) {
  if (!raw) return null;
  return SERVICE_TYPE_LABELS[raw] || raw.replace(/_/g, ' ').toLowerCase();
}

// ── Node card component ────────────────────────────────────────────────────────

const LABEL_STYLE = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#8494a8',
  whiteSpace: 'nowrap',
  paddingTop: 1,
  lineHeight: 1.4,
};

const VALUE_STYLE = {
  fontSize: 11,
  color: '#1f2937',
  lineHeight: 1.4,
  wordBreak: 'break-word',
};

const VALUE_STYLE_MUTED = {
  ...VALUE_STYLE,
  color: '#9ca3af',
  fontStyle: 'italic',
};

function DataRow({ label, value }) {
  const hasValue = value && value !== '—';
  return (
    <>
      <span style={LABEL_STYLE}>{label}</span>
      <span style={hasValue ? VALUE_STYLE : VALUE_STYLE_MUTED}>{value || '—'}</span>
    </>
  );
}

function ServiceNode({ data }) {
  const { name, accent, isRoot, entityId, serviceType, technology, managementZones, tags } = data;

  const nodeStyle = {
    background: '#ffffff',
    borderRadius: 8,
    boxShadow: isRoot
      ? `0 2px 12px rgba(28,91,229,0.20), 0 1px 3px rgba(0,0,0,0.08)`
      : `0 1px 6px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)`,
    border: `1.5px solid ${isRoot ? accent : '#dde3ec'}`,
    minWidth: 200,
    maxWidth: 300,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    overflow: 'hidden',
  };

  const headerStyle = {
    background: accent,
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
  };

  const nameStyle = {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    wordBreak: 'break-word',
    flex: 1,
  };

  const bodyStyle = {
    padding: '8px 12px 6px',
    display: 'grid',
    gridTemplateColumns: '44px 1fr',
    columnGap: 10,
    rowGap: 4,
    alignItems: 'start',
  };

  const footerStyle = {
    borderTop: '1px solid #e8ecf2',
    padding: '4px 12px 5px',
  };

  const entityIdStyle = {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 9,
    color: '#b0b8c4',
    letterSpacing: '0.03em',
    wordBreak: 'break-all',
  };

  const typeLabel  = fmtServiceType(serviceType);
  const zonesLabel = managementZones?.length ? managementZones.join(', ') : null;

  return (
    <div style={nodeStyle}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: accent, width: 8, height: 8, border: '2px solid white' }}
      />

      {/* Header */}
      <div style={headerStyle}>
        <span style={nameStyle}>{name}</span>
        {isRoot && (
          <span style={{
            background: 'rgba(255,255,255,0.25)', color: '#fff',
            fontSize: 9, fontWeight: 700, padding: '2px 5px',
            borderRadius: 4, letterSpacing: '0.05em', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            ROOT
          </span>
        )}
      </div>

      {/* Body — 2-column grid */}
      <div style={bodyStyle}>
        <DataRow label="Type"  value={typeLabel} />
        <DataRow label="Tech"  value={technology} />
        <DataRow label="Zone"  value={zonesLabel} />
        {tags?.length > 0 && (
          <DataRow label="Tags" value={tags.slice(0, 3).join(', ') + (tags.length > 3 ? ` +${tags.length - 3}` : '')} />
        )}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <span style={entityIdStyle}>{entityId || ''}</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: accent, width: 8, height: 8, border: '2px solid white' }}
      />
    </div>
  );
}

const NODE_TYPES = { service: ServiceNode };

// ── Dagre auto-layout ──────────────────────────────────────────────────────────

function applyDagreLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 100, marginx: 40, marginy: 40 });

  nodes.forEach(node => {
    g.setNode(node.id, {
      width:  node.measured?.width  ?? 240,
      height: node.measured?.height ?? 120,
    });
  });

  edges.forEach(edge => g.setEdge(edge.source, edge.target));

  dagre.layout(g);

  return nodes.map(node => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - (node.measured?.width  ?? 240) / 2,
        y: pos.y - (node.measured?.height ?? 120) / 2,
      },
    };
  });
}

// ── Flow inner component (needs ReactFlowProvider context) ─────────────────────

function FlowGraph({ app, entityDetails }) {
  const initialNodes = useMemo(() =>
    app.services.map(svc => {
      const isRoot  = svc === app.name;
      const accent  = detectAccent(svc, isRoot);
      const details = entityDetails[svc] || {};
      return {
        id:       svc,
        type:     'service',
        position: { x: 0, y: 0 },
        data: {
          name:            svc,
          accent,
          isRoot,
          entityId:        details.entityId,
          serviceType:     details.serviceType,
          technology:      details.technology,
          managementZones: details.managementZones,
          tags:            details.tags,
        },
      };
    }), [app, entityDetails]);

  const initialEdges = useMemo(() => {
    const seen = new Set();
    return app.edges
      .filter(({ source, target }) => {
        const key = `${source}||${target}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(({ source, target }, i) => ({
        id:     `e${i}-${source}-${target}`,
        source,
        target,
        type:   'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
        style: { stroke: EDGE_COLOR, strokeWidth: 1.5, opacity: 0.55 },
      }));
  }, [app]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const nodesInitialized = useNodesInitialized();

  // Run layout once node dimensions are known
  useEffect(() => {
    if (!nodesInitialized) return;
    setNodes(ns => applyDagreLayout(ns, edges));
  }, [nodesInitialized]);

  // Re-run when app data changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [app, entityDetails]);

  const graphHeight = Math.max(380, Math.min(1400, app.serviceCount * 140));

  return (
    <div style={{ height: graphHeight, borderRadius: 8, overflow: 'hidden',
                  border: '1px solid var(--dt-colors-border-neutral-default)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 0.75 }}
        minZoom={0.05}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        style={{ background: CANVAS_BG }}
      >
        <Background color="#c8d4e0" gap={20} size={1} />
        <Controls showInteractive={false} style={{ bottom: 12, right: 12, left: 'auto', top: 'auto' }} />
      </ReactFlow>
    </div>
  );
}

// ── Application card ───────────────────────────────────────────────────────────

function ApplicationCard({ app, entityDetails, onExportJSON, onExportCSV, onExportXML, onExportCMDB }) {
  const accent = detectAccent(app.name, true);

  return (
    <Surface elevation="raised">
      <Flex flexDirection="column" gap={16} style={{ padding: 20 }}>
        <Flex justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={8}>
          <Flex flexDirection="column" gap={4}>
            <Heading level={3} style={{ fontSize: 16, fontWeight: 700 }}>{app.name}</Heading>
            <span style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--dt-colors-text-secondary-default)',
            }}>
              {app.serviceCount} service{app.serviceCount !== 1 ? 's' : ''}
              {' · '}
              {app.edges.length} dependenc{app.edges.length !== 1 ? 'ies' : 'y'}
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
          <FlowGraph app={app} entityDetails={entityDetails} />
        </ReactFlowProvider>

        {/* Service chips */}
        <Flex flexWrap="wrap" gap={6}>
          {[...app.services].sort((a, b) => a.localeCompare(b)).map(svc => {
            const a = detectAccent(svc, svc === app.name);
            return (
              <span key={svc} style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
                background: `color-mix(in oklab, ${a} 12%, var(--dt-colors-background-container-default))`,
                color: a,
                border: `1px solid color-mix(in oklab, ${a} 35%, transparent)`,
              }}>
                {svc}
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
  applications, entityDetails,
  onExportJSON, onExportCSV, onExportXML, onExportCMDB,
}) {
  if (applications.length === 0) {
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
            <Paragraph style={{
              color: 'var(--dt-colors-text-secondary-default)', fontSize: 13,
              textAlign: 'center', maxWidth: 380,
            }}>
              No service call relationships were found in this environment. Ensure services are instrumented and actively receiving traffic.
            </Paragraph>
          </Flex>
        </Flex>
      </Surface>
    );
  }

  return (
    <Flex flexDirection="column" gap={24} style={{ paddingTop: 16 }}>
      {applications.map(app => (
        <ApplicationCard
          key={app.name} app={app} entityDetails={entityDetails}
          onExportJSON={onExportJSON} onExportCSV={onExportCSV}
          onExportXML={onExportXML}  onExportCMDB={onExportCMDB}
        />
      ))}
    </Flex>
  );
}
