import { describe, it, expect } from 'vitest';
import { renderDxfToSvg } from '../dxfRenderer';

// Minimal DXF file builder helpers
const dxfHeader = `0
SECTION
2
HEADER
0
ENDSEC`;

const dxfTables = `0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
0
70
0
62
7
6
CONTINUOUS
0
ENDTAB
0
ENDSEC`;

const dxfBlocks = `0
SECTION
2
BLOCKS
0
ENDSEC`;

function makeDxf(entities: string): string {
  return `${dxfHeader}
${dxfTables}
${dxfBlocks}
0
SECTION
2
ENTITIES
${entities}
0
ENDSEC
0
EOF`;
}

function lineEntity(x1: number, y1: number, x2: number, y2: number, layer = '0'): string {
  return `0
LINE
8
${layer}
10
${x1}
20
${y1}
30
0
11
${x2}
21
${y2}
31
0`;
}

function circleEntity(cx: number, cy: number, r: number, layer = '0'): string {
  return `0
CIRCLE
8
${layer}
10
${cx}
20
${cy}
30
0
40
${r}`;
}

function arcEntity(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  return `0
ARC
8
0
10
${cx}
20
${cy}
30
0
40
${r}
50
${startAngle}
51
${endAngle}`;
}

function textEntity(x: number, y: number, height: number, text: string): string {
  return `0
TEXT
8
0
10
${x}
20
${y}
30
0
40
${height}
1
${text}`;
}

function pointEntity(x: number, y: number): string {
  return `0
POINT
8
0
10
${x}
20
${y}
30
0`;
}

function lwpolylineEntity(vertices: [number, number][], closed = false): string {
  let dxf = `0
LWPOLYLINE
8
0
90
${vertices.length}
70
${closed ? 1 : 0}`;
  for (const [x, y] of vertices) {
    dxf += `
10
${x}
20
${y}`;
  }
  return dxf;
}

// ==================== TESTS ====================

describe('renderDxfToSvg', () => {
  it('renders a simple LINE entity', () => {
    const dxf = makeDxf(lineEntity(0, 0, 100, 50));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<line');
    expect(svg).toContain('x1="0"');
    expect(svg).toContain('y1="0"');
    expect(svg).toContain('x2="100"');
    expect(svg).toContain('y2="50"');
  });

  it('renders a CIRCLE entity', () => {
    const dxf = makeDxf(circleEntity(50, 50, 25));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('<circle');
    expect(svg).toContain('cx="50"');
    expect(svg).toContain('cy="50"');
    expect(svg).toContain('r="25"');
  });

  it('renders an ARC entity', () => {
    const dxf = makeDxf(arcEntity(0, 0, 10, 0, 90));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('<path');
    expect(svg).toContain('A 10 10');
  });

  it('renders a TEXT entity', () => {
    const dxf = makeDxf(textEntity(10, 20, 5, 'Hello'));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('<text');
    expect(svg).toContain('Hello');
    expect(svg).toContain('font-size="5"');
  });

  it('renders a POINT entity as small circle', () => {
    const dxf = makeDxf(pointEntity(30, 40));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('<circle');
    expect(svg).toContain('cx="30"');
    expect(svg).toContain('cy="40"');
  });

  it('renders LWPOLYLINE (open)', () => {
    const dxf = makeDxf(lwpolylineEntity([[0, 0], [10, 0], [10, 10]]));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('<polyline');
    expect(svg).toContain('0,0');
    expect(svg).toContain('10,0');
    expect(svg).toContain('10,10');
  });

  it('renders LWPOLYLINE (closed) as polygon', () => {
    const dxf = makeDxf(lwpolylineEntity([[0, 0], [10, 0], [10, 10], [0, 10]], true));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('<polygon');
  });

  it('renders multiple entities', () => {
    const entities = [
      lineEntity(0, 0, 100, 0),
      lineEntity(100, 0, 100, 100),
      circleEntity(50, 50, 20),
    ].join('\n');
    const dxf = makeDxf(entities);
    const svg = renderDxfToSvg(dxf);

    const lineCount = (svg.match(/<line /g) || []).length;
    expect(lineCount).toBe(2);
    expect(svg).toContain('<circle');
  });

  it('applies Y-flip transform for DXF coordinates', () => {
    const dxf = makeDxf(lineEntity(0, 0, 100, 100));
    const svg = renderDxfToSvg(dxf);

    // Should contain a group with scale(1, -1) for Y-flip
    expect(svg).toContain('scale(1, -1)');
  });

  it('sets proper viewBox based on bounding box', () => {
    const dxf = makeDxf(lineEntity(10, 20, 110, 120));
    const svg = renderDxfToSvg(dxf);

    // viewBox should encompass 10..110 in X and 20..120 in Y plus padding
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    expect(viewBoxMatch).toBeTruthy();
    const [vbX, vbY, vbW, vbH] = viewBoxMatch![1].split(' ').map(Number);
    expect(vbX).toBeLessThan(10);
    expect(vbY).toBeLessThan(20);
    expect(vbW).toBeGreaterThan(100);
    expect(vbH).toBeGreaterThan(100);
  });

  it('handles DXF with only a point (minimal entities)', () => {
    const dxf = makeDxf(pointEntity(0, 0));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox=');
  });

  it('has white background', () => {
    const dxf = makeDxf(lineEntity(0, 0, 10, 10));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('background:#ffffff');
  });

  it('escapes special XML characters in text', () => {
    const dxf = makeDxf(textEntity(0, 0, 5, '<test>&"value"'));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('&lt;test&gt;&amp;&quot;value&quot;');
    expect(svg).not.toContain('<test>');
  });

  it('throws on invalid DXF content', () => {
    expect(() => renderDxfToSvg('not a dxf file')).toThrow();
  });

  it('renders stroke attributes on entities', () => {
    const dxf = makeDxf(lineEntity(0, 0, 10, 10));
    const svg = renderDxfToSvg(dxf);

    expect(svg).toContain('stroke=');
    expect(svg).toContain('stroke-width=');
    expect(svg).toContain('fill="none"');
  });
});
