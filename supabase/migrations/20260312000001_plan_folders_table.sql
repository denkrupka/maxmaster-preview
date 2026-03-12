-- =====================================================
-- Migration: plan_folders table
-- Date: 2026-03-12
-- Description: Folders for organizing plans within a project.
--   PlansWorkspace.tsx references plan_folders for insert/update/select/delete
--   but no migration existed — causing all folder operations to silently fail.
-- =====================================================

CREATE TABLE IF NOT EXISTS plan_folders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id     UUID REFERENCES plan_folders(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  sort_order    INTEGER DEFAULT 0,
  created_by_id UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_plan_folders_project ON plan_folders(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_folders_parent  ON plan_folders(parent_id);

-- Allow plans to reference folders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'folder_id'
  ) THEN
    ALTER TABLE plans ADD COLUMN folder_id UUID REFERENCES plan_folders(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_plans_folder ON plans(folder_id);
  END IF;
END $$;

ALTER TABLE plan_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_folders_project_access" ON plan_folders
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN users u ON u.company_id = p.company_id
      WHERE u.id = auth.uid()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN users u ON u.company_id = p.company_id
      WHERE u.id = auth.uid()
    )
  );

CREATE TRIGGER update_plan_folders_updated_at
  BEFORE UPDATE ON plan_folders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
