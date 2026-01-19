-- Migration 008: Performance Enhancement Indexes
-- Additional indexes for optimized queries and cache performance

-- ============================================================================
-- Content Cache Performance Enhancements
-- ============================================================================

-- Covering index for content cache lookups by kind and slug
-- Supports common pattern: kind + slug lookups with minimal table access
CREATE INDEX CONCURRENTLY IF NOT EXISTS content_cache_kind_slug_covering_idx
  ON elongoat.content_cache (kind, slug)
  INCLUDE (content_md, generated_at, word_count, model)
  WHERE expires_at IS NULL OR expires_at > NOW();

COMMENT ON INDEX elongoat.content_cache_kind_slug_covering_idx IS
  'Covering index for kind+slug lookups with commonly accessed columns';

-- Index for quality_score filtering (if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'elongoat' AND table_name = 'content_cache' AND column_name = 'quality_score'
  ) THEN
    CREATE INDEX CONCURRENTLY IF NOT EXISTS content_cache_quality_idx
      ON elongoat.content_cache (quality_score DESC NULLS LAST)
      WHERE quality_score IS NOT NULL;
    
    COMMENT ON INDEX elongoat.content_cache_quality_idx IS
      'Index for content quality filtering';
  END IF;
END $$;

-- Partial index for recently generated content (last 7 days)
CREATE INDEX CONCURRENTLY IF NOT EXISTS content_cache_recent_idx
  ON elongoat.content_cache (generated_at DESC)
  WHERE generated_at > NOW() - INTERVAL '7 days';

COMMENT ON INDEX elongoat.content_cache_recent_idx IS
  'Partial index for recent content queries (smaller, faster)';

-- ============================================================================
-- PAA Tree Performance Enhancements
-- ============================================================================

-- Composite index for question search with answer presence
CREATE INDEX CONCURRENTLY IF NOT EXISTS paa_tree_question_answer_idx
  ON elongoat.content_cache (lower(question) text_pattern_ops, length(answer))
  WHERE answer IS NOT NULL;

COMMENT ON INDEX elongoat.content_cache_question_answer_idx IS
  'Index for case-insensitive question searches with answer filtering';

-- ============================================================================
-- Dynamic Variables Performance
-- ============================================================================

-- Partial index for active dynamic variables only
CREATE INDEX CONCURRENTLY IF NOT EXISTS dynamic_variables_active_idx
  ON elongoat.dynamic_variables (key)
  WHERE is_active = true;

COMMENT ON INDEX elongoat.dynamic_variables_active_idx IS
  'Partial index for active dynamic variables (smaller, faster)';

-- ============================================================================
-- Cluster Pages Performance Enhancements
-- ============================================================================

-- Covering index for topic hub pages with SEO metadata
CREATE INDEX CONCURRENTLY IF NOT EXISTS cluster_pages_topic_seo_covering_idx
  ON elongoat.cluster_pages (topic_slug)
  INCLUDE (topic, page_count, total_volume, max_volume)
  WHERE topic_slug IS NOT NULL;

COMMENT ON INDEX elongoat.cluster_pages_topic_seo_covering_idx IS
  'Covering index for topic hub page queries with SEO data';

-- ============================================================================
-- Musk Tweets Performance Enhancements
-- ============================================================================

-- Index for date-based tweet queries with engagement filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS musk_tweets_date_engagement_idx
  ON elongoat.musk_tweets (date DESC, like_count DESC)
  WHERE is_retweet = FALSE;

COMMENT ON INDEX elongoat.musk_tweets_date_engagement_idx IS
  'Index for date-based tweet queries with engagement ordering';

-- Trigram index for fuzzy text search on tweet content
CREATE INDEX CONCURRENTLY IF NOT EXISTS musk_tweets_fulltext_trgm_idx
  ON elongoat.musk_tweets USING GIN (full_text gin_trgm_ops)
  WHERE full_text IS NOT NULL;

COMMENT ON INDEX elongoat.musk_tweets_fulltext_trgm_idx IS
  'Trigram index for fuzzy text search on tweet content';

-- ============================================================================
-- Concurrent Query Optimization
-- ============================================================================

-- Enable parallel query for large tables
ALTER TABLE elongoat.content_cache SET (parallel_workers = 2);
ALTER TABLE elongoat.musk_tweets SET (parallel_workers = 2);
ALTER TABLE elongoat.paa_tree SET (parallel_workers = 2);
ALTER TABLE elongoat.cluster_pages SET (parallel_workers = 2);

-- ============================================================================
-- Statistics Targets
-- ============================================================================

-- Set statistics targets for better query planning
ALTER TABLE elongoat.content_cache ALTER COLUMN slug SET STATISTICS 1000;
ALTER TABLE elongoat.content_cache ALTER COLUMN kind SET STATISTICS 100;
ALTER TABLE elongoat.musk_tweets ALTER COLUMN full_text SET STATISTICS 1000;
ALTER TABLE elongoat.paa_tree ALTER COLUMN question SET STATISTICS 1000;

-- ============================================================================
-- Auto-Vacuum Tuning for High-Traffic Tables
-- ============================================================================

-- Tune autovacuum for content_cache (frequent inserts/updates)
ALTER TABLE elongoat.content_cache SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_threshold = 50
);

-- Tune autovacuum for musk_tweets (mostly inserts, bulk loaded)
ALTER TABLE elongoat.musk_tweets SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_threshold = 200
);

-- ============================================================================
-- Index Statistics Update
-- ============================================================================

ANALYZE elongoat.content_cache;
ANALYZE elongoat.paa_tree;
ANALYZE elongoat.cluster_pages;
ANALYZE elongoat.musk_tweets;
ANALYZE elongoat.dynamic_variables;

-- ============================================================================
-- View for Index Usage Monitoring
-- ============================================================================

CREATE OR REPLACE VIEW elongoat.index_usage_stats AS
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched,
  pg_size_pretty(pg_relation_size(indexrelid::regclass)) as index_size,
  idx_scan::float / GREATEST((SELECT SUM(idx_scan) FROM pg_stat_user_indexes WHERE schemaname = 'elongoat'), 1) as scan_percentage
FROM pg_stat_user_indexes
WHERE schemaname = 'elongoat'
ORDER BY idx_scan DESC NULLS LAST, pg_relation_size(indexrelid::regclass) DESC;

COMMENT ON VIEW elongoat.index_usage_stats IS
  'View for monitoring index usage and effectiveness';

-- ============================================================================
-- Unused Indexes Detection View
-- ============================================================================

CREATE OR REPLACE VIEW elongoat.unused_indexes AS
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  pg_size_pretty(pg_relation_size(indexrelid::regclass)) as index_size,
  indexdef
FROM pg_stat_user_indexes psui
JOIN pg_indexes pi ON psui.indexrelid = pi.indexrelid
WHERE psui.schemaname = 'elongoat'
  AND psui.idx_scan < 50
  AND NOT psui.indexname LIKE '%_pkey'
  AND NOT psui.indexname LIKE '%_unique'
ORDER BY pg_relation_size(psui.indexrelid::regclass) DESC;

COMMENT ON VIEW elongoat.unused_indexes IS
  'View for detecting potentially unused indexes (candidates for removal)';
