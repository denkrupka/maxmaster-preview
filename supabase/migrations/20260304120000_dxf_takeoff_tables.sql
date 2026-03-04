-- ============================================================
-- DXF Takeoff Tables — 7 new tables for DXF analysis & quantity takeoff
-- ============================================================

-- 1. DXF analysis results
CREATE TABLE dxf_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  drawing_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  total_entities INT DEFAULT 0,
  total_blocks INT DEFAULT 0,
  total_layers INT DEFAULT 0,
  unit_system TEXT DEFAULT 'mm',
  ai_classification_status TEXT DEFAULT 'none' CHECK (ai_classification_status IN ('none','pending','completed','failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Extracted layers
CREATE TABLE dxf_extracted_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES dxf_analyses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  entity_count INT DEFAULT 0,
  frozen BOOLEAN DEFAULT false,
  entity_types JSONB DEFAULT '{}',
  ai_category TEXT,
  ai_confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Extracted entities
CREATE TABLE dxf_extracted_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES dxf_analyses(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  layer_name TEXT NOT NULL,
  block_name TEXT,
  geometry JSONB,
  length_m FLOAT DEFAULT 0,
  area_m2 FLOAT DEFAULT 0,
  properties JSONB DEFAULT '{}',
  group_id TEXT,
  entity_index INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Extracted blocks
CREATE TABLE dxf_extracted_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES dxf_analyses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  insert_count INT DEFAULT 0,
  sample_layer TEXT,
  entity_count INT DEFAULT 0,
  contained_types TEXT[] DEFAULT '{}',
  ai_category TEXT,
  ai_description TEXT,
  ai_confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Takeoff rules (per company)
CREATE TABLE dxf_takeoff_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('layer_contains','layer_exact','layer_regex','block_contains','block_exact','block_regex','entity_type')),
  match_pattern TEXT NOT NULL,
  quantity_source TEXT NOT NULL CHECK (quantity_source IN ('count','length_m','area_m2','group_length_m')),
  unit TEXT NOT NULL,
  multiplier FLOAT DEFAULT 1.0,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Block/layer name mappings (dictionary)
CREATE TABLE dxf_block_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('layer','block')),
  mapped_category TEXT NOT NULL,
  mapped_description TEXT,
  investor TEXT,
  design_office TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Takeoff line items
CREATE TABLE dxf_takeoff_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES dxf_analyses(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES dxf_takeoff_rules(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity FLOAT NOT NULL,
  unit TEXT NOT NULL,
  source_entity_ids UUID[] DEFAULT '{}',
  source_entity_indices INT[] DEFAULT '{}',
  source_layer TEXT,
  source_block TEXT,
  status TEXT DEFAULT 'auto' CHECK (status IN ('auto','manual','verified','rejected')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_dxf_analyses_company ON dxf_analyses(company_id);
CREATE INDEX idx_dxf_analyses_drawing ON dxf_analyses(drawing_id);
CREATE INDEX idx_dxf_extracted_layers_analysis ON dxf_extracted_layers(analysis_id);
CREATE INDEX idx_dxf_extracted_entities_analysis ON dxf_extracted_entities(analysis_id);
CREATE INDEX idx_dxf_extracted_entities_layer ON dxf_extracted_entities(layer_name);
CREATE INDEX idx_dxf_extracted_entities_group ON dxf_extracted_entities(group_id);
CREATE INDEX idx_dxf_extracted_blocks_analysis ON dxf_extracted_blocks(analysis_id);
CREATE INDEX idx_dxf_takeoff_rules_company ON dxf_takeoff_rules(company_id);
CREATE INDEX idx_dxf_block_mappings_company ON dxf_block_mappings(company_id);
CREATE INDEX idx_dxf_block_mappings_source ON dxf_block_mappings(source_name, source_type);
CREATE INDEX idx_dxf_takeoff_items_analysis ON dxf_takeoff_items(analysis_id);
CREATE INDEX idx_dxf_takeoff_items_rule ON dxf_takeoff_items(rule_id);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE dxf_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE dxf_extracted_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dxf_extracted_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE dxf_extracted_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE dxf_takeoff_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dxf_block_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE dxf_takeoff_items ENABLE ROW LEVEL SECURITY;

-- dxf_analyses
CREATE POLICY "Users can view their company analyses"
  ON dxf_analyses FOR SELECT
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert analyses for their company"
  ON dxf_analyses FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update their company analyses"
  ON dxf_analyses FOR UPDATE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their company analyses"
  ON dxf_analyses FOR DELETE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- dxf_extracted_layers
CREATE POLICY "Users can view layers from their analyses"
  ON dxf_extracted_layers FOR SELECT
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can insert layers"
  ON dxf_extracted_layers FOR INSERT
  WITH CHECK (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can delete layers"
  ON dxf_extracted_layers FOR DELETE
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

-- dxf_extracted_entities
CREATE POLICY "Users can view entities from their analyses"
  ON dxf_extracted_entities FOR SELECT
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can insert entities"
  ON dxf_extracted_entities FOR INSERT
  WITH CHECK (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can delete entities"
  ON dxf_extracted_entities FOR DELETE
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

-- dxf_extracted_blocks
CREATE POLICY "Users can view blocks from their analyses"
  ON dxf_extracted_blocks FOR SELECT
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can insert blocks"
  ON dxf_extracted_blocks FOR INSERT
  WITH CHECK (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can delete blocks"
  ON dxf_extracted_blocks FOR DELETE
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

-- dxf_takeoff_rules
CREATE POLICY "Users can view their company rules"
  ON dxf_takeoff_rules FOR SELECT
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage their company rules"
  ON dxf_takeoff_rules FOR ALL
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- dxf_block_mappings
CREATE POLICY "Users can view their company mappings"
  ON dxf_block_mappings FOR SELECT
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage their company mappings"
  ON dxf_block_mappings FOR ALL
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- dxf_takeoff_items
CREATE POLICY "Users can view takeoff items from their analyses"
  ON dxf_takeoff_items FOR SELECT
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can insert takeoff items"
  ON dxf_takeoff_items FOR INSERT
  WITH CHECK (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can update takeoff items"
  ON dxf_takeoff_items FOR UPDATE
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can delete takeoff items"
  ON dxf_takeoff_items FOR DELETE
  USING (analysis_id IN (SELECT id FROM dxf_analyses WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

-- ============================================================
-- Updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_dxf_analyses_updated_at
  BEFORE UPDATE ON dxf_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dxf_takeoff_rules_updated_at
  BEFORE UPDATE ON dxf_takeoff_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
