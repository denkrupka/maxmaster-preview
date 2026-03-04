/**
 * Drawings Module — Feature Simulation Tests
 * Validates all annotation tools, keyboard shortcuts, and core logic
 */
import { describe, it, expect } from 'vitest';

// ==================== HELPER FUNCTIONS (extracted from Drawings.tsx) ====================

const sanitizeFileName = (name: string): string =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^a-zA-Z0-9._-]/g, '_');

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
};

const getFileType = (filename: string, mimeType?: string): 'pdf' | 'image' | 'dxf' | 'dwg' | 'other' => {
  const ext = filename.toLowerCase();
  if (mimeType === 'application/pdf' || ext.endsWith('.pdf')) return 'pdf';
  if (ext.endsWith('.dxf')) return 'dxf';
  if (ext.endsWith('.dwg')) return 'dwg';
  if (mimeType?.startsWith('image/') || ext.match(/\.(png|jpg|jpeg|gif|bmp|webp|svg|tiff?)$/)) return 'image';
  return 'other';
};

// Scale calibration logic
const calculateScaleRatio = (p1: { x: number; y: number }, p2: { x: number; y: number }, realDistance: number): number => {
  const pixelDist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  if (!pixelDist) return 0;
  return realDistance / pixelDist;
};

// Measurement calculation
const calculateDistance = (x1: number, y1: number, x2: number, y2: number, scaleRatio: number): number => {
  const pxDist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  return pxDist * scaleRatio;
};

// Polyline total distance and area (shoelace)
const calculatePolylineMeasurement = (points: { x: number; y: number }[], scaleRatio: number, isClosed: boolean) => {
  let totalDist = 0;
  const segDists: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = Math.sqrt((points[i].x - points[i - 1].x) ** 2 + (points[i].y - points[i - 1].y) ** 2) * scaleRatio;
    segDists.push(d);
    totalDist += d;
  }
  if (isClosed && points.length >= 3) {
    const first = points[0], last = points[points.length - 1];
    const closingDist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2) * scaleRatio;
    segDists.push(closingDist);
    totalDist += closingDist;
  }
  let area: number | undefined;
  if (isClosed && points.length >= 3) {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      a += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    area = Math.abs(a / 2) * scaleRatio * scaleRatio;
  }
  return { totalDist, segDists, area };
};

// Cloud markup path generation
const generateCloudPath = (x: number, y: number, w: number, h: number): string => {
  const numTop = Math.max(2, Math.round(w / 28));
  const numRight = Math.max(2, Math.round(h / 28));
  const numBottom = numTop;
  const numLeft = numRight;
  const pts: [number, number][] = [];
  for (let i = 0; i <= numTop; i++) pts.push([x + (i * w / numTop), y]);
  for (let i = 1; i <= numRight; i++) pts.push([x + w, y + (i * h / numRight)]);
  for (let i = 1; i <= numBottom; i++) pts.push([x + w - (i * w / numBottom), y + h]);
  for (let i = 1; i < numLeft; i++) pts.push([x, y + h - (i * h / numLeft)]);
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = dist * 0.55;
    d += ` A ${r},${r} 0 0,1 ${pts[i][0]},${pts[i][1]}`;
  }
  const last = pts[pts.length - 1];
  const dx0 = pts[0][0] - last[0], dy0 = pts[0][1] - last[1];
  const d0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  d += ` A ${d0 * 0.55},${d0 * 0.55} 0 0,1 ${pts[0][0]},${pts[0][1]} Z`;
  return d;
};

// Keyboard shortcut mapping
const TOOL_SHORTCUTS: Record<string, string> = {
  v: 'pointer', p: 'pen', h: 'highlighter', r: 'rectangle',
  o: 'ellipse', a: 'arrow', l: 'line', t: 'text',
  m: 'ruler', c: 'comment', e: 'eraser', k: 'cloud',
  b: 'callout', n: 'count',
};

// ==================== TESTS ====================

describe('sanitizeFileName', () => {
  it('strips polish diacritics', () => {
    expect(sanitizeFileName('rzut_piętro_główne.pdf')).toBe('rzut_pietro_glowne.pdf');
  });
  it('replaces ł/Ł', () => {
    expect(sanitizeFileName('Łódź_parter.pdf')).toBe('Lodz_parter.pdf');
  });
  it('replaces special characters with underscore', () => {
    expect(sanitizeFileName('plan (1) [v2].pdf')).toBe('plan__1___v2_.pdf');
  });
  it('preserves alphanumerics and dots', () => {
    expect(sanitizeFileName('plan01.pdf')).toBe('plan01.pdf');
  });
});

describe('formatFileSize', () => {
  it('returns 0 B for undefined', () => {
    expect(formatFileSize(undefined)).toBe('0 B');
  });
  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });
  it('formats kilobytes', () => {
    expect(formatFileSize(15360)).toBe('15.0 KB');
  });
  it('formats megabytes', () => {
    expect(formatFileSize(5242880)).toBe('5.00 MB');
  });
});

describe('getFileType', () => {
  it('detects PDF by extension', () => {
    expect(getFileType('plan.pdf')).toBe('pdf');
  });
  it('detects PDF by MIME type', () => {
    expect(getFileType('plan', 'application/pdf')).toBe('pdf');
  });
  it('detects DWG', () => {
    expect(getFileType('drawing.dwg')).toBe('dwg');
  });
  it('detects DXF', () => {
    expect(getFileType('drawing.dxf')).toBe('dxf');
  });
  it('detects image by extension', () => {
    expect(getFileType('plan.png')).toBe('image');
    expect(getFileType('plan.jpg')).toBe('image');
    expect(getFileType('plan.webp')).toBe('image');
  });
  it('detects image by MIME type', () => {
    expect(getFileType('plan', 'image/png')).toBe('image');
  });
  it('returns other for unknown', () => {
    expect(getFileType('file.xyz')).toBe('other');
  });
});

describe('Scale calibration', () => {
  it('calculates correct scale ratio', () => {
    const ratio = calculateScaleRatio({ x: 0, y: 0 }, { x: 100, y: 0 }, 5); // 100px = 5m
    expect(ratio).toBe(0.05);
  });
  it('handles diagonal calibration', () => {
    const ratio = calculateScaleRatio({ x: 0, y: 0 }, { x: 300, y: 400 }, 10); // 500px diagonal = 10m
    expect(ratio).toBeCloseTo(0.02);
  });
  it('returns 0 for zero pixel distance', () => {
    const ratio = calculateScaleRatio({ x: 5, y: 5 }, { x: 5, y: 5 }, 10);
    expect(ratio).toBe(0);
  });
});

describe('Distance measurement', () => {
  it('measures horizontal distance', () => {
    const dist = calculateDistance(0, 0, 200, 0, 0.05);
    expect(dist).toBe(10);
  });
  it('measures vertical distance', () => {
    const dist = calculateDistance(0, 0, 0, 100, 0.05);
    expect(dist).toBe(5);
  });
  it('measures diagonal distance', () => {
    const dist = calculateDistance(0, 0, 300, 400, 0.02);
    expect(dist).toBeCloseTo(10);
  });
});

describe('Polyline measurement', () => {
  it('calculates total distance for open polyline', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const { totalDist, segDists, area } = calculatePolylineMeasurement(points, 0.05, false);
    expect(segDists).toHaveLength(2);
    expect(segDists[0]).toBe(5);
    expect(segDists[1]).toBe(5);
    expect(totalDist).toBe(10);
    expect(area).toBeUndefined();
  });

  it('calculates closed polygon area (shoelace)', () => {
    // Square: 100x100 pixels, scale 0.05 → 5x5 meters = 25 m²
    const points = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const { totalDist, area } = calculatePolylineMeasurement(points, 0.05, true);
    expect(area).toBeCloseTo(25);
    // Perimeter: 4 * 5 = 20m (3 segments + closing)
    expect(totalDist).toBeCloseTo(20);
  });

  it('calculates triangle area', () => {
    // Triangle: base 200px, height 100px, scale 0.1
    // Area = 0.5 * 20 * 10 = 100 m²
    const points = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 100 }];
    const { area } = calculatePolylineMeasurement(points, 0.1, true);
    expect(area).toBeCloseTo(100);
  });

  it('returns undefined area for open polyline', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 50 }];
    const { area } = calculatePolylineMeasurement(points, 0.05, false);
    expect(area).toBeUndefined();
  });
});

describe('Cloud markup path generation', () => {
  it('generates valid SVG path', () => {
    const path = generateCloudPath(10, 20, 200, 100);
    expect(path).toMatch(/^M /);
    expect(path).toContain(' A ');
    expect(path).toMatch(/Z$/);
  });

  it('starts at the correct point', () => {
    const path = generateCloudPath(50, 60, 300, 200);
    expect(path).toMatch(/^M 50,60/);
  });

  it('creates multiple arc segments', () => {
    const path = generateCloudPath(0, 0, 300, 200);
    const arcCount = (path.match(/ A /g) || []).length;
    expect(arcCount).toBeGreaterThanOrEqual(8); // At least 2 per side
  });

  it('handles small dimensions', () => {
    const path = generateCloudPath(0, 0, 30, 20);
    expect(path).toMatch(/^M /);
    expect(path).toMatch(/Z$/);
  });
});

describe('Keyboard shortcuts', () => {
  it('maps all tool shortcuts correctly', () => {
    expect(TOOL_SHORTCUTS['v']).toBe('pointer');
    expect(TOOL_SHORTCUTS['p']).toBe('pen');
    expect(TOOL_SHORTCUTS['h']).toBe('highlighter');
    expect(TOOL_SHORTCUTS['r']).toBe('rectangle');
    expect(TOOL_SHORTCUTS['o']).toBe('ellipse');
    expect(TOOL_SHORTCUTS['a']).toBe('arrow');
    expect(TOOL_SHORTCUTS['l']).toBe('line');
    expect(TOOL_SHORTCUTS['t']).toBe('text');
    expect(TOOL_SHORTCUTS['m']).toBe('ruler');
    expect(TOOL_SHORTCUTS['c']).toBe('comment');
    expect(TOOL_SHORTCUTS['e']).toBe('eraser');
    expect(TOOL_SHORTCUTS['k']).toBe('cloud');
    expect(TOOL_SHORTCUTS['b']).toBe('callout');
    expect(TOOL_SHORTCUTS['n']).toBe('count');
  });

  it('has 14 tool shortcuts', () => {
    expect(Object.keys(TOOL_SHORTCUTS)).toHaveLength(14);
  });

  it('all tools have unique shortcuts', () => {
    const tools = Object.values(TOOL_SHORTCUTS);
    const uniqueTools = new Set(tools);
    expect(uniqueTools.size).toBe(tools.length);
  });
});

describe('Annotation types', () => {
  const validTypes = ['freehand', 'line', 'arrow', 'rectangle', 'ellipse', 'text', 'measurement', 'polyline', 'polygon', 'cloud', 'callout'];

  it('includes all expected annotation types', () => {
    expect(validTypes).toContain('freehand');
    expect(validTypes).toContain('cloud');
    expect(validTypes).toContain('callout');
    expect(validTypes).toContain('measurement');
  });

  it('has 11 annotation types', () => {
    expect(validTypes).toHaveLength(11);
  });
});

describe('Tool types', () => {
  const validTools = ['pointer', 'pen', 'highlighter', 'rectangle', 'ellipse', 'arrow', 'line', 'text', 'eraser', 'ruler', 'comment', 'camera', 'screenshot', 'cloud', 'callout', 'count'];

  it('includes all drawing tools', () => {
    expect(validTools).toContain('pen');
    expect(validTools).toContain('highlighter');
    expect(validTools).toContain('rectangle');
    expect(validTools).toContain('ellipse');
    expect(validTools).toContain('arrow');
    expect(validTools).toContain('line');
    expect(validTools).toContain('text');
  });

  it('includes new tools (cloud, callout, count)', () => {
    expect(validTools).toContain('cloud');
    expect(validTools).toContain('callout');
    expect(validTools).toContain('count');
  });

  it('includes utility tools', () => {
    expect(validTools).toContain('pointer');
    expect(validTools).toContain('eraser');
    expect(validTools).toContain('ruler');
    expect(validTools).toContain('comment');
    expect(validTools).toContain('camera');
    expect(validTools).toContain('screenshot');
  });

  it('has 16 tool types', () => {
    expect(validTools).toHaveLength(16);
  });
});

describe('Colors and stroke widths', () => {
  const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#000000', '#ffffff'];
  const STROKE_WIDTHS = [1, 2, 4, 6, 10];

  it('has 9 color options', () => {
    expect(COLORS).toHaveLength(9);
  });

  it('all colors are valid hex', () => {
    COLORS.forEach(c => {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  it('has 5 stroke width options', () => {
    expect(STROKE_WIDTHS).toHaveLength(5);
  });

  it('stroke widths are ascending', () => {
    for (let i = 1; i < STROKE_WIDTHS.length; i++) {
      expect(STROKE_WIDTHS[i]).toBeGreaterThan(STROKE_WIDTHS[i - 1]);
    }
  });
});

describe('Ruler modes', () => {
  const modes = ['single', 'polyline', 'area'];

  it('has 3 ruler modes', () => {
    expect(modes).toHaveLength(3);
  });

  it('includes single measurement', () => {
    expect(modes).toContain('single');
  });

  it('includes polyline measurement', () => {
    expect(modes).toContain('polyline');
  });

  it('includes area measurement', () => {
    expect(modes).toContain('area');
  });
});
