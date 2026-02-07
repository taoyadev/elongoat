-- Migration 008: Performance Optimization Indexes
-- Additional indexes for improved query performance and Core Web Vitals

-- ============================================================================
-- Content Cache Performance Indexes
-- ============================================================================

-- Partial index for active (non-expired) content by kind
-- Optimizes the most common query pattern: get content by kind where not expired
CREATE INDEX CONCURRENTLY IF NOT EXISTS content_cache_active_kind_idx
  ON elongoat.content_cache (kind, slug)
  WHERE expires_at IS NULL OR expires_at > NOW();

COMMENT ON INDEX elongoat.content_cache_active_kind_idx IS
  'Partial index for active content lookups by kind';

-- ============================================================================
-- Tweet Search Performance Indexes
-- ============================================================================

-- GIN index for full-text search on tweet content
-- Dramatically improves LIKE '%keyword%' queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS musk_tweets_content_gin_idx
  ON elongoat.musk_tweets USING GIN (to_tsvector('english', content));

COMMENT ON INDEX elongoat.musk_tweets_content_gin_idx IS
  'GIN index for full-text search on tweet content';

-- Composite index for popular tweets by date range
CREATE INDEX CONCURRENTLY IF NOT EXISTS musk_tweets_popular_date_idx
  ON elongoat.musk_tweets (created_at DESC, like_count DESC)
  WHERE is_retweet = FALSE;

COMMENT ON INDEX elongoat.musk_tweets_popular_date_idx IS
  'Index for fetching popular original tweets by date';

-- ============================================================================
-- PAA Tree Performance Indexes
-- ============================================================================

-- GIN index for full-text search on questions
CREATE INDEX CONCURRENTLY IF NOT EXISTS paa_tree_question_gin_idx
  ON elongoat.paa_tree USING GIN (to_tsvector('english', question));

COMMENT ON INDEX elongoat.paa_tree_question_gin_idx IS
  'GIN index for full-text search on PAA questions';

-- ============================================================================
-- Cluster Pages Performance Indexes
-- ============================================================================

-- GIN index for full-text search on page titles
CREATE INDEX CONCURRENTLY IF NOT EXISTS cluster_pages_page_gin_idx
  ON elongoat.cluster_pages USING GIN (to_tsvector('english', page));

COMMENT ON INDEX elongoat.cluster_pages_page_gin_idx IS
  'GIN index for full-text search on cluster page titles';

-- ============================================================================
-- Connection and Query Optimization Settings
-- ============================================================================

-- Optimize for read-heavy workloads
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET maintenance_work_mem = '256MB';

-- Optimize for SSD storage
ALTER SYSTEM SET seq_page_cost = 1.0;

-- Reload configuration
SELECT pg_reload_conf();

-- ============================================================================
-- Statistics Update
-- ============================================================================

ANALYZE elongoat.content_cache;
ANALYZE elongoat.musk_tweets;
ANALYZE elongoat.paa_tree;
ANALYZE elongoat.cluster_pages;
