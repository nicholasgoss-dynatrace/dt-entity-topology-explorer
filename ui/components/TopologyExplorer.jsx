import React, { useState, useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import { Surface } from '@dynatrace/strato-components/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Button } from '@dynatrace/strato-components/buttons';
import { Checkbox } from '@dynatrace/strato-components/forms';
import { Heading } from '@dynatrace/strato-components/typography';
import { Paragraph } from '@dynatrace/strato-components/typography';
import { ProgressCircle } from '@dynatrace/strato-components/content';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  themeVariables: {
    primaryColor: '#1a6ed8',
    primaryTextColor: '#ffffff',
    primaryBorderColor: '#1a6ed8',
    lineColor: '#6b7280',
    secondaryColor: '#f3f4f6',
    background: '#ffffff',
  },
});

function DiagramBlock({ serviceEntityId, serviceName, code }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !code) return;
    const id = `mermaid_${serviceEntityId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    mermaid.render(id, code)
      .then(({ svg }) => { if (ref.current) ref.current.innerHTML = svg; })
      .catch(console.error);
  }, [code, serviceEntityId]);

  return (
    <Surface>
      <Flex flexDirection="column" gap={8} style={{ padding: 16 }}>
        <Heading level={4}>{serviceName}</Heading>
        <div ref={ref} style={{ overflowX: 'auto' }} />
      </Flex>
    </Surface>
  );
}

/**
 * Given all edges and a starting service name, find every node reachable
 * from that service (full transitive closure — unlimited depth).
 */
function buildReachableGraph(startName, edges) {
  const adjacency = {};
  edges.forEach(({ source, target }) => {
    if (!adjacency[source]) adjacency[source] = [];
    adjacency[source].push(target);
  });

  const visited = new Set();
  const reachableEdges = new Set();
  const queue = [startName];

  while (queue.length > 0) {
    const node = queue.shift();
    if (visited.has(node)) continue;
    visited.add(node);
    (adjacency[node] || []).forEach(target => {
      reachableEdges.add(`${node}||${target}`);
      if (!visited.has(target)) queue.push(target);
    });
  }

  return [...reachableEdges].map(e => {
    const [source, target] = e.split('||');
    return { source, target };
  });
}

function buildMermaidCode(reachableEdges) {
  const nodeIds = {};
  const nodeId = (name) => {
    if (!nodeIds[name]) nodeIds[name] = `N${Object.keys(nodeIds).length}`;
    return nodeIds[name];
  };

  const lines = reachableEdges.map(({ source, target }) =>
    `    ${nodeId(source)}["${source}"] --> ${nodeId(target)}["${target}"]`
  );

  return `graph LR\n${lines.join('\n')}`;
}

function TopologyExplorer({ services, topologyData, loading, onLoadTopology }) {
  const [selectedServices, setSelectedServices] = useState([]);
  const [diagrams, setDiagrams] = useState({});

  const toggleService = (entityId) => {
    setSelectedServices(prev =>
      prev.includes(entityId) ? prev.filter(id => id !== entityId) : [...prev, entityId]
    );
  };

  const handleGenerate = () => {
    if (selectedServices.length === 0) return;
    // If edges already loaded, build diagrams immediately; otherwise fetch first
    if (topologyData && topologyData.length > 0) {
      renderDiagrams(topologyData, selectedServices);
    } else {
      onLoadTopology();
    }
  };

  // When topologyData arrives (after fetch), build diagrams for all selected services
  useEffect(() => {
    if (!topologyData || topologyData.length === 0 || selectedServices.length === 0) return;
    renderDiagrams(topologyData, selectedServices);
  }, [topologyData]);

  const renderDiagrams = (edges, selected) => {
    const newDiagrams = {};
    selected.forEach(entityId => {
      const serviceName = services.find(s => s.entityId === entityId)?.displayName || entityId;
      const reachableEdges = buildReachableGraph(serviceName, edges);
      if (reachableEdges.length > 0) {
        newDiagrams[entityId] = buildMermaidCode(reachableEdges);
      }
    });
    setDiagrams(newDiagrams);
  };

  return (
    <Flex flexDirection="column" gap={16}>
      {/* Controls panel */}
      <Surface>
        <Flex gap={24} style={{ padding: 16 }} flexWrap="wrap" alignItems="flex-end">

          <Flex flexDirection="column" gap={8} style={{ flex: 1, minWidth: 240 }}>
            <Heading level={5}>Services</Heading>
            <div style={{
              maxHeight: 220,
              overflowY: 'auto',
              padding: 8,
              border: '1px solid var(--dt-colors-border-neutral-default)',
              borderRadius: 4,
            }}>
              {services.length === 0 ? (
                <Paragraph>Loading services...</Paragraph>
              ) : (
                <Flex flexDirection="column" gap={4}>
                  {services.map(service => (
                    <Checkbox
                      key={service.entityId}
                      checked={selectedServices.includes(service.entityId)}
                      onChange={() => toggleService(service.entityId)}
                    >
                      {service.displayName}
                    </Checkbox>
                  ))}
                </Flex>
              )}
            </div>
          </Flex>

          <Button
            variant="accent"
            onClick={handleGenerate}
            disabled={loading || selectedServices.length === 0}
          >
            {loading ? 'Loading...' : 'Generate Diagrams'}
          </Button>
        </Flex>
      </Surface>

      {/* Loading */}
      {loading && (
        <Flex justifyContent="center" style={{ padding: 48 }}>
          <ProgressCircle aria-label="Loading topology..." />
        </Flex>
      )}

      {/* Empty state */}
      {!loading && Object.keys(diagrams).length === 0 && (
        <Flex justifyContent="center" style={{ padding: 48 }}>
          <Paragraph>Select services and click "Generate Diagrams" to visualize their full dependency chains.</Paragraph>
        </Flex>
      )}

      {/* Diagrams */}
      {!loading && Object.entries(diagrams).map(([entityId, code]) => {
        const serviceName = services.find(s => s.entityId === entityId)?.displayName || entityId;
        return (
          <DiagramBlock
            key={entityId}
            serviceEntityId={entityId}
            serviceName={serviceName}
            code={code}
          />
        );
      })}
    </Flex>
  );
}

export default TopologyExplorer;
