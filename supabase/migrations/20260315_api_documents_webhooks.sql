-- Migration: REST API tables for document management
-- Created: 2026-03-15

-- API Keys table for authentication
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    permissions TEXT[] DEFAULT ARRAY['documents:read', 'documents:write'],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id)
);

-- Documents API table
CREATE TABLE IF NOT EXISTS documents_api (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'custom',
    status TEXT DEFAULT 'draft', -- draft, sent, signed, expired, cancelled
    recipient_email TEXT,
    recipient_name TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    signed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    signed_document_url TEXT
);

-- Webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT,
    events TEXT[] NOT NULL, -- document.sent, document.signed, document.expired
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook logs table
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL, -- success, failed
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API request logs table
CREATE TABLE IF NOT EXISTS api_request_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response_time_ms INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Verification logs table (for identity verification)
CREATE TABLE IF NOT EXISTS verification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents_api(id) ON DELETE CASCADE,
    verification_type TEXT NOT NULL, -- identity, document, address
    status TEXT NOT NULL, -- pending, verified, failed
    method TEXT, -- selfie, id_scan, video_call
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}',
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_company ON api_keys(company_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_documents_api_company ON documents_api(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_api_status ON documents_api(status);
CREATE INDEX IF NOT EXISTS idx_webhooks_company ON webhooks(company_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_key ON api_request_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_user ON verification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_document ON verification_logs(document_id);

-- Enable RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_api ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- API Keys: company users can see their own keys
CREATE POLICY api_keys_company_isolation ON api_keys
    FOR ALL USING (company_id IN (
        SELECT company_id FROM users WHERE id = auth.uid()
    ));

-- Documents API: company users can see their documents
CREATE POLICY documents_api_company_isolation ON documents_api
    FOR ALL USING (company_id IN (
        SELECT company_id FROM users WHERE id = auth.uid()
    ));

-- Webhooks: company users can manage their webhooks
CREATE POLICY webhooks_company_isolation ON webhooks
    FOR ALL USING (company_id IN (
        SELECT company_id FROM users WHERE id = auth.uid()
    ));

-- Webhook logs: company users can see their logs
CREATE POLICY webhook_logs_company_isolation ON webhook_logs
    FOR SELECT USING (webhook_id IN (
        SELECT id FROM webhooks WHERE company_id IN (
            SELECT company_id FROM users WHERE id = auth.uid()
        )
    ));

-- API request logs: company users can see their logs
CREATE POLICY api_request_logs_company_isolation ON api_request_logs
    FOR SELECT USING (api_key_id IN (
        SELECT id FROM api_keys WHERE company_id IN (
            SELECT company_id FROM users WHERE id = auth.uid()
        )
    ));

-- Verification logs: company users can see their verification logs
CREATE POLICY verification_logs_company_isolation ON verification_logs
    FOR ALL USING (company_id IN (
        SELECT company_id FROM users WHERE id = auth.uid()
    ));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_documents_api_updated_at BEFORE UPDATE ON documents_api
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL ON api_keys TO authenticated;
GRANT ALL ON documents_api TO authenticated;
GRANT ALL ON webhooks TO authenticated;
GRANT ALL ON webhook_logs TO authenticated;
GRANT ALL ON api_request_logs TO authenticated;
GRANT ALL ON verification_logs TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE api_keys_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE documents_api_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE webhooks_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE webhook_logs_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE api_request_logs_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE verification_logs_id_seq TO authenticated;
