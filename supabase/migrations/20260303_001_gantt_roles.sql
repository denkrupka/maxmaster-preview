-- =====================================================
-- Migration: Gantt Task Roles (supervisor + approver)
-- Date: 2026-03-03
-- =====================================================

-- Add supervisor and approver columns to gantt_tasks
ALTER TABLE gantt_tasks
  ADD COLUMN IF NOT EXISTS supervisor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gantt_tasks_supervisor ON gantt_tasks(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_gantt_tasks_approver ON gantt_tasks(approver_id);
CREATE INDEX IF NOT EXISTS idx_gantt_tasks_assigned ON gantt_tasks(assigned_to_id);
