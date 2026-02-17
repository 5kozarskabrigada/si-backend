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

-- Admin Tasks Table
CREATE TABLE IF NOT EXISTS admin_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL, -- e.g., 'clicks', 'score', 'referral', 'manual'
  target_value NUMERIC NOT NULL DEFAULT 0,
  reward_type TEXT NOT NULL DEFAULT 'coins', -- 'coins' or 'present'
  reward_amount NUMERIC NOT NULL DEFAULT 0,
  task_url TEXT, -- URL for social/manual tasks
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Task Progress Table
CREATE TABLE IF NOT EXISTS user_task_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES players(user_id),
  task_id UUID NOT NULL REFERENCES admin_tasks(id),
  progress NUMERIC DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  claimed BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, task_id)
);

-- RLS for Tasks
ALTER TABLE admin_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read active tasks" ON admin_tasks FOR SELECT USING (is_active = true);
CREATE POLICY "Service role full access tasks" ON admin_tasks USING (true) WITH CHECK (true);

-- RLS for Progress
ALTER TABLE user_task_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own progress" ON user_task_progress FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "Users can update own progress" ON user_task_progress FOR UPDATE USING (auth.uid()::text = user_id);
CREATE POLICY "Service role full access progress" ON user_task_progress USING (true) WITH CHECK (true);
