-- Add parent_id to offer_sections for działy/poddziały hierarchy
ALTER TABLE offer_sections ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES offer_sections(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_offer_sections_parent_id ON offer_sections(parent_id);
