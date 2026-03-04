-- Offer Requests (Zapytania ofertowe) — RFQs sent to subcontractors
CREATE TABLE IF NOT EXISTS offer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  subcontractor_id uuid REFERENCES contractors(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  request_type text NOT NULL DEFAULT 'all' CHECK (request_type IN ('robota', 'materialy', 'sprzet', 'all')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'responded', 'accepted', 'rejected')),
  share_token text UNIQUE,
  notes text,
  print_settings jsonb DEFAULT '{}'::jsonb,
  response_data jsonb,
  sent_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  created_by_id uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE offer_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company offer requests"
  ON offer_requests FOR SELECT
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert own company offer requests"
  ON offer_requests FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update own company offer requests"
  ON offer_requests FOR UPDATE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete own company offer requests"
  ON offer_requests FOR DELETE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- Public access for share_token (subcontractor view)
CREATE POLICY "Public can view offer requests by share_token"
  ON offer_requests FOR SELECT
  USING (share_token IS NOT NULL);

CREATE POLICY "Public can update offer requests by share_token"
  ON offer_requests FOR UPDATE
  USING (share_token IS NOT NULL);

-- Index
CREATE INDEX idx_offer_requests_company ON offer_requests(company_id);
CREATE INDEX idx_offer_requests_offer ON offer_requests(offer_id);
CREATE INDEX idx_offer_requests_token ON offer_requests(share_token) WHERE share_token IS NOT NULL;
