#!/bin/bash
# Deployment Script for elongoat
# Handles validation, building, and deployment with rollback support

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# ============================================================================
# Pre-flight Checks
# ============================================================================

check_prerequisites() {
    log_info "Running pre-flight checks..."

    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi

    # Check if docker compose is available
    if ! docker compose version &> /dev/null; then
        log_error "docker compose is not available"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

validate_env() {
    log_info "Validating environment configuration..."

    local env_file="${PROJECT_ROOT}/.env"
    local env_example="${PROJECT_ROOT}/.env.example"
    local errors=0

    # Check if .env exists
    if [ ! -f "$env_file" ]; then
        log_error "Missing .env file"
        log_info "Create .env from .env.example: cp .env.example .env"
        exit 1
    fi

    # Load environment variables
    # shellcheck source=/dev/null
    set -a
    # shellcheck source=/dev/null
    source "$env_file"
    set +a

    # Check required variables
    local required_vars=(
        "DATABASE_URL"
        "ELONGOAT_ADMIN_TOKEN"
        "ELONGOAT_ADMIN_SESSION_SECRET"
        "ELONGOAT_RAG_API_KEY"
        "RATE_LIMIT_IP_SECRET"
        "VECTORENGINE_API_KEY"
    )

    for var in "${required_vars[@]}"; do
        if [ -z "${!var:-}" ]; then
            log_error "Missing required variable: $var"
            errors=$((errors + 1))
        fi
    done

    # Check for placeholder/default values
    local placeholder_patterns=(
        "your_"
        "change_me"
        "REPLACE_WITH"
        "default_value"
    )

    for var in "${required_vars[@]}"; do
        local value="${!var:-}"
        for pattern in "${placeholder_patterns[@]}"; do
            if [[ "$value" == *"$pattern"* ]]; then
                log_warning "Variable $var contains placeholder value"
                errors=$((errors + 1))
            fi
        done
    done

    # Validate DATABASE_URL format
    if [ -n "${DATABASE_URL:-}" ]; then
        if [[ ! "$DATABASE_URL" =~ ^postgresql:// ]]; then
            log_error "DATABASE_URL must start with postgresql://"
            errors=$((errors + 1))
        fi
    fi

    # Validate token lengths
    if [ -n "${ELONGOAT_ADMIN_TOKEN:-}" ]; then
        if [ ${#ELONGOAT_ADMIN_TOKEN} -lt 32 ]; then
            log_warning "ELONGOAT_ADMIN_TOKEN should be at least 32 characters"
        fi
    fi

    if [ -n "${RATE_LIMIT_IP_SECRET:-}" ]; then
        if [ ${#RATE_LIMIT_IP_SECRET} -lt 16 ]; then
            log_warning "RATE_LIMIT_IP_SECRET should be at least 16 characters"
        fi
    fi

    if [ $errors -gt 0 ]; then
        log_error "Environment validation failed with $errors error(s)"
        exit 1
    fi

    log_success "Environment validation passed"
}

validate_compose_config() {
    log_info "Validating docker-compose configuration..."

    cd "$PROJECT_ROOT"

    if ! docker compose config > /dev/null 2>&1; then
        log_error "docker-compose.yml validation failed"
        exit 1
    fi

    log_success "Docker Compose configuration is valid"
}

check_networks() {
    log_info "Checking external networks..."

    local networks=(
        "nginx-proxy_default"
        "supabase_default"
        "redis_default"
    )

    for network in "${networks[@]}"; do
        if docker network inspect "$network" > /dev/null 2>&1; then
            log_success "Network $network exists"
        else
            log_warning "Network $network does not exist"
            log_info "Create it with: docker network create $network"
        fi
    done
}

# ============================================================================
# Build Functions
# ============================================================================

build_image() {
    log_info "Building Docker image..."

    cd "$PROJECT_ROOT"

    local build_start
    build_start=$(date +%s)

    # Build with build cache
    if docker compose build --progress=plain; then
        local build_end
        build_end=$(date +%s)
        local duration=$((build_end - build_start))

        log_success "Build completed in ${duration}s"

        # Show image size
        local image_size
        image_size=$(docker images elongoat --format "{{.Size}}" | head -1)
        log_info "Image size: $image_size"
    else
        log_error "Build failed"
        exit 1
    fi
}

# ============================================================================
# Deployment Functions
# ============================================================================

pre_deployment_backup() {
    log_info "Creating pre-deployment backup..."

    local backup_dir="${PROJECT_ROOT}/.backups"
    mkdir -p "$backup_dir"

    # Save current container config
    local timestamp
    timestamp=$(date +"%Y%m%d-%H%M%S")
    local backup_file="${backup_dir}/pre-deploy-${timestamp}.txt"

    {
        echo "# Pre-deployment backup: $timestamp"
        echo "## Current containers"
        docker ps --filter "name=standalone-elongoat" --format "{{.Names}}\t{{.Image}}\t{{.Status}}" || true
        echo
        echo "## Current image"
        docker images elongoat --format "{{.Repository}}:{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}" || true
    } > "$backup_file"

    log_success "Pre-deployment backup saved to $backup_file"
}

deploy() {
    log_info "Starting deployment..."

    cd "$PROJECT_ROOT"

    # Stop existing container
    if docker ps --format '{{.Names}}' | grep -q "^standalone-elongoat$"; then
        log_info "Stopping existing container..."
        docker compose stop
    fi

    # Start new container
    log_info "Starting new container..."
    docker compose up -d

    # Wait for container to be ready
    log_info "Waiting for container to be ready..."
    sleep 10

    # Run health checks
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if curl -sf http://localhost:3000/api/healthz > /dev/null 2>&1; then
            log_success "Container is healthy"
            return 0
        fi

        attempt=$((attempt + 1))
        if [ $attempt -lt $max_attempts ]; then
            sleep 2
        fi
    done

    log_error "Health check failed after ${max_attempts} attempts"

    # Show logs for debugging
    log_info "Recent container logs:"
    docker compose logs --tail 50

    exit 1
}

post_deployment_verify() {
    log_info "Running post-deployment verification..."

    # Health check
    local health_response
    health_response=$(curl -s http://localhost:3000/api/health 2>/dev/null || echo "")

    if [ -n "$health_response" ]; then
        local status
        status=$(echo "$health_response" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")

        if [ "$status" = "healthy" ] || [ "$status" = "degraded" ]; then
            log_success "Health check passed: $status"
        else
            log_warning "Health check status: $status"
        fi
    else
        log_warning "Could not fetch health status"
    fi

    # Check container status
    local container_status
    container_status=$(docker ps --filter "name=standalone-elongoat" --format "{{.Status}}")

    if [ -n "$container_status" ]; then
        log_success "Container status: $container_status"
    else
        log_error "Container is not running"
        exit 1
    fi
}

# ============================================================================
# Rollback Functions
# ============================================================================

rollback() {
    log_info "Initiating rollback..."

    cd "$PROJECT_ROOT"

    # Find most recent pre-deployment backup
    local latest_backup
    latest_backup=$(ls -t "${PROJECT_ROOT}/.backups"/pre-deploy-*.txt 2>/dev/null | head -1)

    if [ -z "$latest_backup" ]; then
        log_error "No backup found for rollback"
        exit 1
    fi

    log_info "Restoring from: $latest_backup"

    # Restart container
    docker compose restart

    log_success "Rollback completed"
}

# ============================================================================
# Status Functions
# ============================================================================

show_status() {
    echo "=== Deployment Status ==="
    echo

    echo "--- Container ---"
    docker ps --filter "name=standalone-elongoat" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo

    echo "--- Health Check ---"
    local health
    health=$(curl -s http://localhost:3000/api/health 2>/dev/null || echo '{"status":"unavailable"}')
    echo "$health" | jq '.' 2>/dev/null || echo "$health"
    echo

    echo "--- Recent Logs ---"
    docker compose logs --tail 20
}

# ============================================================================
# Main
# ============================================================================

usage() {
    cat << EOF
Usage: $0 [COMMAND]

Commands:
  deploy      Full deployment with validation
  build       Build Docker image only
  validate    Run validation checks only
  status      Show deployment status
  rollback    Rollback to previous version
  logs        Show container logs

Options:
  --skip-validation    Skip environment validation (not recommended)
  --no-cache          Build without cache

Examples:
  $0 deploy
  $0 build --no-cache
  $0 status
EOF
}

main() {
    local command="${1:-deploy}"
    shift || true

    local skip_validation=false
    local build_args=()

    # Parse options
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --skip-validation)
                skip_validation=true
                ;;
            --no-cache)
                build_args+=("--no-cache")
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
        shift
    done

    case "$command" in
        deploy)
            check_prerequisites
            if [ "$skip_validation" = false ]; then
                validate_env
                validate_compose_config
                check_networks
            fi
            pre_deployment_backup
            build_image
            deploy
            post_deployment_verify
            log_success "Deployment completed successfully"
            ;;
        build)
            check_prerequisites
            build_image
            ;;
        validate)
            check_prerequisites
            validate_env
            validate_compose_config
            check_networks
            log_success "All validations passed"
            ;;
        status)
            show_status
            ;;
        rollback)
            rollback
            ;;
        logs)
            cd "$PROJECT_ROOT"
            docker compose logs -f --tail=100
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
