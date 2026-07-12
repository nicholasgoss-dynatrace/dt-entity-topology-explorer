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

// ── Dynatrace brand palette ────────────────────────────────────────────────────

const DT = {
  BLUE:    '#1C5BE5',
  INDIGO:  '#4635D6',
  SKY:     '#1497FF',
  CYAN:    '#54C8E9',
  PURPLE:  '#B23BE4',
  LIME:    '#73BE28',
  GREEN:   '#73BE28',
  MAGENTA: '#E436FF',
};

const CANVAS_BG  = '#f0f4f8';
const CARD_BG    = '#ffffff';
const EDGE_COLOR = DT.BLUE;

// Card dimensions — must match SVG viewBox exactly for correct scaling
const NODE_W  = 220;
const NODE_H  = 110;
const ROOT_W  = 240;
const ROOT_H  = 120;
const HDR_H   = 30;   // colored header strip height

// ── Service type → accent color ────────────────────────────────────────────────

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

// Keep for service chips
function detectIconAndColor(name, isRoot) {
  return { accent: detectAccent(name, isRoot) };
}

// ── Service type label formatting ──────────────────────────────────────────────

const SERVICE_TYPE_LABELS = {
  WEB_REQUEST:                    'Web Request',
  DATABASE:                       'Database',
  MESSAGING_SERVICE:              'Messaging',
  CUSTOM_SERVICE:                 'Custom Service',
  ENTERPRISE_SERVICE_BUS:         'ESB',
  OPAQUE_AND_MESSAGING_SERVICE:   'Messaging',
  BACKGROUND:                     'Background',
  INFERRED_SERVICE:               'Inferred',
  REMOTE_SERVICE:                 'Remote Service',
};

function fmtServiceType(raw) {
  if (!raw) return null;
  return SERVICE_TYPE_LABELS[raw] || raw.replace(/_/g, ' ').toLowerCase();
}

// ── SVG card builder ───────────────────────────────────────────────────────────

const xmlEsc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc  = (s, n) => { const str = String(s || ''); return str.length > n ? str.slice(0, n - 1) + '…' : str; };

/**
 * Generates a data URI for a card background SVG.
 *
 * Non-root:  colored header strip (HDR_H px) + white body with 3 data rows
 * Root:      solid accent background, white text throughout
 */
function buildCardSvg(name, accent, isRoot, w, h, details = {}) {
  const svcName   = xmlEsc(trunc(name, 26));
  const typeLabel = xmlEsc(trunc(fmtServiceType(details.serviceType) || '—', 22));
  const techLabel = xmlEsc(trunc(details.technology || '—', 22));
  const zoneLabel = xmlEsc(trunc((details.managementZones || []).join(', ') || '—', 22));
  const entityId  = xmlEsc(trunc(details.entityId || '—', 28));

  // Row y-positions in the body section (below header)
  const r1 = HDR_H + 20;   // Type row
  const r2 = HDR_H + 36;   // Tech row
  const r3 = HDR_H + 52;   // Zone row
  const divY = h - 18;     // Divider above entity ID
  const idY  = h - 6;      // Entity ID baseline

  const LABEL_COL  = '#9ca3af';  // muted gray for field names
  const VALUE_COL  = '#1f2937';  // near-black for values
  const ID_COL     = '#b0b8c4';  // light for entity ID

  // Small accent indicator bar on left of each row
  const bar = (y) =>
    `<rect x="11" y="${y - 9}" width="3" height="10" rx="1.5" fill="${accent}" opacity="0.55"/>`;

  let svg;

  if (isRoot) {
    // Root node: full accent background, white text
    const WHITE       = '#ffffff';
    const WHITE_MUTED = 'rgba(255,255,255,0.65)';
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="8" ry="8" fill="${accent}"/>
  <text x="11" y="21" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="700" fill="${WHITE}">${svcName}</text>
  <text x="11" y="${r1}" font-family="system-ui,-apple-system,sans-serif" font-size="8.5" font-weight="600" fill="${WHITE_MUTED}">TYPE</text>
  <text x="50" y="${r1}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${WHITE}">${typeLabel}</text>
  <text x="11" y="${r2}" font-family="system-ui,-apple-system,sans-serif" font-size="8.5" font-weight="600" fill="${WHITE_MUTED}">TECH</text>
  <text x="50" y="${r2}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${WHITE}">${techLabel}</text>
  <text x="11" y="${r3}" font-family="system-ui,-apple-system,sans-serif" font-size="8.5" font-weight="600" fill="${WHITE_MUTED}">ZONE</text>
  <text x="50" y="${r3}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${WHITE}">${zoneLabel}</text>
  <line x1="11" y1="${divY}" x2="${w - 11}" y2="${divY}" stroke="rgba(255,255,255,0.25)" stroke-width="0.5"/>
  <text x="11" y="${idY}" font-family="ui-monospace,monospace" font-size="8" fill="${WHITE_MUTED}">${entityId}</text>
</svg>`;
  } else {
    // Standard card: colored header + white body
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="8" ry="8" fill="${CARD_BG}"/>
  <rect width="${w}" height="${HDR_H}" rx="8" ry="8" fill="${accent}"/>
  <rect y="${HDR_H - 3}" width="${w}" height="3" fill="${accent}"/>
  <text x="11" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="10.5" font-weight="600" fill="white">${svcName}</text>
  ${bar(r1)}
  <text x="20" y="${r1}" font-family="system-ui,-apple-system,sans-serif" font-size="8.5" font-weight="600" fill="${LABEL_COL}">TYPE</text>
  <text x="55" y="${r1}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${VALUE_COL}">${typeLabel}</text>
  ${bar(r2)}
  <text x="20" y="${r2}" font-family="system-ui,-apple-system,sans-serif" font-size="8.5" font-weight="600" fill="${LABEL_COL}">TECH</text>
  <text x="55" y="${r2}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${VALUE_COL}">${techLabel}</text>
  ${bar(r3)}
  <text x="20" y="${r3}" font-family="system-ui,-apple-system,sans-serif" font-size="8.5" font-weight="600" fill="${LABEL_COL}">ZONE</text>
  <text x="55" y="${r3}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${VALUE_COL}">${zoneLabel}</text>
  <line x1="11" y1="${divY}" x2="${w - 11}" y2="${divY}" stroke="#e5e7eb" stroke-width="0.5"/>
  <text x="11" y="${idY}" font-family="ui-monospace,monospace" font-size="8" fill="${ID_COL}">${entityId}</text>
</svg>`;
  }

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ── Cytoscape element builder ──────────────────────────────────────────────────

function buildCytoElements(app, entityDetails) {
  const nodes = app.services.map(svc => {
    const isRoot  = svc === app.name;
    const accent  = detectAccent(svc, isRoot);
    const w       = isRoot ? ROOT_W : NODE_W;
    const h       = isRoot ? ROOT_H : NODE_H;
    const details = entityDetails[svc] || {};
    const cardSvg = buildCardSvg(svc, accent, isRoot, w, h, details);
    return { data: { id: svc, label: svc, isRoot, accent, cardSvg, w, h } };
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

// ── Cytoscape graph component ──────────────────────────────────────────────────

function CytoscapeGraph({ app, entityDetails }) {
  const containerRef = useRef(null);
  const cyRef        = useRef(null);

  const graphHeight = Math.max(440, Math.min(1600, app.serviceCount * 120));

  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: buildCytoElements(app, entityDetails),

      style: [
        // Base node — card SVG fills the node, label hidden (text is in the SVG)
        {
          selector: 'node',
          style: {
            'shape': 'roundrectangle',
            'width': NODE_W,
            'height': NODE_H,
            'background-image': 'data(cardSvg)',
            'background-fit': 'cover',
            'background-clip': 'node',
            'background-color': CARD_BG,
            'border-color': 'data(accent)',
            'border-width': 1.5,
            'label': '',   // text rendered inside the SVG
            'shadow-blur': 8,
            'shadow-color': 'rgba(0,0,0,0.10)',
            'shadow-offset-x': 0,
            'shadow-offset-y': 2,
            'shadow-opacity': 1,
          },
        },
        // Root/entry node overrides
        {
          selector: 'node[?isRoot]',
          style: {
            'width': ROOT_W,
            'height': ROOT_H,
            'border-width': 2,
            'shadow-blur': 14,
            'shadow-color': 'rgba(28,91,229,0.25)',
            'shadow-offset-y': 3,
          },
        },
        // Hover — brighten border
        {
          selector: 'node:active',
          style: { 'overlay-opacity': 0 },
        },
        // Edges — flowing DT blue bezier curves
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'width': 2,
            'line-color': EDGE_COLOR,
            'target-arrow-color': EDGE_COLOR,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.85,
            'opacity': 0.55,
          },
        },
        // Selected
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
        nodeSep: 44,    // vertical gap between cards in the same column
        rankSep: 240,   // horizontal gap between rank columns
        edgeSep: 20,
        ranker: 'network-simplex',
        padding: 60,
        fit: true,
        animate: false,
      },

      wheelSensitivity: 0.3,
      minZoom: 0.06,
      maxZoom: 4,
    });

    return () => { if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; } };
  }, [app, entityDetails]);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: graphHeight,
          background: CANVAS_BG,
          borderRadius: 8,
          border: '1px solid var(--dt-colors-border-neutral-default)',
        }}
      />

      {/* Zoom hint */}
      <div style={{
        position: 'absolute', bottom: 8, right: 12,
        fontSize: 11, color: '#8494a8',
        userSelect: 'none', pointerEvents: 'none',
      }}>
        Scroll to zoom · Drag to pan
      </div>

      {/* Legend */}
      <Flex flexWrap="wrap" gap={12} style={{ marginTop: 8 }}>
        {[
          { color: DT.BLUE,   label: 'App root' },
          { color: DT.SKY,    label: 'Frontend / web' },
          { color: DT.INDIGO, label: 'Proxy / gateway' },
          { color: DT.CYAN,   label: 'API / gRPC' },
          { color: DT.LIME,   label: 'Database' },
          { color: DT.PURPLE, label: 'Queue / events' },
          { color: DT.GREEN,  label: 'Service' },
        ].map(({ color, label }) => (
          <Flex key={label} alignItems="center" gap={5}>
            <span style={{
              display: 'inline-block', width: 10, height: 10,
              borderRadius: 2, background: color, flexShrink: 0,
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

// ── Application card ───────────────────────────────────────────────────────────

function ApplicationCard({ app, entityDetails, onExportJSON, onExportCSV, onExportXML, onExportCMDB }) {
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
          <Flex gap={8} flexWrap="wrap">
            <Button variant="default" onClick={() => onExportCMDB(app)}>CMDB CSV</Button>
            <Button variant="default" onClick={() => onExportXML(app)}>XML</Button>
            <Button variant="default" onClick={() => onExportJSON(app)}>JSON</Button>
            <Button variant="default" onClick={() => onExportCSV(app)}>Paths CSV</Button>
          </Flex>
        </Flex>

        <CytoscapeGraph app={app} entityDetails={entityDetails} />

        {/* Service chips — theme-aware tinted background */}
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
        <ApplicationCard
          key={app.name} app={app} entityDetails={entityDetails}
          onExportJSON={onExportJSON} onExportCSV={onExportCSV}
          onExportXML={onExportXML} onExportCMDB={onExportCMDB}
        />
      ))}
    </Flex>
  );
}
