/**
 * Gantt / Harmonogram Business Logic Utilities
 * Pure functions for date calculations, tree operations, scheduling, validation
 */

import { GanttDependencyType } from '../types';

// =====================================================
// TYPES
// =====================================================

export interface GanttTaskNode {
  id: string;
  title?: string;
  parent_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration?: number | null;
  progress: number;
  has_custom_progress: boolean;
  is_auto: boolean;
  is_milestone: boolean;
  sort_order: number;
  children?: GanttTaskNode[];
  isExpanded?: boolean;
  level?: number;
  wbs?: string;
}

export interface GanttDepRecord {
  id: string;
  predecessor_id: string;
  successor_id: string;
  dependency_type: GanttDependencyType;
  lag: number;
}

// =====================================================
// TREE BUILDING & WBS
// =====================================================

export function buildTaskTree<T extends GanttTaskNode>(tasksData: T[]): T[] {
  if (!tasksData || tasksData.length === 0) return [];
  const taskMap = new Map<string, T & { children: T[]; level: number; isExpanded: boolean }>();
  tasksData.forEach(task => {
    taskMap.set(task.id, { ...task, children: [], level: 0, isExpanded: true } as any);
  });
  tasksData.forEach(task => {
    if (task.parent_id && taskMap.has(task.parent_id)) {
      const parent = taskMap.get(task.parent_id)!;
      const child = taskMap.get(task.id)!;
      child.level = parent.level + 1;
      parent.children.push(child as any);
    }
  });
  const roots = tasksData.filter(t => !t.parent_id).map(t => taskMap.get(t.id)!);
  assignWbs(roots, '');
  return roots as T[];
}

export function assignWbs<T extends GanttTaskNode>(items: T[], prefix: string): void {
  items.forEach((item, i) => {
    item.wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    if (item.children && item.children.length > 0) {
      assignWbs(item.children as T[], item.wbs);
    }
  });
}

export function flattenTasks<T extends GanttTaskNode>(
  items: T[],
  result: T[] = [],
  filterFn?: (task: T) => boolean
): T[] {
  items.forEach(task => {
    if (filterFn && !filterFn(task)) return;
    result.push(task);
    if (task.isExpanded && task.children && task.children.length > 0) {
      flattenTasks(task.children as T[], result, filterFn);
    }
  });
  return result;
}

export function flattenAll<T extends GanttTaskNode>(items: T[], result: T[] = []): T[] {
  items.forEach(t => {
    result.push(t);
    if (t.children?.length) flattenAll(t.children as T[], result);
  });
  return result;
}

// =====================================================
// DATE & WORKING DAY CALCULATIONS
// =====================================================

export function getDaysBetween(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / 86400000);
}

export function isWorkingDay(date: Date, workingDays: boolean[]): boolean {
  const dow = date.getDay(); // 0=Sun, 1=Mon...6=Sat
  const arrIdx = dow === 0 ? 6 : dow - 1; // convert to Mon=0..Sun=6
  return workingDays[arrIdx];
}

export function getNextWorkingDay(date: Date, workingDays: boolean[]): Date {
  const d = new Date(date);
  for (let i = 0; i < 365; i++) {
    if (isWorkingDay(d, workingDays)) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

export function addWorkingDays(start: Date, days: number, workingDays: boolean[]): Date {
  if (days <= 0) return new Date(start);
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, workingDays)) added++;
  }
  return d;
}

export function countWorkingDays(start: Date, end: Date, workingDays: boolean[]): number {
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    if (isWorkingDay(d, workingDays)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function workingDaysFromMask(mask: number): boolean[] {
  // Bit positions: bit 0 = Mon, bit 1 = Tue, ... bit 6 = Sun
  // (matches DB: Mon=bit0, Tue=bit1, etc.)
  return Array.from({ length: 7 }, (_, i) => !!(mask & (1 << i)));
}

export function maskFromWorkingDays(days: boolean[]): number {
  return days.reduce((acc, v, i) => acc | (v ? (1 << i) : 0), 0);
}

// =====================================================
// DURATION FORMATTING
// =====================================================

export function formatDuration(days: number): string {
  if (!days || days <= 0) return '–';
  const weeks = Math.floor(days / 7);
  const rem = days % 7;
  if (weeks > 0 && rem > 0) return `${days} Dni (${weeks}. tydz. ${rem}. d.)`;
  if (weeks > 0) return `${days} Dni (${weeks}. tydz.)`;
  return `${days} Dni`;
}

export function formatDatePL(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '–';
  return new Date(dateStr).toLocaleDateString('pl-PL');
}

// =====================================================
// PARENT AUTO-CALCULATION
// =====================================================

/** Calculate parent start_date = min(children start_dates) */
export function calcParentStartDate(children: GanttTaskNode[]): string | null {
  const dates = children
    .filter(c => c.start_date)
    .map(c => new Date(c.start_date!).getTime());
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates)).toISOString().split('T')[0];
}

/** Calculate parent end_date = max(children end_dates) */
export function calcParentEndDate(children: GanttTaskNode[]): string | null {
  const dates = children
    .filter(c => c.end_date)
    .map(c => new Date(c.end_date!).getTime());
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates)).toISOString().split('T')[0];
}

/** Calculate parent duration = getDaysBetween(start, end) */
export function calcParentDuration(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 0;
  return Math.max(getDaysBetween(new Date(startDate), new Date(endDate)), 0);
}

/** Calculate parent progress = weighted average of children progress by duration */
export function calcParentProgress(children: GanttTaskNode[]): number {
  const withDuration = children.filter(c => (c.duration || 0) > 0);
  if (withDuration.length === 0) {
    // Equal weight fallback
    if (children.length === 0) return 0;
    return Math.round(children.reduce((sum, c) => sum + (c.progress || 0), 0) / children.length);
  }
  const totalDuration = withDuration.reduce((sum, c) => sum + (c.duration || 1), 0);
  const weightedProgress = withDuration.reduce((sum, c) => sum + (c.progress || 0) * (c.duration || 1), 0);
  return Math.round(weightedProgress / totalDuration);
}

/** Recursively recalculate parent nodes (bottom-up) */
export function recalcParents(tree: GanttTaskNode[]): GanttTaskNode[] {
  return tree.map(node => {
    if (!node.children || node.children.length === 0) return node;
    // First, recalc children recursively
    const updatedChildren = recalcParents(node.children);
    const newNode = { ...node, children: updatedChildren };
    if (node.is_auto) {
      const start = calcParentStartDate(updatedChildren);
      const end = calcParentEndDate(updatedChildren);
      newNode.start_date = start;
      newNode.end_date = end;
      newNode.duration = calcParentDuration(start, end);
    }
    if (!node.has_custom_progress) {
      newNode.progress = calcParentProgress(updatedChildren);
    }
    return newNode;
  });
}

// =====================================================
// DEPENDENCY VALIDATION
// =====================================================

/** Detect circular dependencies using DFS */
export function hasCircularDependency(
  deps: GanttDepRecord[],
  newPredId: string,
  newSuccId: string
): boolean {
  // Build adjacency list: successor -> predecessors
  const graph = new Map<string, string[]>();
  for (const d of deps) {
    if (!graph.has(d.successor_id)) graph.set(d.successor_id, []);
    graph.get(d.successor_id)!.push(d.predecessor_id);
  }
  // Add the proposed new dependency
  if (!graph.has(newSuccId)) graph.set(newSuccId, []);
  graph.get(newSuccId)!.push(newPredId);

  // DFS from newPredId: can we reach newPredId from newSuccId via the graph?
  // We check: starting from newPredId, following successor->predecessor links, can we reach newSuccId?
  // Actually: we need to check if adding pred->succ creates a cycle.
  // A cycle exists if succ can reach pred through existing dependencies.
  const visited = new Set<string>();
  const stack = [newPredId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === newSuccId) return true; // Cycle detected
    if (visited.has(current)) continue;
    visited.add(current);
    // Follow: who depends on `current` (current is a successor of someone)
    const predecessors = graph.get(current) || [];
    for (const pred of predecessors) {
      if (!visited.has(pred)) stack.push(pred);
    }
  }
  return false;
}

/** Validate dependency: same task, circular, duplicate */
export function validateDependency(
  deps: GanttDepRecord[],
  predId: string,
  succId: string,
  editingDepId?: string
): { valid: boolean; error?: string } {
  if (!predId || !succId) return { valid: false, error: 'Wybierz oba zadania.' };
  if (predId === succId) return { valid: false, error: 'Zadanie nie może zależeć od siebie.' };

  // Check duplicate (excluding currently editing dep)
  const duplicate = deps.find(d =>
    d.predecessor_id === predId && d.successor_id === succId && d.id !== editingDepId
  );
  if (duplicate) return { valid: false, error: 'Ta zależność już istnieje.' };

  // Check circular
  const filteredDeps = editingDepId ? deps.filter(d => d.id !== editingDepId) : deps;
  if (hasCircularDependency(filteredDeps, predId, succId)) {
    return { valid: false, error: 'Dodanie tej zależności spowodowałoby cykl (zależność kołową).' };
  }

  return { valid: true };
}

// =====================================================
// AUTO-SCHEDULING (Forward pass)
// =====================================================

/**
 * Auto-schedule: given dependencies and working days, calculate start/end dates.
 * Uses forward pass: process tasks in topological order.
 */
export function autoSchedule(
  tasks: GanttTaskNode[],
  deps: GanttDepRecord[],
  workingDays: boolean[],
  projectStartDate: string
): Map<string, { start_date: string; end_date: string }> {
  const allTasks = flattenAll(tasks);
  const taskMap = new Map<string, GanttTaskNode>();
  allTasks.forEach(t => taskMap.set(t.id, t));

  // Build adjacency: taskId -> deps where it's successor
  const incomingDeps = new Map<string, GanttDepRecord[]>();
  for (const d of deps) {
    if (!incomingDeps.has(d.successor_id)) incomingDeps.set(d.successor_id, []);
    incomingDeps.get(d.successor_id)!.push(d);
  }

  // Topological sort
  const inDegree = new Map<string, number>();
  allTasks.forEach(t => inDegree.set(t.id, 0));
  for (const d of deps) {
    inDegree.set(d.successor_id, (inDegree.get(d.successor_id) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }

  const result = new Map<string, { start_date: string; end_date: string }>();
  const projStart = new Date(projectStartDate);

  while (queue.length > 0) {
    const taskId = queue.shift()!;
    const task = taskMap.get(taskId);
    if (!task) continue;

    // Determine earliest start based on incoming dependencies
    let earliestStart = task.start_date ? new Date(task.start_date) : new Date(projStart);
    const incoming = incomingDeps.get(taskId) || [];
    for (const dep of incoming) {
      const predResult = result.get(dep.predecessor_id);
      const pred = taskMap.get(dep.predecessor_id);
      if (!predResult && !pred) continue;

      const predStart = predResult ? new Date(predResult.start_date) : (pred?.start_date ? new Date(pred.start_date) : projStart);
      const predEnd = predResult ? new Date(predResult.end_date) : (pred?.end_date ? new Date(pred.end_date!) : new Date(predStart));

      let constraintDate: Date;
      switch (dep.dependency_type) {
        case 'FS': constraintDate = new Date(predEnd); constraintDate.setDate(constraintDate.getDate() + 1); break;
        case 'SS': constraintDate = new Date(predStart); break;
        case 'FF': {
          const dur = task.duration || 1;
          constraintDate = new Date(predEnd);
          constraintDate.setDate(constraintDate.getDate() - dur + 1);
          break;
        }
        case 'SF': constraintDate = new Date(predStart); constraintDate.setDate(constraintDate.getDate() + 1); break;
        default: constraintDate = new Date(predEnd); constraintDate.setDate(constraintDate.getDate() + 1);
      }

      // Apply lag
      if (dep.lag > 0) {
        constraintDate = addWorkingDays(constraintDate, dep.lag, workingDays);
      }

      if (constraintDate > earliestStart) earliestStart = constraintDate;
    }

    // Snap to working day
    earliestStart = getNextWorkingDay(earliestStart, workingDays);

    const duration = task.duration || 1;
    const endDate = addWorkingDays(earliestStart, Math.max(duration - 1, 0), workingDays);

    result.set(taskId, {
      start_date: earliestStart.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0]
    });

    // Decrease in-degree for successors
    for (const d of deps) {
      if (d.predecessor_id === taskId) {
        const newDeg = (inDegree.get(d.successor_id) || 1) - 1;
        inDegree.set(d.successor_id, newDeg);
        if (newDeg === 0) queue.push(d.successor_id);
      }
    }
  }

  return result;
}

// =====================================================
// CRITICAL PATH (Longest path)
// =====================================================

export function findCriticalPath(
  tasks: GanttTaskNode[],
  deps: GanttDepRecord[]
): Set<string> {
  const allTasks = flattenAll(tasks);
  if (allTasks.length === 0) return new Set();

  const taskMap = new Map<string, GanttTaskNode>();
  allTasks.forEach(t => taskMap.set(t.id, t));

  // Build forward graph: pred -> [successors]
  const fwd = new Map<string, string[]>();
  allTasks.forEach(t => fwd.set(t.id, []));
  for (const d of deps) {
    if (fwd.has(d.predecessor_id)) fwd.get(d.predecessor_id)!.push(d.successor_id);
  }

  // Find task(s) with no predecessors (starts)
  const hasPred = new Set(deps.map(d => d.successor_id));
  const starts = allTasks.filter(t => !hasPred.has(t.id) && !t.parent_id);

  // DFS to find longest path
  const memo = new Map<string, { length: number; path: string[] }>();

  function longestFrom(taskId: string): { length: number; path: string[] } {
    if (memo.has(taskId)) return memo.get(taskId)!;
    const task = taskMap.get(taskId);
    const dur = task?.duration || 1;
    const successors = fwd.get(taskId) || [];
    if (successors.length === 0) {
      const result = { length: dur, path: [taskId] };
      memo.set(taskId, result);
      return result;
    }
    let best = { length: 0, path: [] as string[] };
    for (const succ of successors) {
      const sub = longestFrom(succ);
      if (sub.length > best.length) best = sub;
    }
    const result = { length: dur + best.length, path: [taskId, ...best.path] };
    memo.set(taskId, result);
    return result;
  }

  let criticalPath = { length: 0, path: [] as string[] };
  for (const start of starts) {
    const candidate = longestFrom(start.id);
    if (candidate.length > criticalPath.length) criticalPath = candidate;
  }
  // Also check all tasks (not just starts) in case of disconnected graphs
  for (const t of allTasks) {
    if (!t.parent_id) {
      const candidate = longestFrom(t.id);
      if (candidate.length > criticalPath.length) criticalPath = candidate;
    }
  }

  return new Set(criticalPath.path);
}

// =====================================================
// FORM VALIDATION
// =====================================================

export function validatePhaseForm(form: {
  title: string;
  parent_id: string;
  duration: number;
  start_date: string;
  end_date: string;
}, maxLevel: number, currentLevel: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!form.title.trim()) errors.push('Nazwa jest wymagana.');
  if (form.parent_id && currentLevel >= maxLevel) errors.push(`Maksymalny limit poziomów to ${maxLevel}.`);
  if (form.start_date && form.end_date && new Date(form.end_date) < new Date(form.start_date)) {
    errors.push('Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.');
  }
  if (form.duration < 0) errors.push('Czas trwania nie może być ujemny.');
  return { valid: errors.length === 0, errors };
}
