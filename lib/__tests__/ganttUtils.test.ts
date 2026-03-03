/**
 * Comprehensive tests for Gantt / Harmonogram Business Logic
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  buildTaskTree,
  assignWbs,
  flattenTasks,
  flattenAll,
  getDaysBetween,
  isWorkingDay,
  getNextWorkingDay,
  addWorkingDays,
  countWorkingDays,
  workingDaysFromMask,
  maskFromWorkingDays,
  formatDuration,
  formatDatePL,
  calcParentStartDate,
  calcParentEndDate,
  calcParentDuration,
  calcParentProgress,
  recalcParents,
  hasCircularDependency,
  validateDependency,
  validatePhaseForm,
  findCriticalPath,
  autoSchedule,
  GanttTaskNode,
  GanttDepRecord,
} from '../ganttUtils';

// =====================================================
// HELPERS: create test tasks and deps
// =====================================================
function makeTask(overrides: Partial<GanttTaskNode> & { id: string }): GanttTaskNode {
  return {
    title: 'Task',
    parent_id: null,
    start_date: null,
    end_date: null,
    duration: null,
    progress: 0,
    has_custom_progress: false,
    is_auto: true,
    is_milestone: false,
    sort_order: 0,
    ...overrides,
  };
}

function makeDep(overrides: Partial<GanttDepRecord> & { id: string; predecessor_id: string; successor_id: string }): GanttDepRecord {
  return {
    dependency_type: 'FS',
    lag: 0,
    ...overrides,
  };
}

const MON_FRI: boolean[] = [true, true, true, true, true, false, false]; // Mon-Fri
const ALL_DAYS: boolean[] = [true, true, true, true, true, true, true];

// =====================================================
// buildTaskTree
// =====================================================
describe('buildTaskTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildTaskTree([])).toEqual([]);
  });

  it('builds flat list (no parents)', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'A', sort_order: 0 }),
      makeTask({ id: 'b', title: 'B', sort_order: 1 }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree).toHaveLength(2);
    expect(tree[0].wbs).toBe('1');
    expect(tree[1].wbs).toBe('2');
  });

  it('builds parent-child hierarchy', () => {
    const tasks = [
      makeTask({ id: 'p1', title: 'Parent', sort_order: 0 }),
      makeTask({ id: 'c1', title: 'Child 1', parent_id: 'p1', sort_order: 1 }),
      makeTask({ id: 'c2', title: 'Child 2', parent_id: 'p1', sort_order: 2 }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].wbs).toBe('1');
    expect(tree[0].children![0].wbs).toBe('1.1');
    expect(tree[0].children![1].wbs).toBe('1.2');
  });

  it('assigns correct levels for deep nesting', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'L0' }),
      makeTask({ id: 'b', title: 'L1', parent_id: 'a' }),
      makeTask({ id: 'c', title: 'L2', parent_id: 'b' }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree[0].level).toBe(0);
    expect(tree[0].children![0].level).toBe(1);
    expect(tree[0].children![0].children![0].level).toBe(2);
  });
});

// =====================================================
// flattenTasks & flattenAll
// =====================================================
describe('flattenTasks', () => {
  it('flattens expanded tree', () => {
    const tree = buildTaskTree([
      makeTask({ id: 'a', title: 'A' }),
      makeTask({ id: 'b', title: 'B', parent_id: 'a' }),
      makeTask({ id: 'c', title: 'C' }),
    ]);
    const flat = flattenTasks(tree);
    expect(flat).toHaveLength(3);
    expect(flat.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips collapsed children', () => {
    const tree = buildTaskTree([
      makeTask({ id: 'a', title: 'A' }),
      makeTask({ id: 'b', title: 'B', parent_id: 'a' }),
    ]);
    tree[0].isExpanded = false;
    const flat = flattenTasks(tree);
    expect(flat).toHaveLength(1);
    expect(flat[0].id).toBe('a');
  });

  it('applies filter function', () => {
    const tree = buildTaskTree([
      makeTask({ id: 'a', title: 'A', progress: 100 }),
      makeTask({ id: 'b', title: 'B', progress: 50 }),
    ]);
    const flat = flattenTasks(tree, [], (t) => t.progress < 100);
    expect(flat).toHaveLength(1);
    expect(flat[0].id).toBe('b');
  });
});

describe('flattenAll', () => {
  it('flattens all regardless of expansion state', () => {
    const tree = buildTaskTree([
      makeTask({ id: 'a', title: 'A' }),
      makeTask({ id: 'b', title: 'B', parent_id: 'a' }),
    ]);
    tree[0].isExpanded = false;
    const flat = flattenAll(tree);
    expect(flat).toHaveLength(2);
  });
});

// =====================================================
// DATE CALCULATIONS
// =====================================================
describe('getDaysBetween', () => {
  it('returns 0 for same date', () => {
    const d = new Date('2026-03-01');
    expect(getDaysBetween(d, d)).toBe(0);
  });

  it('returns correct days', () => {
    expect(getDaysBetween(new Date('2026-03-01'), new Date('2026-03-08'))).toBe(7);
  });

  it('handles negative (end before start)', () => {
    expect(getDaysBetween(new Date('2026-03-08'), new Date('2026-03-01'))).toBe(-7);
  });
});

describe('isWorkingDay', () => {
  it('Monday is working day in Mon-Fri', () => {
    expect(isWorkingDay(new Date('2026-03-02'), MON_FRI)).toBe(true); // Monday
  });

  it('Saturday is not working day in Mon-Fri', () => {
    expect(isWorkingDay(new Date('2026-03-07'), MON_FRI)).toBe(false); // Saturday
  });

  it('Sunday is not working day in Mon-Fri', () => {
    expect(isWorkingDay(new Date('2026-03-08'), MON_FRI)).toBe(false); // Sunday
  });
});

describe('getNextWorkingDay', () => {
  it('returns same day if already working day', () => {
    const monday = new Date('2026-03-02');
    const result = getNextWorkingDay(monday, MON_FRI);
    expect(result.toISOString().split('T')[0]).toBe('2026-03-02');
  });

  it('skips weekend to next Monday', () => {
    const saturday = new Date('2026-03-07');
    const result = getNextWorkingDay(saturday, MON_FRI);
    expect(result.toISOString().split('T')[0]).toBe('2026-03-09'); // Monday
  });
});

describe('addWorkingDays', () => {
  it('returns same date for 0 days', () => {
    const d = new Date('2026-03-02');
    const result = addWorkingDays(d, 0, MON_FRI);
    expect(result.toISOString().split('T')[0]).toBe('2026-03-02');
  });

  it('adds 5 working days (skips weekend)', () => {
    const monday = new Date('2026-03-02'); // Monday
    const result = addWorkingDays(monday, 5, MON_FRI);
    expect(result.toISOString().split('T')[0]).toBe('2026-03-09'); // Next Monday
  });

  it('adds 1 working day', () => {
    const monday = new Date('2026-03-02');
    const result = addWorkingDays(monday, 1, MON_FRI);
    expect(result.toISOString().split('T')[0]).toBe('2026-03-03'); // Tuesday
  });

  it('adds working days skipping Friday->Monday', () => {
    const friday = new Date('2026-03-06'); // Friday
    const result = addWorkingDays(friday, 1, MON_FRI);
    expect(result.toISOString().split('T')[0]).toBe('2026-03-09'); // Monday
  });
});

describe('countWorkingDays', () => {
  it('counts Mon-Fri in a full week', () => {
    const result = countWorkingDays(new Date('2026-03-02'), new Date('2026-03-08'), MON_FRI);
    expect(result).toBe(5); // Mon-Fri
  });

  it('returns 7 for full week with all days working', () => {
    const result = countWorkingDays(new Date('2026-03-02'), new Date('2026-03-08'), ALL_DAYS);
    expect(result).toBe(7);
  });
});

// =====================================================
// WORKING DAYS MASK
// =====================================================
describe('workingDaysFromMask / maskFromWorkingDays', () => {
  it('Mon-Fri mask = 31', () => {
    const days = workingDaysFromMask(31); // bits 0-4
    expect(days).toEqual([true, true, true, true, true, false, false]);
  });

  it('round-trips correctly', () => {
    const original = [true, false, true, false, true, false, true];
    const mask = maskFromWorkingDays(original);
    const restored = workingDaysFromMask(mask);
    expect(restored).toEqual(original);
  });

  it('all days = 127', () => {
    expect(maskFromWorkingDays(ALL_DAYS)).toBe(127);
  });
});

// =====================================================
// FORMAT DURATION
// =====================================================
describe('formatDuration', () => {
  it('returns dash for 0', () => {
    expect(formatDuration(0)).toBe('–');
  });

  it('formats days only', () => {
    expect(formatDuration(3)).toBe('3 Dni');
  });

  it('formats weeks', () => {
    expect(formatDuration(14)).toBe('14 Dni (2. tydz.)');
  });

  it('formats weeks + days', () => {
    expect(formatDuration(10)).toBe('10 Dni (1. tydz. 3. d.)');
  });
});

// =====================================================
// PARENT AUTO-CALCULATIONS
// =====================================================
describe('calcParentStartDate', () => {
  it('returns null for empty children', () => {
    expect(calcParentStartDate([])).toBeNull();
  });

  it('returns earliest child start', () => {
    const children = [
      makeTask({ id: 'a', start_date: '2026-03-05' }),
      makeTask({ id: 'b', start_date: '2026-03-01' }),
      makeTask({ id: 'c', start_date: '2026-03-10' }),
    ];
    expect(calcParentStartDate(children)).toBe('2026-03-01');
  });
});

describe('calcParentEndDate', () => {
  it('returns latest child end', () => {
    const children = [
      makeTask({ id: 'a', end_date: '2026-03-05' }),
      makeTask({ id: 'b', end_date: '2026-03-15' }),
      makeTask({ id: 'c', end_date: '2026-03-10' }),
    ];
    expect(calcParentEndDate(children)).toBe('2026-03-15');
  });
});

describe('calcParentProgress', () => {
  it('returns 0 for no children', () => {
    expect(calcParentProgress([])).toBe(0);
  });

  it('calculates equal weight average', () => {
    const children = [
      makeTask({ id: 'a', progress: 100 }),
      makeTask({ id: 'b', progress: 0 }),
    ];
    expect(calcParentProgress(children)).toBe(50);
  });

  it('calculates duration-weighted average', () => {
    const children = [
      makeTask({ id: 'a', progress: 100, duration: 10 }),
      makeTask({ id: 'b', progress: 0, duration: 10 }),
    ];
    expect(calcParentProgress(children)).toBe(50);
  });

  it('weights by duration correctly', () => {
    const children = [
      makeTask({ id: 'a', progress: 100, duration: 3 }),
      makeTask({ id: 'b', progress: 0, duration: 1 }),
    ];
    expect(calcParentProgress(children)).toBe(75); // (100*3 + 0*1) / 4
  });
});

describe('recalcParents', () => {
  it('recalculates parent dates and progress from children', () => {
    const tree: GanttTaskNode[] = [{
      id: 'p', title: 'Parent', parent_id: null, is_auto: true, has_custom_progress: false,
      start_date: null, end_date: null, duration: null, progress: 0, is_milestone: false, sort_order: 0,
      children: [
        makeTask({ id: 'c1', start_date: '2026-03-01', end_date: '2026-03-05', duration: 4, progress: 50, sort_order: 0 }),
        makeTask({ id: 'c2', start_date: '2026-03-10', end_date: '2026-03-15', duration: 5, progress: 100, sort_order: 1 }),
      ],
    }];
    const result = recalcParents(tree);
    expect(result[0].start_date).toBe('2026-03-01');
    expect(result[0].end_date).toBe('2026-03-15');
    // Progress: (50*4 + 100*5) / 9 = 700/9 ≈ 78
    expect(result[0].progress).toBe(78);
  });

  it('preserves custom progress', () => {
    const tree: GanttTaskNode[] = [{
      id: 'p', title: 'Parent', parent_id: null, is_auto: true, has_custom_progress: true,
      start_date: null, end_date: null, duration: null, progress: 42, is_milestone: false, sort_order: 0,
      children: [
        makeTask({ id: 'c1', progress: 100, sort_order: 0 }),
      ],
    }];
    const result = recalcParents(tree);
    expect(result[0].progress).toBe(42); // Custom, not recalculated
  });
});

// =====================================================
// DEPENDENCY VALIDATION
// =====================================================
describe('hasCircularDependency', () => {
  it('returns false for no cycle', () => {
    const deps = [
      makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' }),
    ];
    expect(hasCircularDependency(deps, 'b', 'c')).toBe(false);
  });

  it('detects direct cycle', () => {
    const deps = [
      makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' }),
    ];
    // Adding b -> a would create cycle: a -> b -> a
    expect(hasCircularDependency(deps, 'b', 'a')).toBe(true);
  });

  it('detects indirect cycle', () => {
    const deps = [
      makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' }),
      makeDep({ id: 'd2', predecessor_id: 'b', successor_id: 'c' }),
    ];
    // Adding c -> a would create: a -> b -> c -> a
    expect(hasCircularDependency(deps, 'c', 'a')).toBe(true);
  });

  it('returns false for unrelated tasks', () => {
    const deps = [
      makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' }),
    ];
    expect(hasCircularDependency(deps, 'c', 'd')).toBe(false);
  });
});

describe('validateDependency', () => {
  it('rejects self-dependency', () => {
    const result = validateDependency([], 'a', 'a');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('siebie');
  });

  it('rejects duplicate', () => {
    const deps = [makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' })];
    const result = validateDependency(deps, 'a', 'b');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('istnieje');
  });

  it('allows duplicate when editing same dep', () => {
    const deps = [makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' })];
    const result = validateDependency(deps, 'a', 'b', 'd1');
    expect(result.valid).toBe(true);
  });

  it('rejects circular dependency', () => {
    const deps = [makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' })];
    const result = validateDependency(deps, 'b', 'a');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('cykl');
  });

  it('accepts valid new dependency', () => {
    const deps = [makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' })];
    const result = validateDependency(deps, 'b', 'c');
    expect(result.valid).toBe(true);
  });

  it('rejects empty predecessor', () => {
    const result = validateDependency([], '', 'b');
    expect(result.valid).toBe(false);
  });
});

// =====================================================
// VALIDATE PHASE FORM
// =====================================================
describe('validatePhaseForm', () => {
  it('rejects empty title', () => {
    const result = validatePhaseForm(
      { title: '', parent_id: '', duration: 5, start_date: '2026-03-01', end_date: '2026-03-05' },
      8, 0
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Nazwa jest wymagana.');
  });

  it('rejects exceeding max level', () => {
    const result = validatePhaseForm(
      { title: 'Test', parent_id: 'some-id', duration: 5, start_date: '2026-03-01', end_date: '2026-03-05' },
      8, 8
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('limit');
  });

  it('rejects end before start', () => {
    const result = validatePhaseForm(
      { title: 'Test', parent_id: '', duration: 5, start_date: '2026-03-10', end_date: '2026-03-01' },
      8, 0
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('wcześniejsza');
  });

  it('accepts valid form', () => {
    const result = validatePhaseForm(
      { title: 'Fundamenty', parent_id: '', duration: 42, start_date: '2026-04-06', end_date: '2026-06-02' },
      8, 0
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// =====================================================
// CRITICAL PATH
// =====================================================
describe('findCriticalPath', () => {
  it('returns empty for no tasks', () => {
    expect(findCriticalPath([], []).size).toBe(0);
  });

  it('finds longest path through dependencies', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'A', duration: 5 }),
      makeTask({ id: 'b', title: 'B', duration: 10 }),
      makeTask({ id: 'c', title: 'C', duration: 3 }),
    ];
    const tree = buildTaskTree(tasks);
    const deps = [
      makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' }),
      makeDep({ id: 'd2', predecessor_id: 'a', successor_id: 'c' }),
    ];
    const critical = findCriticalPath(tree, deps);
    // A(5) -> B(10) = 15 is longer than A(5) -> C(3) = 8
    expect(critical.has('a')).toBe(true);
    expect(critical.has('b')).toBe(true);
    expect(critical.has('c')).toBe(false);
  });
});

// =====================================================
// AUTO-SCHEDULE
// =====================================================
describe('autoSchedule', () => {
  it('schedules tasks with FS dependency', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'A', duration: 3, start_date: '2026-03-02' }),
      makeTask({ id: 'b', title: 'B', duration: 2 }),
    ];
    const tree = buildTaskTree(tasks);
    const deps = [makeDep({ id: 'd1', predecessor_id: 'a', successor_id: 'b' })];

    const result = autoSchedule(tree, deps, MON_FRI, '2026-03-02');
    expect(result.get('a')?.start_date).toBe('2026-03-02');
    expect(result.has('b')).toBe(true);
    // Task A: starts Mar 2 (Mon), 3 working days -> ends Mar 4 (Wed)
    // Task B: starts Mar 5 (Thu), 2 working days -> ends Mar 6 (Fri)
    expect(result.get('b')?.start_date).toBe('2026-03-05');
  });

  it('handles tasks with no dependencies', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'A', duration: 5, start_date: '2026-03-02' }),
    ];
    const tree = buildTaskTree(tasks);
    const result = autoSchedule(tree, [], MON_FRI, '2026-03-02');
    expect(result.get('a')?.start_date).toBe('2026-03-02');
  });
});

// =====================================================
// formatDatePL
// =====================================================
describe('formatDatePL', () => {
  it('returns dash for null', () => {
    expect(formatDatePL(null)).toBe('–');
  });

  it('returns dash for undefined', () => {
    expect(formatDatePL(undefined)).toBe('–');
  });

  it('formats date in Polish locale', () => {
    const result = formatDatePL('2026-03-02');
    // Should contain day and month in Polish format
    expect(result).toBeTruthy();
    expect(result).not.toBe('–');
  });
});

// =====================================================
// Additional edge case tests
// =====================================================
describe('autoSchedule — complex dependency chains', () => {
  const MON_FRI = [true, true, true, true, true, false, false];

  it('schedules chain A->B->C correctly with FS', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'A', duration: 3, start_date: '2026-03-02' }),
      makeTask({ id: 'b', title: 'B', duration: 2 }),
      makeTask({ id: 'c', title: 'C', duration: 1 }),
    ];
    const deps: GanttDepRecord[] = [
      { id: 'd1', predecessor_id: 'a', successor_id: 'b', dependency_type: 'FS', lag: 0 },
      { id: 'd2', predecessor_id: 'b', successor_id: 'c', dependency_type: 'FS', lag: 0 },
    ];
    const tree = buildTaskTree(tasks);
    const result = autoSchedule(tree, deps, MON_FRI, '2026-03-02');
    // A: Mon 2 Mar -> Wed 4 Mar
    expect(result.get('a')?.start_date).toBe('2026-03-02');
    // B: Thu 5 Mar -> Fri 6 Mar
    expect(result.get('b')?.start_date).toBe('2026-03-05');
    // C: Mon 9 Mar (skip weekend)
    expect(result.get('c')?.start_date).toBe('2026-03-09');
  });

  it('schedules with SS dependency', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'A', duration: 5, start_date: '2026-03-02' }),
      makeTask({ id: 'b', title: 'B', duration: 2 }),
    ];
    const deps: GanttDepRecord[] = [
      { id: 'd1', predecessor_id: 'a', successor_id: 'b', dependency_type: 'SS', lag: 0 },
    ];
    const tree = buildTaskTree(tasks);
    const result = autoSchedule(tree, deps, MON_FRI, '2026-03-02');
    // SS: B starts when A starts
    expect(result.get('b')?.start_date).toBe('2026-03-02');
  });

  it('handles lag days in dependency', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'A', duration: 1, start_date: '2026-03-02' }),
      makeTask({ id: 'b', title: 'B', duration: 1 }),
    ];
    const deps: GanttDepRecord[] = [
      { id: 'd1', predecessor_id: 'a', successor_id: 'b', dependency_type: 'FS', lag: 2 },
    ];
    const tree = buildTaskTree(tasks);
    const result = autoSchedule(tree, deps, MON_FRI, '2026-03-02');
    // A ends 2 Mar, then +1 day = 3 Mar, then +2 lag working days = 5 Mar
    expect(result.get('b')?.start_date).toBe('2026-03-05');
  });
});

describe('validateDependency — edge cases', () => {
  it('allows valid dependency', () => {
    const deps: GanttDepRecord[] = [];
    const result = validateDependency(deps, 'a', 'b');
    expect(result.valid).toBe(true);
  });

  it('rejects empty predecessor', () => {
    const result = validateDependency([], '', 'b');
    expect(result.valid).toBe(false);
  });

  it('rejects empty successor', () => {
    const result = validateDependency([], 'a', '');
    expect(result.valid).toBe(false);
  });

  it('detects three-node cycle', () => {
    const deps: GanttDepRecord[] = [
      { id: 'd1', predecessor_id: 'a', successor_id: 'b', dependency_type: 'FS', lag: 0 },
      { id: 'd2', predecessor_id: 'b', successor_id: 'c', dependency_type: 'FS', lag: 0 },
    ];
    // Adding c->a would complete the cycle
    const result = validateDependency(deps, 'c', 'a');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('cykl');
  });
});

describe('recalcParents — nested hierarchy', () => {
  it('recalculates multi-level parent chain', () => {
    const tasks = [
      makeTask({ id: 'root', title: 'Root', is_auto: true }),
      makeTask({ id: 'mid', title: 'Mid', parent_id: 'root', is_auto: true }),
      makeTask({ id: 'leaf1', title: 'Leaf1', parent_id: 'mid', start_date: '2026-03-02', end_date: '2026-03-05', duration: 3, progress: 50 }),
      makeTask({ id: 'leaf2', title: 'Leaf2', parent_id: 'mid', start_date: '2026-03-10', end_date: '2026-03-15', duration: 5, progress: 80 }),
    ];
    const tree = buildTaskTree(tasks);
    const result = recalcParents(tree);
    // Mid should have start=03-02, end=03-15
    const mid = result[0].children![0];
    expect(mid.start_date).toBe('2026-03-02');
    expect(mid.end_date).toBe('2026-03-15');
    // Root should inherit same dates
    expect(result[0].start_date).toBe('2026-03-02');
    expect(result[0].end_date).toBe('2026-03-15');
  });
});

describe('workingDaysFromMask / maskFromWorkingDays roundtrip', () => {
  it('handles all days working', () => {
    const allDays = [true, true, true, true, true, true, true];
    const mask = maskFromWorkingDays(allDays);
    const result = workingDaysFromMask(mask);
    expect(result).toEqual(allDays);
  });

  it('handles no days working', () => {
    const noDays = [false, false, false, false, false, false, false];
    const mask = maskFromWorkingDays(noDays);
    expect(mask).toBe(0);
    const result = workingDaysFromMask(mask);
    expect(result).toEqual(noDays);
  });
});
