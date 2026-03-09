-- Workspace persistence tables for annotations, measurements, comments, photos

-- Plan annotations (freehand, shapes, text, etc.)
CREATE TABLE IF NOT EXISTS plan_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'text','arrow','freehand','rectangle','ellipse','line','callout','issue-cloud'
  geometry JSONB NOT NULL DEFAULT '{}',
  text TEXT,
  stroke_color TEXT DEFAULT '#ef4444',
  stroke_width REAL DEFAULT 2,
  linked_boq_row_id TEXT,
  linked_object_id TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Plan measurements (length, area, count)
CREATE TABLE IF NOT EXISTS plan_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'length','area','count','polyline'
  value REAL NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'mm',
  label TEXT,
  points JSONB, -- [{x,y}...]
  linked_boq_row_id TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Plan comments (pinned to coordinates)
CREATE TABLE IF NOT EXISTS plan_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position_x REAL,
  position_y REAL,
  object_id TEXT,
  boq_row_id TEXT,
  annotation_id UUID REFERENCES plan_annotations(id),
  author_id UUID REFERENCES users(id),
  author_name TEXT,
  content TEXT NOT NULL DEFAULT '',
  is_resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Comment replies
CREATE TABLE IF NOT EXISTS plan_comment_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES plan_comments(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  author_name TEXT,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Plan photos (pinned to coordinates)
CREATE TABLE IF NOT EXISTS plan_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position_x REAL,
  position_y REAL,
  photo_url TEXT NOT NULL,
  label TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI suggestion feedback
CREATE TABLE IF NOT EXISTS ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'accepted','rejected'
  mode TEXT, -- 'single','similar'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies
ALTER TABLE plan_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_comment_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users (workspace is project-level, auth handled by app)
CREATE POLICY "plan_annotations_all" ON plan_annotations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "plan_measurements_all" ON plan_measurements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "plan_comments_all" ON plan_comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "plan_comment_replies_all" ON plan_comment_replies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "plan_photos_all" ON plan_photos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "ai_feedback_all" ON ai_feedback FOR ALL USING (true) WITH CHECK (true);
