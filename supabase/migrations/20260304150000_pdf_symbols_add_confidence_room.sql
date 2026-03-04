-- Add confidence and room columns to pdf_detected_symbols
ALTER TABLE pdf_detected_symbols ADD COLUMN IF NOT EXISTS confidence FLOAT;
ALTER TABLE pdf_detected_symbols ADD COLUMN IF NOT EXISTS room TEXT;
