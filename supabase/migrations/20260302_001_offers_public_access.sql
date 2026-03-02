-- =====================================================
-- Migration: Public access policies for Offers module
-- Date: 2026-03-02
-- Description: Allow anonymous users to view public offers
--              and track views / accept / reject
-- =====================================================

-- Allow anon to read offers by public_token
CREATE POLICY "offers_public_read" ON offers
  FOR SELECT TO anon
  USING (public_token IS NOT NULL AND deleted_at IS NULL);

-- Allow anon to read offer sections for public offers
CREATE POLICY "offer_sections_public_read" ON offer_sections
  FOR SELECT TO anon
  USING (offer_id IN (SELECT id FROM offers WHERE public_token IS NOT NULL AND deleted_at IS NULL));

-- Allow anon to read offer items for public offers
CREATE POLICY "offer_items_public_read" ON offer_items
  FOR SELECT TO anon
  USING (offer_id IN (SELECT id FROM offers WHERE public_token IS NOT NULL AND deleted_at IS NULL));

-- Allow anon to read company info for public offers
CREATE POLICY "companies_public_read" ON companies
  FOR SELECT TO anon
  USING (id IN (SELECT company_id FROM offers WHERE public_token IS NOT NULL AND deleted_at IS NULL));

-- Allow anon to read contractor (client) name for public offers
CREATE POLICY "contractors_public_read" ON contractors
  FOR SELECT TO anon
  USING (id IN (SELECT client_id FROM offers WHERE public_token IS NOT NULL AND deleted_at IS NULL));

-- Allow anon to UPDATE offers (viewed_at, viewed_count, status, accepted_at, rejection_reason)
CREATE POLICY "offers_public_track_view" ON offers
  FOR UPDATE TO anon
  USING (public_token IS NOT NULL AND deleted_at IS NULL)
  WITH CHECK (public_token IS NOT NULL AND deleted_at IS NULL);

-- Grant table-level permissions to anon role
GRANT SELECT ON offers TO anon;
GRANT SELECT ON offer_sections TO anon;
GRANT SELECT ON offer_items TO anon;
GRANT SELECT ON companies TO anon;
GRANT SELECT ON contractors TO anon;
GRANT UPDATE ON offers TO anon;
