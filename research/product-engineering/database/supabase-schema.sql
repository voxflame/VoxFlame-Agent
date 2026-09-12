-- ========================================
-- VoxFlame Agent - Supabase Database Schema
-- ========================================
-- 为构音障碍患者设计的AI会话支持人
-- Backend中心化数据库，用于用户管理、会话记录和记忆分析

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector for semantic search (if available)
-- CREATE EXTENSION IF NOT EXISTS vector;

-- ========================================
-- Table 1: user_profiles (用户档案)
-- ========================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100),
  age INTEGER,
  condition TEXT, -- 病情描述 (如"构音障碍")
  hotwords TEXT[], -- 用户常用热词数组
  preferences JSONB DEFAULT '{}'::jsonb, -- 用户偏好设置 (语速、音色等)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX idx_user_profiles_created_at ON user_profiles(created_at DESC);

-- ========================================
-- Table 2: sessions (会话记录)
-- ========================================
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  duration INTEGER, -- 会话时长 (秒)
  transcript TEXT, -- 完整对话文本
  metadata JSONB DEFAULT '{}'::jsonb, -- 额外元数据 (如情绪分析、关键事件)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_start_time ON sessions(start_time DESC);
CREATE INDEX idx_sessions_user_start ON sessions(user_id, start_time DESC);

-- ========================================
-- Table 3: memories (记忆存储)
-- ========================================
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL, -- 记忆内容
  metadata JSONB DEFAULT '{}'::jsonb, -- 记忆元数据 (重要性、类型等)
  -- embedding VECTOR(1536), -- Embedding for semantic search (if pgvector is enabled)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_session_id ON memories(session_id);
CREATE INDEX idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX idx_memories_user_created ON memories(user_id, created_at DESC);

-- Full-text search index for Chinese content
CREATE INDEX idx_memories_content_fulltext ON memories USING gin(to_tsvector('simple', content));

-- If pgvector is enabled, create index for semantic search:
-- CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ========================================
-- Table 4: tool_executions (工具执行记录)
-- ========================================
CREATE TABLE IF NOT EXISTS tool_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  tool_name VARCHAR(100) NOT NULL, -- 工具名称 (如 "make_phone_call", "control_smart_device")
  parameters JSONB DEFAULT '{}'::jsonb, -- 工具参数
  result JSONB DEFAULT '{}'::jsonb, -- 执行结果
  status VARCHAR(20) DEFAULT 'pending', -- pending, success, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for analytics
CREATE INDEX idx_tool_executions_user_id ON tool_executions(user_id);
CREATE INDEX idx_tool_executions_session_id ON tool_executions(session_id);
CREATE INDEX idx_tool_executions_tool_name ON tool_executions(tool_name);
CREATE INDEX idx_tool_executions_created_at ON tool_executions(created_at DESC);

-- ========================================
-- Function: Update updated_at timestamp
-- ========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_profiles
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for memories
CREATE TRIGGER update_memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- Function: Extract hotwords from sessions
-- ========================================
CREATE OR REPLACE FUNCTION extract_user_hotwords(p_user_id UUID, p_limit INTEGER DEFAULT 20)
RETURNS TABLE(word TEXT, frequency BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH recent_sessions AS (
    SELECT transcript
    FROM sessions
    WHERE user_id = p_user_id
      AND transcript IS NOT NULL
      AND end_time IS NOT NULL
    ORDER BY start_time DESC
    LIMIT 20
  ),
  all_words AS (
    SELECT unnest(regexp_matches(transcript, '[\u4e00-\u9fa5]{2,4}', 'g')) AS word
    FROM recent_sessions
  )
  SELECT word, COUNT(*) AS frequency
  FROM all_words
  GROUP BY word
  ORDER BY frequency DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Sample Data (Optional - for testing)
-- ========================================
-- INSERT INTO user_profiles (name, age, condition, hotwords, preferences)
-- VALUES (
--   '张伟',
--   65,
--   '构音障碍 (中度)',
--   ARRAY['喝水', '吃饭', '打电话', '开灯', '关灯'],
--   '{"voice": "中文女", "speed": 0.9, "volume": 1.0}'::jsonb
-- );

-- ========================================
-- Row Level Security (RLS) Policies
-- ========================================
-- Uncomment and configure if you want RLS enabled:

-- ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;

-- Example policy: Users can only access their own data
-- CREATE POLICY "Users can view own profile" ON user_profiles
--   FOR SELECT USING (auth.uid() = id);

-- CREATE POLICY "Users can view own sessions" ON sessions
--   FOR SELECT USING (auth.uid() = user_id);

-- CREATE POLICY "Users can view own memories" ON memories
--   FOR SELECT USING (auth.uid() = user_id);

-- CREATE POLICY "Users can view own tool executions" ON tool_executions
--   FOR SELECT USING (auth.uid() = user_id);

-- ========================================
-- Views for Analytics
-- ========================================
CREATE OR REPLACE VIEW user_session_stats AS
SELECT 
  user_id,
  COUNT(*) as total_sessions,
  SUM(duration) as total_duration_seconds,
  AVG(duration) as avg_session_duration_seconds,
  MAX(start_time) as last_session_time,
  MIN(start_time) as first_session_time
FROM sessions
WHERE end_time IS NOT NULL
GROUP BY user_id;

CREATE OR REPLACE VIEW user_memory_stats AS
SELECT 
  user_id,
  COUNT(*) as total_memories,
  COUNT(DISTINCT session_id) as sessions_with_memories,
  MAX(created_at) as last_memory_created
FROM memories
GROUP BY user_id;

CREATE OR REPLACE VIEW tool_usage_stats AS
SELECT 
  tool_name,
  COUNT(*) as total_executions,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_executions,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_executions
FROM tool_executions
GROUP BY tool_name
ORDER BY total_executions DESC;

-- ========================================
-- Grants (if needed)
-- ========================================
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- ========================================
-- End of Schema
-- ========================================
