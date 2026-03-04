-- Per-company mapping dictionary: style→element type mappings
-- Used to auto-apply previously learned mappings when analyzing new PDFs

CREATE TABLE IF NOT EXISTS pdf_company_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  mapping_type TEXT NOT NULL CHECK (mapping_type IN ('style_color', 'symbol_shape', 'text_label', 'legend_entry')),
  match_value TEXT NOT NULL, -- e.g., "#ff0000", "CIRCLE", "OP1", "Kabel YDY 3x2.5"
  element_name TEXT NOT NULL, -- human-readable name, e.g., "Kabel zasilający YDYp 3x2.5"
  category TEXT NOT NULL, -- e.g., "Kable", "Oprawy", "Osprzęt"
  unit TEXT DEFAULT 'szt.',
  multiplier FLOAT DEFAULT 1,
  notes TEXT,
  usage_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pdf_company_mappings_company ON pdf_company_mappings(company_id);
CREATE INDEX IF NOT EXISTS idx_pdf_company_mappings_type ON pdf_company_mappings(company_id, mapping_type);

-- RLS
ALTER TABLE pdf_company_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pdf_company_mappings_select" ON pdf_company_mappings
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "pdf_company_mappings_insert" ON pdf_company_mappings
  FOR INSERT WITH CHECK (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "pdf_company_mappings_update" ON pdf_company_mappings
  FOR UPDATE USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "pdf_company_mappings_delete" ON pdf_company_mappings
  FOR DELETE USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

-- Updated_at trigger
CREATE TRIGGER pdf_company_mappings_updated_at
  BEFORE UPDATE ON pdf_company_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
