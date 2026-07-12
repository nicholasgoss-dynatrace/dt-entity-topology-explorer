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
  BLUE:    '#1C5BE5',
  INDIGO:  '#4635D6',
  SKY:     '#1497FF',
  CYAN:    '#54C8E9',
  PURPLE:  '#B23BE4',
  LIME:    '#73BE28',  // using GREEN for db — LIME is too yellow on white
  GREEN:   '#73BE28',
  MAGENTA: '#E436FF',
};

// Light canvas — matches DT's own topology/flow diagrams
const CANVAS_BG   = '#f0f4f8';
const CARD_BG     = '#ffffff';
const EDGE_COLOR  = DT.BLUE;
const LABEL_COLOR = '#1c2028';

// Node card dimensions
const NODE_W      = 160;
const NODE_H      = 64;
const ROOT_W      = 180;
const ROOT_H      = 72;
const HEADER_H    = 22;  // colored strip at top of each card

// Map service name patterns → DT brand accent color
function detectAccent(name, isRoot) {
  if (isRoot) return DT.BLUE;
  const n = name.toLowerCase();
  if (n.includes('frontend') || n.includes('web') || n.includes('ui') || n.includes('browser'))
    return DT.SKY;
  if (n.includes('proxy') || n.includes('gateway') || n.includes('ingress') || n.includes('nginx'))
    return DT.INDIGO;
  if (n.includes('grpc') || n.includes('api') || n.includes('graphql') || n.includes('rest'))
    return DT.CYAN;
  if (n.includes('db') || n.includes('database') || n.includes('mysql') ||
      n.includes('postgres') || n.includes('mongo') || n.includes('redis'))
    return DT.LIME;
  if (n.includes('queue') || n.includes('kafka') || n.includes('rabbit') ||
      n.includes('topic') || n.includes('event'))
    return DT.PURPLE;
  if (n.includes('email') || n.includes('notification') || n.includes('alert'))
    return DT.MAGENTA;
  return DT.GREEN;
}

// Keep detectIconAndColor for the service chip list below the graph
function detectIconAndColor(name, isRoot) {
  const accent = detectAccent(name, isRoot);
  return { accent };
}

/**
 * Generates an SVG data URI for the card background:
 *  - Colored header strip at the top
 *  - White body below
 * Root nodes get a solid colored background instead.
 */
function buildCardSvg(accent, isRoot, w, h) {
  let svg;
  if (isRoot) {
    // Solid header color for the root/entry service
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" rx="8" ry="8" fill="${accent}"/>
    </svg>`;
  } else {
    // Header strip + white body
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" rx="8" ry="8" fill="${CARD_BG}"/>
      <rect width="${w}" height="${HEADER_H}" rx="8" ry="8" fill="${accent}"/>
      <rect y="${HEADER_H - 3}" width="${w}" height="3" fill="${accent}"/>
    </svg>`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildCytoElements(app) {
  const nodes = app.services.map(svc => {
    const isRoot = svc === app.name;
    const accent  = detectAccent(svc, isRoot);
    const w       = isRoot ? ROOT_W : NODE_W;
    const h       = isRoot ? ROOT_H : NODE_H;
    const cardSvg = buildCardSvg(accent, isRoot, w, h);
    return {
      data: { id: svc, label: svc, isRoot, accent, cardSvg, w, h },
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
  const cyRef        = useRef(null);

  // Rectangular nodes need more vertical space than circles did
  const graphHeight = Math.max(420, Math.min(1400, app.serviceCount * 96));

  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: buildCytoElements(app),

      style: [
        // ── Base node: card with colored header strip ──────────────────────
        {
          selector: 'node',
          style: {
            'shape': 'roundrectangle',
            'width': NODE_W,
            'height': NODE_H,
            // Card background image (header stripe + white body)
            'background-image': 'data(cardSvg)',
            'background-fit': 'cover',
            'background-clip': 'node',
            'background-color': CARD_BG,
            // Border matches the accent color
            'border-color': 'data(accent)',
            'border-width': 1.5,
            // Label centered — sits naturally in the white body below the header
            'label': 'data(label)',
            'color': LABEL_COLOR,
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '10px',
            'font-family': 'system-ui, -apple-system, sans-serif',
            'font-weight': '600',
            'text-wrap': 'wrap',
            'text-max-width': '144px',
          },
        },
        // ── Root/entry node: solid brand color, white text ─────────────────
        {
          selector: 'node[?isRoot]',
          style: {
            'width': ROOT_W,
            'height': ROOT_H,
            'border-width': 2,
            'font-size': '11px',
            'font-weight': '700',
            'color': '#ffffff',
          },
        },
        // ── Hover highlight ────────────────────────────────────────────────
        {
          selector: 'node:active',
          style: {
            'border-width': 2.5,
            'overlay-opacity': 0,
          },
        },
        // ── Edges: flowing bezier in DT blue ──────────────────────────────
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'width': 2,
            'line-color': EDGE_COLOR,
            'target-arrow-color': EDGE_COLOR,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.9,
            'opacity': 0.6,
          },
        },
        // ── Selected state ─────────────────────────────────────────────────
        {
          selector: ':selected',
          style: {
            'border-color': DT.SKY,
            'border-width': 2.5,
            'opacity': 1,
          },
        },
      ],

      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 44,   // vertical gap between nodes in the same rank column
        rankSep: 200,  // horizontal gap between rank columns (wider for card nodes)
        edgeSep: 20,
        ranker: 'network-simplex',
        padding: 60,
        fit: true,
        animate: false,
      },

      wheelSensitivity: 0.3,
      minZoom: 0.08,
      maxZoom: 4,
    });

    return () => { if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; } };
  }, [app]);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: graphHeight,
          background: CANVAS_BG,
          borderRadius: 8,
          // Subtle inner border to separate canvas from card background
          border: '1px solid var(--dt-colors-border-neutral-default)',
        }}
      />
      <div style={{
        position: 'absolute', bottom: 8, right: 12,
        fontSize: 11, color: '#8494a8',
        userSelect: 'none', pointerEvents: 'none',
      }}>
        Scroll to zoom · Drag to pan
      </div>
      {/* Legend */}
      <Flex gap={16} style={{ marginTop: 8 }}>
        {[
          { color: DT.BLUE,    label: 'Application root' },
          { color: DT.SKY,     label: 'Frontend / web' },
          { color: DT.INDIGO,  label: 'Proxy / gateway' },
          { color: DT.CYAN,    label: 'API / gRPC' },
          { color: DT.LIME,    label: 'Database / cache' },
          { color: DT.PURPLE,  label: 'Queue / events' },
          { color: DT.GREEN,   label: 'Service' },
        ].map(({ color, label }) => (
          <Flex key={label} alignItems="center" gap={5}>
            <span style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: 2,
              background: color, flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: 'var(--dt-colors-text-secondary-default)' }}>
              {label}
            </span>
          </Flex>
        ))}
      </Flex>
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
