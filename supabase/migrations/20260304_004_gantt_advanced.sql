-- =====================================================
-- Migration: Gantt Advanced Features
-- Date: 2026-03-04
-- Description: WBS+, Resources/Skills, Calendar/Shifts,
--   Baselines, Condition Factors, Materials, Work Orders,
--   Evidence, Zones, RFIs, Norms, Accepted Acts
-- =====================================================

-- =====================================================
-- 1. GANTT TASKS: add new columns
-- =====================================================
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical'));
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS supervisor_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS approver_id UUID REFERENCES users(id) ON DELETE SET NULL;
-- Zone/floor reference
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS zone_id UUID;
-- Baseline tracking
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS baseline_start DATE;
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS baseline_end DATE;
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS baseline_duration INTEGER;
-- Actual dates for fact tracking
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS actual_start DATE;
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS actual_end DATE;
-- Last Planner statuses
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS lps_status TEXT DEFAULT 'backlog' CHECK (lps_status IN ('backlog','ready','blocked','in_progress','done'));
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS blocker_reason TEXT;
-- Accepted act reference
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS accepted_act_id UUID;
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
-- Skill requirements (JSON array of required skills)
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS required_skills JSONB DEFAULT '[]'::jsonb;
-- Min crew size
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS min_crew_size INTEGER DEFAULT 1;
-- Auto-calculated duration from norms
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS quantity NUMERIC;
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS quantity_unit TEXT;
ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS norm_id UUID;

-- =====================================================
-- 2. ZONES / FLOORS (Geo-zones for work organization)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  zone_type TEXT DEFAULT 'floor' CHECK (zone_type IN ('floor','sector','building','area','room')),
  parent_zone_id UUID REFERENCES gantt_zones(id) ON DELETE CASCADE,
  floor_number INTEGER,
  sort_order INTEGER DEFAULT 0,
  color TEXT DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE gantt_tasks ADD CONSTRAINT fk_gantt_tasks_zone FOREIGN KEY (zone_id) REFERENCES gantt_zones(id) ON DELETE SET NULL;

-- =====================================================
-- 3. SHIFTS & CALENDAR (Night shifts, forbidden intervals)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "Zmiana dzienna", "Zmiana nocna"
  start_time TIME NOT NULL DEFAULT '07:00',
  end_time TIME NOT NULL DEFAULT '15:00',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gantt_forbidden_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES gantt_zones(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "Szkoła - godziny lekcyjne"
  day_of_week INTEGER[], -- 0-6 (Mon-Sun)
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_date DATE, -- optional date range
  end_date DATE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 4. USER SKILLS & COMPETENCIES (SEP, pomiary, etc.)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_skill_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "Montaż LAN", "Pomiary ochronne", "SEP E"
  category TEXT DEFAULT 'skill' CHECK (category IN ('skill','uprawnienia','certification')),
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gantt_user_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES gantt_skill_types(id) ON DELETE CASCADE,
  level TEXT DEFAULT 'basic' CHECK (level IN ('basic','intermediate','advanced','expert')),
  certificate_number TEXT,
  valid_until DATE,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skill_id)
);

-- =====================================================
-- 5. PRODUCTIVITY NORMS (for auto-duration calculation)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_norms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "Montaż kabla NYM"
  work_type TEXT NOT NULL, -- e.g., "cable_laying", "tray_mounting", "lamp_mounting"
  unit TEXT NOT NULL, -- e.g., "m", "szt", "pkt"
  output_per_day_min NUMERIC NOT NULL, -- minimum output per day
  output_per_day_max NUMERIC NOT NULL, -- maximum output per day
  output_per_day_avg NUMERIC NOT NULL, -- average output per day
  crew_size INTEGER DEFAULT 2,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 6. CONDITION FACTORS (complexity multipliers)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_condition_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "Podłoga techniczna", "Obiekt czynny"
  category TEXT DEFAULT 'general', -- e.g., "access", "environment", "complexity"
  factor NUMERIC NOT NULL DEFAULT 1.0, -- multiplier, e.g., 1.15 = +15%
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link condition factors to tasks
CREATE TABLE IF NOT EXISTS gantt_task_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gantt_task_id UUID NOT NULL REFERENCES gantt_tasks(id) ON DELETE CASCADE,
  condition_factor_id UUID NOT NULL REFERENCES gantt_condition_factors(id) ON DELETE CASCADE,
  custom_factor NUMERIC, -- override the default factor
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(gantt_task_id, condition_factor_id)
);

-- =====================================================
-- 7. MATERIALS (Bill of Materials per task - MRP-lite)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gantt_task_id UUID NOT NULL REFERENCES gantt_tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'szt',
  unit_price NUMERIC DEFAULT 0,
  supplier TEXT,
  order_date DATE,
  delivery_date DATE,
  delivered BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 8. WORK ORDERS (daily/weekly orders for crews)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  order_date DATE NOT NULL,
  shift_id UUID REFERENCES gantt_shifts(id),
  zone_id UUID REFERENCES gantt_zones(id),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','issued','in_progress','completed','cancelled')),
  assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL, -- brigade leader
  notes TEXT,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gantt_work_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES gantt_work_orders(id) ON DELETE CASCADE,
  gantt_task_id UUID NOT NULL REFERENCES gantt_tasks(id) ON DELETE CASCADE,
  description TEXT,
  planned_quantity NUMERIC,
  actual_quantity NUMERIC,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','blocked')),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 9. PROGRESS EVIDENCE (photos, protocols, signatures)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gantt_task_id UUID NOT NULL REFERENCES gantt_tasks(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('photo_before','photo_after','photo_progress','protocol','measurement','signature','checklist','document')),
  file_url TEXT,
  file_name TEXT,
  description TEXT,
  verified BOOLEAN DEFAULT FALSE,
  verified_by_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  uploaded_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 10. RFI (Request for Information)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_rfis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  gantt_task_id UUID REFERENCES gantt_tasks(id) ON DELETE SET NULL,
  rfi_number TEXT NOT NULL,
  subject TEXT NOT NULL,
  question TEXT NOT NULL,
  assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL,
  response TEXT,
  response_date TIMESTAMPTZ,
  responded_by_id UUID REFERENCES users(id),
  due_date DATE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','pending','answered','closed')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  impact_days INTEGER, -- estimated impact on critical path
  impact_cost NUMERIC, -- estimated cost impact
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 11. ACCEPTED ACTS (акты приёмки)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_accepted_acts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  act_number TEXT NOT NULL,
  act_date DATE NOT NULL,
  zone_id UUID REFERENCES gantt_zones(id),
  description TEXT,
  total_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','submitted','accepted','rejected')),
  accepted_by TEXT,
  accepted_at TIMESTAMPTZ,
  notes TEXT,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gantt_accepted_act_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  act_id UUID NOT NULL REFERENCES gantt_accepted_acts(id) ON DELETE CASCADE,
  gantt_task_id UUID NOT NULL REFERENCES gantt_tasks(id) ON DELETE CASCADE,
  description TEXT,
  quantity NUMERIC,
  unit TEXT,
  unit_price NUMERIC,
  amount NUMERIC,
  sort_order INTEGER DEFAULT 0
);

ALTER TABLE gantt_tasks ADD CONSTRAINT fk_gantt_tasks_accepted_act FOREIGN KEY (accepted_act_id) REFERENCES gantt_accepted_acts(id) ON DELETE SET NULL;

-- =====================================================
-- 12. PREDICTIVE ANALYTICS (historical data for norms)
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_task_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_type TEXT, -- work_type category
  zone_type TEXT,
  planned_duration INTEGER,
  actual_duration INTEGER,
  planned_start DATE,
  actual_start DATE,
  planned_end DATE,
  actual_end DATE,
  crew_size INTEGER,
  quantity NUMERIC,
  unit TEXT,
  conditions JSONB DEFAULT '[]'::jsonb, -- condition factors applied
  deviation_days INTEGER, -- actual - planned
  deviation_percent NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 13. WHAT-IF SCENARIOS
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  scenario_type TEXT DEFAULT 'custom' CHECK (scenario_type IN ('add_crew','delay','night_shift','material_delay','custom')),
  parameters JSONB DEFAULT '{}'::jsonb,
  result_data JSONB, -- calculated result
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 14. QUALITY CHECKLISTS
-- =====================================================
CREATE TABLE IF NOT EXISTS gantt_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  work_type TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{label, required, type: 'check'|'text'|'photo'|'measurement'}]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gantt_task_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gantt_task_id UUID NOT NULL REFERENCES gantt_tasks(id) ON DELETE CASCADE,
  template_id UUID REFERENCES gantt_checklist_templates(id),
  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{label, required, type, value, completed, completed_by, completed_at}]
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 15. RLS POLICIES
-- =====================================================
ALTER TABLE gantt_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_forbidden_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_skill_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_user_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_norms ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_condition_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_task_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_work_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_accepted_acts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_accepted_act_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_task_checklists ENABLE ROW LEVEL SECURITY;

-- Project-scoped access policies
CREATE POLICY "gantt_zones_access" ON gantt_zones FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_shifts_access" ON gantt_shifts FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_forbidden_intervals_access" ON gantt_forbidden_intervals FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_materials_access" ON gantt_materials FOR ALL USING (
  gantt_task_id IN (SELECT gt.id FROM gantt_tasks gt JOIN projects p ON p.id = gt.project_id JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_work_orders_access" ON gantt_work_orders FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_work_order_items_access" ON gantt_work_order_items FOR ALL USING (
  work_order_id IN (SELECT wo.id FROM gantt_work_orders wo JOIN projects p ON p.id = wo.project_id JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_evidence_access" ON gantt_evidence FOR ALL USING (
  gantt_task_id IN (SELECT gt.id FROM gantt_tasks gt JOIN projects p ON p.id = gt.project_id JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_rfis_access" ON gantt_rfis FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_accepted_acts_access" ON gantt_accepted_acts FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_accepted_act_items_access" ON gantt_accepted_act_items FOR ALL USING (
  act_id IN (SELECT a.id FROM gantt_accepted_acts a JOIN projects p ON p.id = a.project_id JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_task_history_access" ON gantt_task_history FOR ALL USING (
  company_id IN (SELECT u.company_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "gantt_scenarios_access" ON gantt_scenarios FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));
CREATE POLICY "gantt_task_conditions_access" ON gantt_task_conditions FOR ALL USING (
  gantt_task_id IN (SELECT gt.id FROM gantt_tasks gt JOIN projects p ON p.id = gt.project_id JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));

-- Company-scoped access
CREATE POLICY "gantt_skill_types_access" ON gantt_skill_types FOR ALL USING (
  company_id IN (SELECT u.company_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "gantt_user_skills_access" ON gantt_user_skills FOR ALL USING (
  user_id IN (SELECT u.id FROM users u WHERE u.company_id IN (SELECT u2.company_id FROM users u2 WHERE u2.id = auth.uid())));
CREATE POLICY "gantt_norms_access" ON gantt_norms FOR ALL USING (
  company_id IN (SELECT u.company_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "gantt_condition_factors_access" ON gantt_condition_factors FOR ALL USING (
  company_id IN (SELECT u.company_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "gantt_checklist_templates_access" ON gantt_checklist_templates FOR ALL USING (
  company_id IN (SELECT u.company_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "gantt_task_checklists_access" ON gantt_task_checklists FOR ALL USING (
  gantt_task_id IN (SELECT gt.id FROM gantt_tasks gt JOIN projects p ON p.id = gt.project_id JOIN users u ON u.company_id = p.company_id WHERE u.id = auth.uid()));

-- =====================================================
-- 16. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_gantt_zones_project ON gantt_zones(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_shifts_project ON gantt_shifts(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_forbidden_project ON gantt_forbidden_intervals(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_skill_types_company ON gantt_skill_types(company_id);
CREATE INDEX IF NOT EXISTS idx_gantt_user_skills_user ON gantt_user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_gantt_user_skills_skill ON gantt_user_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_gantt_norms_company ON gantt_norms(company_id);
CREATE INDEX IF NOT EXISTS idx_gantt_norms_type ON gantt_norms(work_type);
CREATE INDEX IF NOT EXISTS idx_gantt_condition_factors_company ON gantt_condition_factors(company_id);
CREATE INDEX IF NOT EXISTS idx_gantt_task_conditions_task ON gantt_task_conditions(gantt_task_id);
CREATE INDEX IF NOT EXISTS idx_gantt_materials_task ON gantt_materials(gantt_task_id);
CREATE INDEX IF NOT EXISTS idx_gantt_work_orders_project ON gantt_work_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_work_orders_date ON gantt_work_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_gantt_evidence_task ON gantt_evidence(gantt_task_id);
CREATE INDEX IF NOT EXISTS idx_gantt_rfis_project ON gantt_rfis(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_rfis_task ON gantt_rfis(gantt_task_id);
CREATE INDEX IF NOT EXISTS idx_gantt_accepted_acts_project ON gantt_accepted_acts(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_task_history_company ON gantt_task_history(company_id);
CREATE INDEX IF NOT EXISTS idx_gantt_task_history_type ON gantt_task_history(task_type);
CREATE INDEX IF NOT EXISTS idx_gantt_scenarios_project ON gantt_scenarios(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_tasks_zone ON gantt_tasks(zone_id);
CREATE INDEX IF NOT EXISTS idx_gantt_tasks_lps ON gantt_tasks(lps_status);
CREATE INDEX IF NOT EXISTS idx_gantt_tasks_norm ON gantt_tasks(norm_id);

-- =====================================================
-- 17. TRIGGERS
-- =====================================================
CREATE TRIGGER update_gantt_zones_updated_at BEFORE UPDATE ON gantt_zones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gantt_norms_updated_at BEFORE UPDATE ON gantt_norms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gantt_materials_updated_at BEFORE UPDATE ON gantt_materials FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gantt_work_orders_updated_at BEFORE UPDATE ON gantt_work_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gantt_rfis_updated_at BEFORE UPDATE ON gantt_rfis FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gantt_accepted_acts_updated_at BEFORE UPDATE ON gantt_accepted_acts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gantt_task_checklists_updated_at BEFORE UPDATE ON gantt_task_checklists FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 18. SEED DEFAULT NORMS (Polish electrical standards)
-- =====================================================
-- These will be inserted only if the company has the gantt module
-- Norms can be customized per company

-- =====================================================
-- 19. FUNCTION: Calculate duration from norm + quantity + conditions
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_task_duration(
  p_norm_id UUID,
  p_quantity NUMERIC,
  p_crew_size INTEGER DEFAULT 2,
  p_condition_factor NUMERIC DEFAULT 1.0
) RETURNS INTEGER AS $$
DECLARE
  v_output_per_day NUMERIC;
  v_norm_crew INTEGER;
  v_raw_days NUMERIC;
  v_adjusted_days NUMERIC;
BEGIN
  SELECT output_per_day_avg, crew_size INTO v_output_per_day, v_norm_crew
  FROM gantt_norms WHERE id = p_norm_id;

  IF v_output_per_day IS NULL OR v_output_per_day <= 0 THEN RETURN 1; END IF;

  -- Adjust output for crew size difference
  v_raw_days := p_quantity / (v_output_per_day * (p_crew_size::NUMERIC / GREATEST(v_norm_crew, 1)));

  -- Apply condition factors
  v_adjusted_days := v_raw_days * p_condition_factor;

  RETURN GREATEST(CEIL(v_adjusted_days), 1);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 20. FUNCTION: Auto-assign crew by competencies
-- =====================================================
CREATE OR REPLACE FUNCTION find_available_crew(
  p_project_id UUID,
  p_required_skills JSONB,
  p_start_date DATE,
  p_end_date DATE,
  p_min_crew INTEGER DEFAULT 2
) RETURNS TABLE(user_id UUID, user_name TEXT, matching_skills INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    (u.first_name || ' ' || u.last_name)::TEXT,
    COUNT(DISTINCT gs.skill_id)::INTEGER as matching_skills
  FROM users u
  JOIN gantt_user_skills gs ON gs.user_id = u.id
  JOIN gantt_skill_types gst ON gst.id = gs.skill_id
  WHERE u.company_id = (SELECT company_id FROM projects WHERE id = p_project_id)
    AND gst.name = ANY(ARRAY(SELECT jsonb_array_elements_text(p_required_skills)))
    AND (gs.valid_until IS NULL OR gs.valid_until >= p_start_date)
    -- Not already fully allocated in this period
    AND u.id NOT IN (
      SELECT gtr.user_id FROM gantt_task_resources gtr
      JOIN gantt_tasks gt ON gt.id = gtr.gantt_task_id
      WHERE gt.project_id = p_project_id
        AND gtr.allocation_percent >= 100
        AND gt.start_date <= p_end_date
        AND gt.end_date >= p_start_date
    )
  GROUP BY u.id, u.first_name, u.last_name
  ORDER BY matching_skills DESC
  LIMIT p_min_crew * 3; -- return more candidates for selection
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 21. VIEW: Task schedule health (SPI/CPI indicators)
-- =====================================================
CREATE OR REPLACE VIEW gantt_task_health AS
SELECT
  gt.id,
  gt.project_id,
  gt.title,
  gt.start_date AS planned_start,
  gt.end_date AS planned_end,
  gt.actual_start,
  gt.actual_end,
  gt.baseline_start,
  gt.baseline_end,
  gt.duration AS planned_duration,
  CASE WHEN gt.actual_start IS NOT NULL AND gt.actual_end IS NOT NULL
    THEN (gt.actual_end - gt.actual_start) ELSE NULL END AS actual_duration,
  gt.progress,
  gt.lps_status,
  -- Schedule deviation
  CASE WHEN gt.actual_end IS NOT NULL AND gt.end_date IS NOT NULL
    THEN (gt.actual_end - gt.end_date) ELSE NULL END AS schedule_deviation_days,
  -- Baseline deviation
  CASE WHEN gt.end_date IS NOT NULL AND gt.baseline_end IS NOT NULL
    THEN (gt.end_date - gt.baseline_end) ELSE NULL END AS baseline_deviation_days,
  -- Is on critical path (simplified - tasks with no float)
  CASE WHEN gt.end_date < CURRENT_DATE AND gt.progress < 100 THEN 'overdue'
       WHEN gt.end_date <= CURRENT_DATE + 3 AND gt.progress < 100 THEN 'at_risk'
       ELSE 'on_track' END AS health_status
FROM gantt_tasks gt;
