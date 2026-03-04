/**
 * Gantt Advanced Features - Business Logic
 * Baselines, Norms, Condition Factors, Lookahead, What-If, Auto-assignment
 */

// =====================================================
// TYPES
// =====================================================

export interface GanttZone {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  zone_type: 'floor' | 'sector' | 'building' | 'area' | 'room';
  parent_zone_id?: string | null;
  floor_number?: number;
  sort_order: number;
  color: string;
}

export interface GanttNorm {
  id: string;
  company_id: string;
  name: string;
  work_type: string;
  unit: string;
  output_per_day_min: number;
  output_per_day_max: number;
  output_per_day_avg: number;
  crew_size: number;
  notes?: string;
}

export interface GanttConditionFactor {
  id: string;
  company_id: string;
  name: string;
  category: string;
  factor: number;
  description?: string;
  sort_order: number;
}

export interface GanttMaterial {
  id: string;
  gantt_task_id: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  supplier?: string;
  order_date?: string;
  delivery_date?: string;
  delivered: boolean;
  notes?: string;
}

export interface GanttRFI {
  id: string;
  project_id: string;
  gantt_task_id?: string;
  rfi_number: string;
  subject: string;
  question: string;
  assigned_to_id?: string;
  response?: string;
  response_date?: string;
  due_date?: string;
  status: 'open' | 'pending' | 'answered' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'critical';
  impact_days?: number;
  impact_cost?: number;
}

export interface GanttWorkOrder {
  id: string;
  project_id: string;
  order_number: string;
  order_date: string;
  status: 'draft' | 'issued' | 'in_progress' | 'completed' | 'cancelled';
  assigned_to_id?: string;
  zone_id?: string;
  notes?: string;
  items?: GanttWorkOrderItem[];
}

export interface GanttWorkOrderItem {
  id: string;
  work_order_id: string;
  gantt_task_id: string;
  description?: string;
  planned_quantity?: number;
  actual_quantity?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
}

export interface GanttEvidence {
  id: string;
  gantt_task_id: string;
  evidence_type: 'photo_before' | 'photo_after' | 'photo_progress' | 'protocol' | 'measurement' | 'signature' | 'checklist' | 'document';
  file_url?: string;
  file_name?: string;
  description?: string;
  verified: boolean;
  verified_by_id?: string;
}

export interface GanttAcceptedAct {
  id: string;
  project_id: string;
  act_number: string;
  act_date: string;
  zone_id?: string;
  description?: string;
  total_amount: number;
  status: 'draft' | 'submitted' | 'accepted' | 'rejected';
  accepted_by?: string;
  accepted_at?: string;
}

export interface GanttBaseline {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  tasks_snapshot: BaselineTaskSnapshot[];
  created_at: string;
}

export interface BaselineTaskSnapshot {
  task_id: string;
  start_date: string;
  end_date: string;
  duration: number;
  progress: number;
}

export interface GanttScenario {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  scenario_type: 'add_crew' | 'delay' | 'night_shift' | 'material_delay' | 'custom';
  parameters: Record<string, any>;
  result_data?: Record<string, any>;
}

export type LPSStatus = 'backlog' | 'ready' | 'blocked' | 'in_progress' | 'done';

export const LPS_STATUS_LABELS: Record<LPSStatus, string> = {
  backlog: 'Backlog',
  ready: 'Gotowe',
  blocked: 'Zablokowane',
  in_progress: 'W trakcie',
  done: 'Zrobione'
};

export const LPS_STATUS_COLORS: Record<LPSStatus, string> = {
  backlog: '#94a3b8',
  ready: '#22c55e',
  blocked: '#ef4444',
  in_progress: '#3b82f6',
  done: '#10b981'
};

// =====================================================
// DURATION CALCULATION FROM NORMS
// =====================================================

/**
 * Calculate task duration based on norm, quantity, crew size, and condition factors.
 * duration = (quantity / (output_per_day * crew_adjustment)) * total_condition_factor
 */
export function calculateDurationFromNorm(
  norm: GanttNorm,
  quantity: number,
  crewSize: number,
  conditionFactors: number[] = []
): { minDays: number; maxDays: number; avgDays: number } {
  if (quantity <= 0 || !norm) return { minDays: 1, maxDays: 1, avgDays: 1 };

  const crewAdjustment = crewSize / Math.max(norm.crew_size, 1);
  const totalConditionFactor = conditionFactors.reduce((acc, f) => acc * f, 1.0);

  const minDays = Math.ceil((quantity / (norm.output_per_day_max * crewAdjustment)) * totalConditionFactor);
  const maxDays = Math.ceil((quantity / (norm.output_per_day_min * crewAdjustment)) * totalConditionFactor);
  const avgDays = Math.ceil((quantity / (norm.output_per_day_avg * crewAdjustment)) * totalConditionFactor);

  return {
    minDays: Math.max(minDays, 1),
    maxDays: Math.max(maxDays, 1),
    avgDays: Math.max(avgDays, 1)
  };
}

// =====================================================
// DEFAULT NORMS (Polish electrical work standards)
// =====================================================

export const DEFAULT_NORMS: Omit<GanttNorm, 'id' | 'company_id'>[] = [
  { name: 'Montaż tras kablowych', work_type: 'tray_mounting', unit: 'm', output_per_day_min: 15, output_per_day_max: 40, output_per_day_avg: 25, crew_size: 2 },
  { name: 'Ułożenie kabli', work_type: 'cable_laying', unit: 'm', output_per_day_min: 25, output_per_day_max: 60, output_per_day_avg: 40, crew_size: 2 },
  { name: 'Montaż opraw oświetleniowych', work_type: 'lamp_mounting', unit: 'szt', output_per_day_min: 10, output_per_day_max: 35, output_per_day_avg: 20, crew_size: 2 },
  { name: 'Montaż punktów LAN', work_type: 'lan_points', unit: 'pkt', output_per_day_min: 8, output_per_day_max: 20, output_per_day_avg: 12, crew_size: 2 },
  { name: 'Demontaż tras kablowych', work_type: 'tray_demolition', unit: 'm', output_per_day_min: 20, output_per_day_max: 50, output_per_day_avg: 30, crew_size: 2 },
  { name: 'Demontaż kabli', work_type: 'cable_demolition', unit: 'm', output_per_day_min: 30, output_per_day_max: 80, output_per_day_avg: 50, crew_size: 2 },
  { name: 'Pomiary ochronne', work_type: 'measurements', unit: 'pkt', output_per_day_min: 15, output_per_day_max: 40, output_per_day_avg: 25, crew_size: 1 },
  { name: 'Test LAN / certyfikacja', work_type: 'lan_test', unit: 'pkt', output_per_day_min: 20, output_per_day_max: 50, output_per_day_avg: 30, crew_size: 1 },
  { name: 'Montaż rozdzielnic', work_type: 'switchboard', unit: 'szt', output_per_day_min: 0.5, output_per_day_max: 2, output_per_day_avg: 1, crew_size: 2 },
  { name: 'Podłączenia elektryczne', work_type: 'connections', unit: 'szt', output_per_day_min: 15, output_per_day_max: 40, output_per_day_avg: 25, crew_size: 1 },
  { name: 'Montaż osprzętu (gniazdka/wyłączniki)', work_type: 'accessories', unit: 'szt', output_per_day_min: 20, output_per_day_max: 50, output_per_day_avg: 30, crew_size: 1 },
  { name: 'Prace puszkonarkowe', work_type: 'commissioning', unit: 'obwód', output_per_day_min: 5, output_per_day_max: 15, output_per_day_avg: 10, crew_size: 2 },
];

// =====================================================
// DEFAULT CONDITION FACTORS
// =====================================================

export const DEFAULT_CONDITION_FACTORS: Omit<GanttConditionFactor, 'id' | 'company_id'>[] = [
  { name: 'Podłoga techniczna', category: 'access', factor: 1.15, description: '+15% - utrudniony dostęp pod podłogą techniczną', sort_order: 0 },
  { name: 'Koryta podsufitowe', category: 'access', factor: 1.20, description: '+20% - praca na wysokości z korytami sufitowymi', sort_order: 1 },
  { name: 'Lampy wiszące na linkach', category: 'complexity', factor: 1.30, description: '+30% - montaż lamp na linkach/zawieszeniach', sort_order: 2 },
  { name: 'Prace demontażowe ciężkie', category: 'complexity', factor: 1.25, description: '+25% - ciężki demontaż instalacji', sort_order: 3 },
  { name: 'Obiekt czynny (szkoła)', category: 'environment', factor: 1.20, description: '+20% - praca w czynnym obiekcie szkolnym', sort_order: 4 },
  { name: 'Obiekt czynny (szpital)', category: 'environment', factor: 1.30, description: '+30% - praca w czynnym szpitalu', sort_order: 5 },
  { name: 'Obiekt czynny (biuro)', category: 'environment', factor: 1.10, description: '+10% - praca w czynnym biurze', sort_order: 6 },
  { name: 'Praca nocna', category: 'environment', factor: 1.15, description: '+15% - praca w godzinach nocnych', sort_order: 7 },
  { name: 'Ograniczony dostęp', category: 'access', factor: 1.20, description: '+20% - ograniczony dostęp do miejsca pracy', sort_order: 8 },
  { name: 'Praca na wysokości >3m', category: 'complexity', factor: 1.15, description: '+15% - praca na rusztowaniach/podnośnikach', sort_order: 9 },
  { name: 'Strefy ATEX', category: 'complexity', factor: 1.35, description: '+35% - praca w strefach zagrożenia wybuchem', sort_order: 10 },
  { name: 'Niska temperatura', category: 'environment', factor: 1.10, description: '+10% - praca w niskiej temperaturze', sort_order: 11 },
];

// =====================================================
// DEFAULT DECOMPOSITION TEMPLATES
// =====================================================

export interface DecompositionTemplate {
  name: string;
  work_type: string;
  tasks: { title: string; work_type: string; order: number; depType: 'FS' | 'SS'; lag: number }[];
}

export const DECOMPOSITION_TEMPLATES: DecompositionTemplate[] = [
  {
    name: 'Instalacja elektryczna (pełna)',
    work_type: 'electrical_full',
    tasks: [
      { title: 'Demontaż starych tras', work_type: 'tray_demolition', order: 0, depType: 'FS', lag: 0 },
      { title: 'Demontaż kabli', work_type: 'cable_demolition', order: 1, depType: 'FS', lag: 0 },
      { title: 'Montaż tras kablowych', work_type: 'tray_mounting', order: 2, depType: 'FS', lag: 0 },
      { title: 'Ułożenie kabli', work_type: 'cable_laying', order: 3, depType: 'FS', lag: 0 },
      { title: 'Montaż opraw oświetleniowych', work_type: 'lamp_mounting', order: 4, depType: 'SS', lag: 1 },
      { title: 'Podłączenia + opis', work_type: 'connections', order: 5, depType: 'FS', lag: 0 },
      { title: 'Pomiary ochronne', work_type: 'measurements', order: 6, depType: 'FS', lag: 0 },
    ]
  },
  {
    name: 'Instalacja LAN',
    work_type: 'lan_full',
    tasks: [
      { title: 'Montaż tras kablowych', work_type: 'tray_mounting', order: 0, depType: 'FS', lag: 0 },
      { title: 'Ułożenie kabli LAN', work_type: 'cable_laying', order: 1, depType: 'FS', lag: 0 },
      { title: 'Montaż punktów LAN', work_type: 'lan_points', order: 2, depType: 'FS', lag: 0 },
      { title: 'Montaż szaf/patch paneli', work_type: 'switchboard', order: 3, depType: 'SS', lag: 0 },
      { title: 'Podłączenia', work_type: 'connections', order: 4, depType: 'FS', lag: 0 },
      { title: 'Test LAN + protokół', work_type: 'lan_test', order: 5, depType: 'FS', lag: 0 },
    ]
  },
  {
    name: 'Demontaż instalacji',
    work_type: 'demolition',
    tasks: [
      { title: 'Odłączenie zasilania', work_type: 'connections', order: 0, depType: 'FS', lag: 0 },
      { title: 'Demontaż opraw', work_type: 'lamp_mounting', order: 1, depType: 'FS', lag: 0 },
      { title: 'Demontaż kabli', work_type: 'cable_demolition', order: 2, depType: 'FS', lag: 0 },
      { title: 'Demontaż tras', work_type: 'tray_demolition', order: 3, depType: 'FS', lag: 0 },
      { title: 'Utylizacja / wywóz', work_type: 'commissioning', order: 4, depType: 'FS', lag: 0 },
    ]
  }
];

// =====================================================
// LOOKAHEAD FILTERING
// =====================================================

export interface LookaheadConfig {
  weeks: number; // 2-6 weeks
  startDate: Date;
}

export function filterLookaheadTasks<T extends { start_date?: string | null; end_date?: string | null }>(
  tasks: T[],
  config: LookaheadConfig
): T[] {
  const endDate = new Date(config.startDate);
  endDate.setDate(endDate.getDate() + config.weeks * 7);

  return tasks.filter(t => {
    if (!t.start_date) return false;
    const taskStart = new Date(t.start_date);
    const taskEnd = t.end_date ? new Date(t.end_date) : taskStart;
    // Task overlaps with lookahead window
    return taskStart <= endDate && taskEnd >= config.startDate;
  });
}

// =====================================================
// WHAT-IF SCENARIOS
// =====================================================

export interface WhatIfResult {
  originalEndDate: string;
  newEndDate: string;
  deltaDays: number;
  affectedTasks: string[];
  costImpact?: number;
}

/**
 * Calculate what happens if we add N crews
 */
export function whatIfAddCrew(
  tasks: { id: string; duration?: number; assigned_crew?: number }[],
  additionalCrews: number,
  criticalPathIds: Set<string>
): WhatIfResult {
  let totalSaved = 0;
  const affected: string[] = [];

  for (const task of tasks) {
    if (!criticalPathIds.has(task.id) || !task.duration) continue;
    const currentCrew = task.assigned_crew || 2;
    const newCrew = currentCrew + additionalCrews;
    const speedup = newCrew / currentCrew;
    const newDuration = Math.max(Math.ceil(task.duration / speedup), 1);
    const saved = task.duration - newDuration;
    if (saved > 0) {
      totalSaved += saved;
      affected.push(task.id);
    }
  }

  return {
    originalEndDate: '',
    newEndDate: '',
    deltaDays: -totalSaved,
    affectedTasks: affected
  };
}

/**
 * Calculate what happens if material delivery is delayed
 */
export function whatIfMaterialDelay(
  materialTaskId: string,
  delayDays: number,
  dependencies: { predecessor_id: string; successor_id: string }[],
  criticalPathIds: Set<string>
): WhatIfResult {
  const affected = new Set<string>();
  const queue = [materialTaskId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    affected.add(current);
    for (const dep of dependencies) {
      if (dep.predecessor_id === current && !affected.has(dep.successor_id)) {
        queue.push(dep.successor_id);
      }
    }
  }

  const criticalAffected = [...affected].filter(id => criticalPathIds.has(id));
  const impactDays = criticalAffected.length > 0 ? delayDays : 0;

  return {
    originalEndDate: '',
    newEndDate: '',
    deltaDays: impactDays,
    affectedTasks: [...affected]
  };
}

// =====================================================
// RISK BUFFER (Critical Chain)
// =====================================================

/**
 * Calculate risk buffer for a chain of tasks
 * Uses square root of sum of squares method (CCPM)
 */
export function calculateRiskBuffer(
  taskDurations: number[],
  uncertaintyPercent: number = 30 // default 30% uncertainty
): number {
  const sumOfSquares = taskDurations.reduce((acc, d) => {
    const buffer = d * (uncertaintyPercent / 100);
    return acc + buffer * buffer;
  }, 0);
  return Math.ceil(Math.sqrt(sumOfSquares));
}

// =====================================================
// WORK ORDER GENERATION
// =====================================================

export function generateWorkOrderNumber(projectName: string, date: Date, index: number): string {
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const prefix = projectName.substring(0, 3).toUpperCase();
  return `WO-${prefix}-${dateStr}-${String(index + 1).padStart(3, '0')}`;
}

// =====================================================
// EVM (Earned Value Management) Calculations
// =====================================================

export interface EVMMetrics {
  pv: number; // Planned Value (BCWS)
  ev: number; // Earned Value (BCWP)
  ac: number; // Actual Cost (ACWP)
  spi: number; // Schedule Performance Index (EV/PV)
  cpi: number; // Cost Performance Index (EV/AC)
  sv: number; // Schedule Variance (EV-PV)
  cv: number; // Cost Variance (EV-AC)
  eac: number; // Estimate at Completion
  etc: number; // Estimate to Complete
}

export function calculateEVM(
  totalBudget: number,
  plannedProgressPercent: number,
  actualProgressPercent: number,
  actualCostSpent: number
): EVMMetrics {
  const pv = totalBudget * (plannedProgressPercent / 100);
  const ev = totalBudget * (actualProgressPercent / 100);
  const ac = actualCostSpent;

  const spi = pv > 0 ? ev / pv : 0;
  const cpi = ac > 0 ? ev / ac : 0;
  const sv = ev - pv;
  const cv = ev - ac;
  const eac = cpi > 0 ? totalBudget / cpi : totalBudget;
  const etc = eac - ac;

  return { pv, ev, ac, spi, cpi, sv, cv, eac, etc };
}

// =====================================================
// PREDICTIVE ANALYTICS (simplified)
// =====================================================

export interface PredictiveInsight {
  type: 'delay_risk' | 'cost_overrun' | 'resource_conflict' | 'material_risk';
  severity: 'low' | 'medium' | 'high';
  message: string;
  affectedTaskIds: string[];
  recommendation: string;
}

export function generatePredictiveInsights(
  tasks: { id: string; title?: string; duration?: number; progress: number; start_date?: string; end_date?: string; lps_status?: string }[],
  dependencies: { predecessor_id: string; successor_id: string }[],
  materials: GanttMaterial[],
  criticalPathIds: Set<string>
): PredictiveInsight[] {
  const insights: PredictiveInsight[] = [];
  const today = new Date();

  // 1. Check overdue tasks on critical path
  const overdueCritical = tasks.filter(t => {
    if (!criticalPathIds.has(t.id) || !t.end_date || t.progress >= 100) return false;
    return new Date(t.end_date) < today;
  });
  if (overdueCritical.length > 0) {
    insights.push({
      type: 'delay_risk',
      severity: 'high',
      message: `${overdueCritical.length} zadań na ścieżce krytycznej jest spóźnionych`,
      affectedTaskIds: overdueCritical.map(t => t.id),
      recommendation: 'Rozważ dodanie zasobów lub pracę w nadgodzinach'
    });
  }

  // 2. Check blocked tasks
  const blockedTasks = tasks.filter(t => t.lps_status === 'blocked');
  if (blockedTasks.length > 0) {
    insights.push({
      type: 'delay_risk',
      severity: 'medium',
      message: `${blockedTasks.length} zadań jest zablokowanych`,
      affectedTaskIds: blockedTasks.map(t => t.id),
      recommendation: 'Sprawdź blokery i utwórz RFI jeśli potrzeba'
    });
  }

  // 3. Check material delivery risks
  const lateMaterials = materials.filter(m => {
    if (m.delivered || !m.delivery_date) return false;
    return new Date(m.delivery_date) < today;
  });
  if (lateMaterials.length > 0) {
    insights.push({
      type: 'material_risk',
      severity: 'high',
      message: `${lateMaterials.length} materiałów nie dostarczono w terminie`,
      affectedTaskIds: lateMaterials.map(m => m.gantt_task_id),
      recommendation: 'Skontaktuj się z dostawcami i przygotuj plan B'
    });
  }

  // 4. Tasks with low progress near deadline
  const atRisk = tasks.filter(t => {
    if (!t.end_date || t.progress >= 80) return false;
    const daysLeft = Math.ceil((new Date(t.end_date).getTime() - today.getTime()) / 86400000);
    const expectedProgress = t.duration ? Math.max(0, 100 - (daysLeft / t.duration) * 100) : 50;
    return t.progress < expectedProgress * 0.5 && daysLeft <= 7;
  });
  if (atRisk.length > 0) {
    insights.push({
      type: 'delay_risk',
      severity: 'medium',
      message: `${atRisk.length} zadań ma niski postęp w stosunku do terminu`,
      affectedTaskIds: atRisk.map(t => t.id),
      recommendation: 'Sprawdź przyczyny opóźnień i zaktualizuj planowanie'
    });
  }

  return insights;
}
