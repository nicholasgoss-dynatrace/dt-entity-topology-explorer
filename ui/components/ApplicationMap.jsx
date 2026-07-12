import React, { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);
import { Surface } from '@dynatrace/strato-components/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Button } from '@dynatrace/strato-components/buttons';
import { Heading } from '@dynatrace/strato-components/typography';
import { Paragraph } from '@dynatrace/strato-components/typography';
import { AnalyticsIcon } from '@dynatrace/strato-icons';

// Dynatrace brand palette
const DT = {
  BLUE:       '#1C5BE5',
  INDIGO:     '#4635D6',
  SKY:        '#1497FF',
  CYAN:       '#54C8E9',
  PURPLE:     '#B23BE4',
  LIME:       '#BDDF28',
  GREEN:      '#73BE28',
  MAGENTA:    '#E436FF',
};

const DARK_BG     = '#0f1423';
const EDGE_COLOR  = '#54C8E9';
const LABEL_COLOR = '#c8d6f0';

// --- SVG icon data URIs (white, 24x24 viewBox) ---

// Generic service: three layered rectangles (server/microservice)
const SERVICE_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="3" y="4" width="18" height="4" rx="1" fill="white" opacity="0.9"/>
  <rect x="3" y="10" width="18" height="4" rx="1" fill="white" opacity="0.9"/>
  <rect x="3" y="16" width="18" height="4" rx="1" fill="white" opacity="0.9"/>
  <circle cx="19" cy="6" r="1" fill="#14192e"/>
  <circle cx="19" cy="12" r="1" fill="#14192e"/>
  <circle cx="19" cy="18" r="1" fill="#14192e"/>
</svg>`)}`;

// Frontend/web: browser window
const WEB_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="2" y="3" width="20" height="16" rx="2" fill="none" stroke="white" stroke-width="1.8"/>
  <line x1="2" y1="8" x2="22" y2="8" stroke="white" stroke-width="1.8"/>
  <circle cx="5.5" cy="5.5" r="1" fill="white"/>
  <circle cx="9" cy="5.5" r="1" fill="white"/>
  <rect x="5" y="11" width="14" height="2" rx="1" fill="white" opacity="0.7"/>
  <rect x="5" y="15" width="9" height="2" rx="1" fill="white" opacity="0.5"/>
</svg>`)}`;

// gRPC/API: connected nodes
const API_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="3" fill="white"/>
  <circle cx="4"  cy="6"  r="2" fill="white" opacity="0.8"/>
  <circle cx="20" cy="6"  r="2" fill="white" opacity="0.8"/>
  <circle cx="4"  cy="18" r="2" fill="white" opacity="0.8"/>
  <circle cx="20" cy="18" r="2" fill="white" opacity="0.8"/>
  <line x1="6"  y1="7"  x2="10" y2="10.5" stroke="white" stroke-width="1.4" opacity="0.7"/>
  <line x1="18" y1="7"  x2="14" y2="10.5" stroke="white" stroke-width="1.4" opacity="0.7"/>
  <line x1="6"  y1="17" x2="10" y2="13.5" stroke="white" stroke-width="1.4" opacity="0.7"/>
  <line x1="18" y1="17" x2="14" y2="13.5" stroke="white" stroke-width="1.4" opacity="0.7"/>
</svg>`)}`;

// Proxy/gateway: shield/funnel
const PROXY_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M12 2 L20 6 L20 12 C20 17 12 22 12 22 C12 22 4 17 4 12 L4 6 Z"
        fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>
  <line x1="8" y1="10" x2="16" y2="10" stroke="white" stroke-width="1.5"/>
  <line x1="9" y1="13.5" x2="15" y2="13.5" stroke="white" stroke-width="1.5"/>
  <line x1="11" y1="17" x2="13" y2="17" stroke="white" stroke-width="1.5"/>
</svg>`)}`;

// Database
const DB_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <ellipse cx="12" cy="6" rx="8" ry="3" fill="none" stroke="white" stroke-width="1.8"/>
  <path d="M4 6 L4 18 C4 19.7 7.6 21 12 21 C16.4 21 20 19.7 20 18 L20 6"
        fill="none" stroke="white" stroke-width="1.8"/>
  <line x1="4" y1="12" x2="20" y2="12" stroke="white" stroke-width="1.2" opacity="0.6"/>
</svg>`)}`;

// Queue/messaging
const QUEUE_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="2"  y="5"  width="20" height="5" rx="1.5" fill="white" opacity="0.9"/>
  <rect x="2"  y="13" width="20" height="5" rx="1.5" fill="white" opacity="0.6"/>
  <path d="M18 21 L22 18.5 L18 16" fill="none" stroke="white" stroke-width="1.5" opacity="0.5"/>
</svg>`)}`;

// Darken a hex color for use as a node background (keep text/icon readable)
function darken(hex, amount = 0.55) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8)  & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff)         * (1 - amount));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function detectIconAndColor(name, isRoot) {
  const n = name.toLowerCase();

  if (isRoot)
    return { icon: WEB_ICON,   accent: DT.BLUE,    bg: darken(DT.BLUE),    border: DT.BLUE };
  if (n.includes('frontend') || n.includes('web') || n.includes('ui') || n.includes('browser'))
    return { icon: WEB_ICON,   accent: DT.SKY,     bg: darken(DT.SKY),     border: DT.SKY };
  if (n.includes('proxy') || n.includes('gateway') || n.includes('ingress') || n.includes('nginx'))
    return { icon: PROXY_ICON, accent: DT.INDIGO,  bg: darken(DT.INDIGO),  border: DT.INDIGO };
  if (n.includes('grpc') || n.includes('api') || n.includes('graphql') || n.includes('rest'))
    return { icon: API_ICON,   accent: DT.CYAN,    bg: darken(DT.CYAN),    border: DT.CYAN };
  if (n.includes('db') || n.includes('database') || n.includes('mysql') ||
      n.includes('postgres') || n.includes('mongo') || n.includes('redis'))
    return { icon: DB_ICON,    accent: DT.LIME,    bg: darken(DT.LIME),    border: DT.LIME };
  if (n.includes('queue') || n.includes('kafka') || n.includes('rabbit') ||
      n.includes('topic') || n.includes('event'))
    return { icon: QUEUE_ICON, accent: DT.PURPLE,  bg: darken(DT.PURPLE),  border: DT.PURPLE };
  if (n.includes('email') || n.includes('notification') || n.includes('alert'))
    return { icon: SERVICE_ICON, accent: DT.MAGENTA, bg: darken(DT.MAGENTA), border: DT.MAGENTA };
  return { icon: SERVICE_ICON, accent: DT.GREEN,   bg: darken(DT.GREEN),   border: DT.GREEN };
}

function buildCytoElements(app) {
  const nodes = app.services.map(svc => {
    const isRoot = svc === app.name;
    const { icon, bg, border, accent } = detectIconAndColor(svc, isRoot);
    return {
      data: { id: svc, label: svc, isRoot, icon, bg, border, accent },
    };
  });

  const seen = new Set();
  const edges = app.edges
    .filter(({ source, target }) => {
      const key = `${source}||${target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ source, target }, i) => ({
      data: { id: `e${i}`, source, target },
    }));

  return [...nodes, ...edges];
}

function CytoscapeGraph({ app }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);

  // dagre LR: height driven by how many nodes share the same rank column
  const graphHeight = Math.max(400, Math.min(1000, app.serviceCount * 80));

  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }

    const elements = buildCytoElements(app);

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements,

      style: [
        {
          selector: 'node',
          style: {
            // Circle appearance
            'shape': 'ellipse',
            'width': 56,
            'height': 56,
            'background-color': 'data(bg)',
            'border-color': 'data(border)',
            'border-width': 2,
            // Icon inside circle — centered
            'background-image': 'data(icon)',
            'background-fit': 'none',
            'background-clip': 'node',
            'background-width': '55%',
            'background-height': '55%',
            'background-position-x': '50%',
            'background-position-y': '50%',
            // Label OUTSIDE below the node
            'label': 'data(label)',
            'color': LABEL_COLOR,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 8,
            'font-size': '11px',
            'font-family': 'system-ui, sans-serif',
            'text-wrap': 'wrap',
            'text-max-width': '100px',
            'text-background-color': DARK_BG,
            'text-background-opacity': 0.7,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
          },
        },
        {
          selector: 'node[?isRoot]',
          style: {
            'width': 72,
            'height': 72,
            'border-width': 3,
            'font-size': '12px',
            'font-weight': 'bold',
            'color': '#ffffff',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': DT.CYAN,
            'target-arrow-color': DT.CYAN,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.5,
          },
        },
        {
          selector: ':selected',
          style: {
            'border-color': '#7eb8ff',
            'border-width': 3,
          },
        },
      ],

      layout: {
        name: 'dagre',
        rankDir: 'LR',          // Left → Right, root node on the far left
        align: 'UL',
        nodeSep: 60,            // vertical spacing between nodes in the same rank
        rankSep: 120,           // horizontal spacing between ranks (columns)
        edgeSep: 20,
        ranker: 'network-simplex',
        padding: 60,
        fit: true,
        animate: false,
      },

      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 4,
    });

    return () => { if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; } };
  }, [app]);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: graphHeight, background: DARK_BG, borderRadius: 8 }}
      />
      <div style={{
        position: 'absolute', bottom: 8, right: 12,
        fontSize: 11, color: '#4a6098',
        userSelect: 'none', pointerEvents: 'none',
      }}>
        Scroll to zoom · Drag to pan
      </div>
    </div>
  );
}

function ApplicationCard({ app, onExportJSON, onExportCSV, onExportXML }) {
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
              {app.serviceCount} service{app.serviceCount !== 1 ? 's' : ''} · {app.edges.length} dependenc{app.edges.length !== 1 ? 'ies' : 'y'}
            </span>
          </Flex>
          <Flex gap={8}>
            <Button variant="default" onClick={() => onExportJSON(app)}>JSON</Button>
            <Button variant="default" onClick={() => onExportCSV(app)}>CSV</Button>
            <Button variant="default" onClick={() => onExportXML(app)}>XML</Button>
          </Flex>
        </Flex>

        <CytoscapeGraph app={app} />

        {/* Service chips — theme-aware: tinted bg, accent border, accent text */}
        <Flex flexWrap="wrap" gap={6}>
          {[...app.services].sort((a, b) => a.localeCompare(b)).map(svc => {
            const { accent } = detectIconAndColor(svc, svc === app.name);
            return (
              <span key={svc} style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
                background: `color-mix(in oklab, ${accent} 12%, var(--dt-colors-background-container-default))`,
                color: accent,
                border: `1px solid color-mix(in oklab, ${accent} 35%, transparent)`,
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

export default function ApplicationMap({ applications, onExportJSON, onExportCSV, onExportXML }) {
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
            <Paragraph style={{ color: 'var(--dt-colors-text-secondary-default)', fontSize: 13, textAlign: 'center', maxWidth: 380 }}>
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
        <ApplicationCard key={app.name} app={app}
          onExportJSON={onExportJSON} onExportCSV={onExportCSV} onExportXML={onExportXML} />
      ))}
    </Flex>
  );
}
