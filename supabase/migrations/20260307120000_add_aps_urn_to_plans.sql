-- Add aps_urn column to construction_plans for Autodesk APS integration
-- Stores the base64-safe URN after file is translated via Model Derivative API
ALTER TABLE plans ADD COLUMN IF NOT EXISTS aps_urn text;

-- Index for quick lookups of already-translated files
CREATE INDEX IF NOT EXISTS idx_plans_aps_urn ON plans (aps_urn) WHERE aps_urn IS NOT NULL;
