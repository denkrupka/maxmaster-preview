-- PDF Takeoff Tables — 4 new tables for PDF analysis pipeline
-- Mirrors the DXF takeoff schema pattern with company-scoped RLS

-- 1. PDF analysis results
CREATE TABLE IF NOT EXISTS pdf_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  drawing_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  page_number INT NOT NULL DEFAULT 1,
  content_type TEXT NOT NULL DEFAULT 'vector' CHECK (content_type IN ('vector','raster','mixed')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  total_paths INT DEFAULT 0,
  total_symbols INT DEFAULT 0,
  total_style_groups INT DEFAULT 0,
  total_text_items INT DEFAULT 0,
  total_routes INT DEFAULT 0,
  detected_scale TEXT,
  scale_factor FLOAT,
  ai_classification_status TEXT DEFAULT 'none',
  error_message TEXT,
  analysis_result JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. PDF style groups (pseudo-layers)
CREATE TABLE IF NOT EXISTS pdf_style_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES pdf_analyses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stroke_color TEXT,
  line_width FLOAT,
  dash_pattern FLOAT[] DEFAULT '{}',
  path_count INT DEFAULT 0,
  total_length_px FLOAT DEFAULT 0,
  total_length_m FLOAT DEFAULT 0,
  category TEXT,
  ai_confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. PDF detected symbols
CREATE TABLE IF NOT EXISTS pdf_detected_symbols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES pdf_analyses(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL,
  shape TEXT NOT NULL,
  center_x FLOAT,
  center_y FLOAT,
  radius FLOAT,
  style_group_id UUID REFERENCES pdf_style_groups(id) ON DELETE SET NULL,
  category TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. PDF legends
CREATE TABLE IF NOT EXISTS pdf_legends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES pdf_analyses(id) ON DELETE CASCADE,
  bounding_box JSONB,
  entries JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes on foreign keys
CREATE INDEX IF NOT EXISTS idx_pdf_analyses_company ON pdf_analyses(company_id);
CREATE INDEX IF NOT EXISTS idx_pdf_analyses_drawing ON pdf_analyses(drawing_id);
CREATE INDEX IF NOT EXISTS idx_pdf_style_groups_analysis ON pdf_style_groups(analysis_id);
CREATE INDEX IF NOT EXISTS idx_pdf_detected_symbols_analysis ON pdf_detected_symbols(analysis_id);
CREATE INDEX IF NOT EXISTS idx_pdf_detected_symbols_style_group ON pdf_detected_symbols(style_group_id);
CREATE INDEX IF NOT EXISTS idx_pdf_legends_analysis ON pdf_legends(analysis_id);

-- Updated_at trigger on pdf_analyses
CREATE OR REPLACE FUNCTION update_pdf_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pdf_analyses_updated_at ON pdf_analyses;
CREATE TRIGGER trg_pdf_analyses_updated_at
  BEFORE UPDATE ON pdf_analyses
  FOR EACH ROW EXECUTE FUNCTION update_pdf_analyses_updated_at();

-- Enable RLS
ALTER TABLE pdf_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_style_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_detected_symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_legends ENABLE ROW LEVEL SECURITY;

-- RLS Policies: company-scoped access via users table
-- pdf_analyses
CREATE POLICY pdf_analyses_select ON pdf_analyses FOR SELECT
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
CREATE POLICY pdf_analyses_insert ON pdf_analyses FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
CREATE POLICY pdf_analyses_update ON pdf_analyses FOR UPDATE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
CREATE POLICY pdf_analyses_delete ON pdf_analyses FOR DELETE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- pdf_style_groups (via analysis → company)
CREATE POLICY pdf_style_groups_select ON pdf_style_groups FOR SELECT
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_style_groups_insert ON pdf_style_groups FOR INSERT
  WITH CHECK (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_style_groups_update ON pdf_style_groups FOR UPDATE
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_style_groups_delete ON pdf_style_groups FOR DELETE
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));

-- pdf_detected_symbols (via analysis → company)
CREATE POLICY pdf_detected_symbols_select ON pdf_detected_symbols FOR SELECT
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_detected_symbols_insert ON pdf_detected_symbols FOR INSERT
  WITH CHECK (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_detected_symbols_update ON pdf_detected_symbols FOR UPDATE
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_detected_symbols_delete ON pdf_detected_symbols FOR DELETE
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));

-- pdf_legends (via analysis → company)
CREATE POLICY pdf_legends_select ON pdf_legends FOR SELECT
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_legends_insert ON pdf_legends FOR INSERT
  WITH CHECK (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_legends_update ON pdf_legends FOR UPDATE
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY pdf_legends_delete ON pdf_legends FOR DELETE
  USING (analysis_id IN (
    SELECT id FROM pdf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  ));
