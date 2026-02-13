-- Create config table for system-wide settings
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Insert default values if they don't exist
INSERT INTO config (key, value) VALUES 
('maintenance_mode', 'false'),
('maintenance_message', 'The system is currently under maintenance. Please try again later.'),
('broadcast_active', 'false'),
('broadcast_message', ''),
('broadcast_type', 'info'),
('broadcast_updated_at', '0')
ON CONFLICT (key) DO NOTHING;

-- Ensure RLS is enabled or permissions are set correctly (depending on your setup)
-- For simple setup without RLS on this table for admin access via service key:
ALTER TABLE config ENABLE ROW LEVEL SECURITY;

-- Allow read access to everyone (for maintenance checks)
CREATE POLICY "Allow public read access" ON config FOR SELECT USING (true);

-- Allow full access to service role (admin)
CREATE POLICY "Allow service role full access" ON config USING (true) WITH CHECK (true);
