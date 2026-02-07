-- P2 Performance Optimization Indexes
-- Migration: 009_p2_performance_indexes.sql
-- Purpose: Add composite and partial indexes for improved query performance

-- ============================================================================
-- Content Cache Optimizations
-- ============================================================================

-- Composite index for cache lookups by kind and slug (most common query pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS content_cache_kind_slug_idx
  ON elongoat.content_cache(kind, slug);

-- Partial index for active (non-expired) content - reduces index size significantly
CREATE INDEX CONCURRENTLY IF NOT EXISTS content_cache_active_idx
  ON elongoat.content_cache(kind, slug)
  WHERE expires_at IS NULL OR expires_at > now();

-- GIN index for JSONB sources column (enables efficient JSON queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS content_cache_sources_gin_idx
  ON elongoat.content_cache USING gin(sources);

-- ============================================================================
-- PAA Tree Optimizations
-- ============================================================================

-- Trigram index for fuzzy text search on questions
-- Requires pg_trgm extension (already enabled in schema.sql)
CREATE INDEX CONCURRENTLY IF NOT EXISTS paa_tree_question_trgm_idx
  ON elongoat.paa_tree USING gin(question gin_trgm_ops);

-- Index for parent_id lookups (tree traversal)
CREATE INDEX CONCURRENTLY IF NOT EXISTS paa_tree_parent_idx
  ON elongoat.paa_tree(parent_id)
  WHERE parent_id IS NOT NULL;

-- ============================================================================
-- Musk Tweets Optimizations
-- ============================================================================

-- Full-text search index on tweet content
CREATE INDEX CONCURRENTLY IF NOT EXISTS musk_tweets_content_fts_idx
  ON elongoat.musk_tweets USING gin(to_tsvector('english', content));

-- Index for date range queries (common for archive browsing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS musk_tweets_created_at_idx
  ON elongoat.musk_tweets(created_at DESC);

-- Composite index for popular tweets (engagement sorting)
CREATE INDEX CONCURRENTLY IF NOT EXISTS musk_tweets_engagement_idx
  ON elongoat.musk_tweets(likes DESC, retweets DESC, replies DESC);

-- ============================================================================
-- Cluster Pages Optimizations
-- ============================================================================

-- Index for topic lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS cluster_pages_topic_idx
  ON elongoat.cluster_pages(topic);

-- Composite index for topic + page slug lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS cluster_pages_topic_page_idx
  ON elongoat.cluster_pages(topic, page);

-- ============================================================================
-- PostgreSQL Performance Tuning
-- ============================================================================

-- Analyze tables to update statistics after index creation
ANALYZE elongoat.content_cache;
ANALYZE elongoat.paa_tree;
ANALYZE elongoat.musk_tweets;
ANALYZE elongoat.cluster_pages;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON INDEX elongoat.content_cache_kind_slug_idx IS 'Composite index for cache lookups by kind and slug';
COMMENT ON INDEX elongoat.content_cache_active_idx IS 'Partial index for non-expired content only';
COMMENT ON INDEX elongoat.content_cache_sources_gin_idx IS 'GIN index for JSONB sources queries';
COMMENT ON INDEX elongoat.paa_tree_question_trgm_idx IS 'Trigram index for fuzzy question search';
COMMENT ON INDEX elongoat.musk_tweets_content_fts_idx IS 'Full-text search index on tweet content';
COMMENT ON INDEX elongoat.musk_tweets_engagement_idx IS 'Composite index for engagement-based sorting';
