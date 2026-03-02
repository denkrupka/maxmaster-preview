-- =====================================================
-- Migration: Add new fields to offers table
-- Date: 2026-03-02
-- Description: object_name, object_address, work dates
-- =====================================================

ALTER TABLE offers ADD COLUMN IF NOT EXISTS object_name TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS object_address TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS work_start_date DATE;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS work_end_date DATE;
