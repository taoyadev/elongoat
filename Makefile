# ElonGoat - Production Deployment Makefile
# Target: /opt/docker-projects/standalone-apps/elongoat

# Configuration
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_DATE ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
VCS_REF ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m

.PHONY: deploy down logs restart validate clean health db-schema db-seed-content \
	backup-db backup-redis restore-db restore-redis monitor help \
	bluegreen rollback

# Default target
.DEFAULT_GOAL := help

# ============================================================================
# Deployment Commands
# ============================================================================

deploy: validate
	@echo "$(BLUE)[INFO]$(NC) Building and deploying ElonGoat..."
	@VERSION=$(VERSION) BUILD_DATE=$(BUILD_DATE) VCS_REF=$(VCS_REF) \
		docker compose up -d --build
	@echo "$(GREEN)[SUCCESS]$(NC) Deployed. Run 'make logs' to check."

## Blue-Green deployment (zero-downtime)
bluegreen:
	@echo "$(BLUE)[INFO]$(NC) Starting blue-green deployment..."
	@bash scripts/deploy-bluegreen.sh deploy

## Rollback to previous version
rollback:
	@echo "$(YELLOW)[WARNING]$(NC) Rolling back to previous version..."
	@bash scripts/deploy-bluegreen.sh rollback

# ============================================================================
# Container Management
# ============================================================================

## Stop all services
down:
	@echo "$(BLUE)[INFO]$(NC) Stopping ElonGoat..."
	@docker compose down

## View logs (follow mode)
logs:
	@docker compose logs -f --tail=100

## Restart (down + up)
restart: down deploy

## Show container status
status:
	@echo "=== Container Status ==="
	@docker ps --filter "name=standalone-elongoat" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
	@echo ""
	@echo "=== Recent Logs ==="
	@docker compose logs --tail=20

# ============================================================================
# Validation
# ============================================================================

## Validate configuration before deploy
validate:
	@echo "$(BLUE)[INFO]$(NC) Validating configuration..."
	@test -f .env || (echo "$(RED)[ERROR]$(NC) Missing .env file" && exit 1)
	@docker compose config > /dev/null || (echo "$(RED)[ERROR]$(NC) Invalid docker-compose.yml" && exit 1)
	@echo "$(GREEN)[SUCCESS]$(NC) Configuration valid"

## Validate environment variables
validate-env:
	@echo "$(BLUE)[INFO]$(NC) Validating environment variables..."
	@bash scripts/deploy.sh validate

# ============================================================================
# Health & Monitoring
# ============================================================================

## Health check
health:
	@echo "$(BLUE)[INFO]$(NC) Checking health..."
	@curl -sf http://localhost:3000/api/healthz || \
		(curl -sf https://$${API_DOMAIN:-api.elongoat.io}/api/healthz || \
		echo "$(RED)[ERROR]$(NC) Health check failed")

## Full health check with diagnostics
health-full:
	@bash scripts/monitor.sh health

## Show application metrics
metrics:
	@bash scripts/monitor.sh metrics

## Run diagnostics
diagnostics:
	@bash scripts/monitor.sh diagnostics

## Watch health continuously
watch:
	@bash scripts/monitor.sh watch ${INTERVAL:-60}

# ============================================================================
# Backup & Restore
# ============================================================================

## Backup database
backup-db:
	@echo "$(BLUE)[INFO]$(NC) Creating database backup..."
	@bash scripts/backup-db.sh backup

## Backup Redis
backup-redis:
	@echo "$(BLUE)[INFO]$(NC) Creating Redis backup..."
	@bash scripts/backup-redis.sh backup

## List all backups
backup-list:
	@echo "=== Database Backups ==="
	@bash scripts/backup-db.sh list
	@echo ""
	@echo "=== Redis Backups ==="
	@bash scripts/backup-redis.sh list

## Restore database (specify file: make restore-db FILE=...)
restore-db:
	@bash scripts/backup-db.sh restore ${FILE}

## Restore Redis (specify file: make restore-redis FILE=...)
restore-redis:
	@bash scripts/backup-redis.sh restore ${FILE}

# ============================================================================
# Database Operations
# ============================================================================

## Apply database schema
db-schema:
	@echo "$(BLUE)[INFO]$(NC) Applying database schema..."
	@test -f .env && export $$(grep -v '^#' .env | xargs) && \
		psql "$$DATABASE_URL" -f backend/supabase/schema.sql
	@echo "$(GREEN)[SUCCESS]$(NC) Schema applied"

## Seed content (PAA answers, sample videos/tweets)
db-seed-content:
	@echo "$(BLUE)[INFO]$(NC) Seeding content..."
	@test -f .env && export $$(cat .env | xargs) && \
		npx tsx backend/scripts/seed_content.ts
	@echo "$(GREEN)[SUCCESS]$(NC) Content seeding complete"

# ============================================================================
# Maintenance
# ============================================================================

## Clean build cache (use with caution)
clean:
	@echo "$(BLUE)[INFO]$(NC) Cleaning build cache..."
	@docker compose down --rmi local --volumes
	@docker image prune -f
	@echo "$(GREEN)[SUCCESS]$(NC) Build cache cleaned"

## Remove orphaned containers and networks
clean-orphaned:
	@echo "$(BLUE)[INFO]$(NC) Cleaning orphaned resources..."
	@docker compose down --remove-orphans
	@echo "$(GREEN)[SUCCESS]$(NC) Cleanup complete"

## Rotate old backups
rotate-backups:
	@bash scripts/backup-db.sh rotate
	@bash scripts/backup-redis.sh rotate

# ============================================================================
# Development (for local testing only - NOT for production)
# ============================================================================

## Development server (local only - DO NOT USE ON PRODUCTION)
dev:
	@echo "$(YELLOW)[WARNING]$(NC) This is for local development only"
	@npm run dev

## Build for production testing (local only)
build-test:
	@echo "$(YELLOW)[WARNING]$(NC) This is for local testing only"
	@docker compose build

# ============================================================================
# Help
# ============================================================================

## Show this help message
help:
	@echo "ElonGoat Deployment Commands"
	@echo ""
	@echo "$(BLUE)Deployment:$(NC)"
	@echo "  make deploy           Standard deployment with validation"
	@echo "  make bluegreen        Blue-green deployment (zero-downtime)"
	@echo "  make rollback         Rollback to previous version"
	@echo "  make restart          Stop and restart services"
	@echo "  make down             Stop all services"
	@echo ""
	@echo "$(BLUE)Validation:$(NC)"
	@echo "  make validate         Validate docker-compose configuration"
	@echo "  make validate-env     Validate environment variables"
	@echo ""
	@echo "$(BLUE)Health & Monitoring:$(NC)"
	@echo "  make health           Quick health check"
	@echo "  make health-full      Full health check with components"
	@echo "  make metrics          Show application metrics"
	@echo "  make diagnostics      Run diagnostic report"
	@echo "  make watch            Watch health (set INTERVAL=N)"
	@echo "  make status           Show container status"
	@echo "  make logs             Follow logs"
	@echo ""
	@echo "$(BLUE)Backup & Restore:$(NC)"
	@echo "  make backup-db        Backup database"
	@echo "  make backup-redis     Backup Redis"
	@echo "  make backup-list      List all backups"
	@echo "  make restore-db       Restore database (FILE=...)"
	@echo "  make restore-redis    Restore Redis (FILE=...)"
	@echo "  make rotate-backups   Rotate old backups"
	@echo ""
	@echo "$(BLUE)Database:$(NC)"
	@echo "  make db-schema        Apply database schema"
	@echo "  make db-seed-content  Seed content"
	@echo ""
	@echo "$(BLUE)Maintenance:$(NC)"
	@echo "  make clean            Clean build cache"
	@echo "  make clean-orphaned   Remove orphaned resources"
