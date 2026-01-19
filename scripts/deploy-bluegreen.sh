#!/bin/bash
# Blue-Green Deployment Script for elongoat
# Implements zero-downtime deployments with automatic rollback

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_LOG="${PROJECT_ROOT}/.deploy.log"
ROLLBACK_MARKER="${PROJECT_ROOT}/.rollback_marker"

# Container names
CONTAINER_BASE="standalone-elongoat"
CONTAINER_BLUE="${CONTAINER_BASE}-blue"
CONTAINER_GREEN="${CONTAINER_BASE}-green"
CONTAINER_ACTIVE="${CONTAINER_BASE}"  # Symlink to active container

# Health check configuration
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:3000/api/healthz}"
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-120}"
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-5}"

# Docker configuration
IMAGE_NAME="${IMAGE_NAME:-elongoat-backend}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $*" | tee -a "$DEPLOY_LOG"
}

log_error() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*" | tee -a "$DEPLOY_LOG" >&2
}

log_success() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS: $*" | tee -a "$DEPLOY_LOG"
}

# ============================================================================
# Utility Functions
# ============================================================================

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
}

validate_env() {
    if [ ! -f "${PROJECT_ROOT}/.env" ]; then
        log_error "Missing .env file"
        exit 1
    fi
}

get_active_color() {
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_BLUE}$"; then
        echo "blue"
    elif docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_GREEN}$"; then
        echo "green"
    else
        echo ""
    fi
}

get_inactive_color() {
    local active
    active="$(get_active_color)"
    if [ "$active" = "blue" ]; then
        echo "green"
    elif [ "$active" = "green" ]; then
        echo "blue"
    else
        echo "blue"  # Default to blue for initial deployment
    fi
}

health_check() {
    local container_name="$1"
    local max_attempts=$((HEALTH_CHECK_TIMEOUT / HEALTH_CHECK_INTERVAL))
    local attempt=0

    log_info "Checking health of $container_name..."

    while [ $attempt -lt $max_attempts ]; do
        if docker exec "$container_name" wget -q -O - "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
            log_success "Health check passed for $container_name"
            return 0
        fi

        attempt=$((attempt + 1))
        if [ $attempt -lt $max_attempts ]; then
            sleep "$HEALTH_CHECK_INTERVAL"
        fi
    done

    log_error "Health check failed for $container_name after ${max_attempts} attempts"
    return 1
}

save_rollback_state() {
    local active_color="$1"
    local previous_image="$2"

    cat > "$ROLLBACK_MARKER" << EOF
ACTIVE_COLOR=$active_color
PREVIOUS_IMAGE=$previous_image
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

    log_info "Rollback state saved to $ROLLBACK_MARKER"
}

# ============================================================================
# Build Functions
# ============================================================================

build_image() {
    log_info "Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"

    cd "$PROJECT_ROOT"

    # Build using docker compose
    docker compose build \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --progress=plain

    # Tag the built image
    local built_image
    built_image=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^elongoat' | head -1)

    if [ -n "$built_image" ]; then
        docker tag "$built_image" "${IMAGE_NAME}:${IMAGE_TAG}"
        docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:latest"
        log_success "Image built and tagged as ${IMAGE_NAME}:${IMAGE_TAG}"
    else
        log_error "Failed to find built image"
        exit 1
    fi
}

# ============================================================================
# Deploy Functions
# ============================================================================

deploy_initial() {
    log_info "Performing initial deployment (blue)"

    # Modify docker-compose.yml for initial deployment
    export DEPLOY_COLOR="blue"
    export DEPLOY_PORT=3000

    docker compose -f "$COMPOSE_FILE" -f "${PROJECT_ROOT}/docker-compose.bluegreen.yml" \
        --env-file "${PROJECT_ROOT}/.env" \
        up -d

    if health_check "$CONTAINER_BLUE"; then
        log_success "Initial deployment successful"
        save_rollback_state "blue" ""
    else
        log_error "Initial deployment failed health check"
        docker compose -f "$COMPOSE_FILE" -f "${PROJECT_ROOT}/docker-compose.bluegreen.yml" down
        exit 1
    fi
}

deploy_blue_green() {
    local active_color inactive_color container_name

    active_color="$(get_active_color)"
    inactive_color="$(get_inactive_color)"
    container_name="${CONTAINER_BASE}-${inactive_color}"

    log_info "Active color: $active_color"
    log_info "Inactive color: $inactive_color"
    log_info "Deploying to: $container_name"

    # Save current state for rollback
    local current_image
    current_image=$(docker inspect --format='{{.Config.Image}}' "${CONTAINER_BASE}-${active_color}" 2>/dev/null || echo "")
    save_rollback_state "$active_color" "$current_image"

    # Stop inactive container if it exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        log_info "Stopping existing $container_name"
        docker stop "$container_name" || true
        docker rm "$container_name" || true
    fi

    # Start new container with inactive color
    log_info "Starting new container: $container_name"

    # Create a temporary compose file for the new container
    cat > "${PROJECT_ROOT}/docker-compose.deploy.yml" << EOF
services:
  elongoat:
    container_name: ${container_name}
    image: ${IMAGE_NAME}:${IMAGE_TAG}
    environment:
      - DEPLOY_COLOR=${inactive_color}
    networks:
      - internal
      - proxy-tier
      - supabase_default
      - redis-tier
EOF

    docker compose -f "$COMPOSE_FILE" -f "${PROJECT_ROOT}/docker-compose.deploy.yml" \
        --env-file "${PROJECT_ROOT}/.env" \
        up -d

    # Wait for container to be ready
    sleep 5

    # Health check
    if ! health_check "$container_name"; then
        log_error "New container failed health check, initiating rollback"
        rollback
        exit 1
    fi

    # Switch traffic to new container
    log_info "Switching traffic to $container_name"

    # Update nginx proxy (reload with new VIRTUAL_PORT mapping if needed)
    # For simple docker-compose setup, we just need to ensure the new container
    # has the same VIRTUAL_HOST settings

    # Stop old container
    log_info "Stopping old container: ${CONTAINER_BASE}-${active_color}"
    docker stop "${CONTAINER_BASE}-${active_color}"

    # Verify new container is still healthy
    sleep 2
    if ! health_check "$container_name"; then
        log_error "New container unhealthy after switching traffic, rolling back"
        docker start "${CONTAINER_BASE}-${active_color}"
        exit 1
    fi

    # Clean up old container
    docker rm "${CONTAINER_BASE}-${active_color}" || true

    log_success "Deployment completed successfully"
    rm -f "${PROJECT_ROOT}/docker-compose.deploy.yml"
}

# ============================================================================
# Rollback Functions
# ============================================================================

rollback() {
    log_info "Starting rollback..."

    if [ ! -f "$ROLLBACK_MARKER" ]; then
        log_error "No rollback state found"
        exit 1
    fi

    # Source rollback state
    # shellcheck source=/dev/null
    . "$ROLLBACK_MARKER"

    log_info "Rolling back to $ACTIVE_COLOR (image: $PREVIOUS_IMAGE)"

    local current_active
    current_active="$(get_active_color)"

    # Start previous container
    if [ -n "$PREVIOUS_IMAGE" ]; then
        docker run -d \
            --name "${CONTAINER_BASE}-${ACTIVE_COLOR}" \
            --env-file "${PROJECT_ROOT}/.env" \
            --network "nginx-proxy_default" \
            --restart "unless-stopped" \
            "$PREVIOUS_IMAGE"
    else
        docker start "${CONTAINER_BASE}-${ACTIVE_COLOR}" || true
    fi

    # Stop current container
    if [ -n "$current_active" ]; then
        docker stop "${CONTAINER_BASE}-${current_active}"
    fi

    log_success "Rollback completed"
}

# ============================================================================
# Status Functions
# ============================================================================

show_status() {
    echo "=== Deployment Status ==="
    echo

    local active_color
    active_color="$(get_active_color)"

    if [ -z "$active_color" ]; then
        echo "No active deployment found"
        echo
        return
    fi

    echo "Active Color: $active_color"
    echo "Active Container: ${CONTAINER_BASE}-${active_color}"
    echo

    echo "=== Container Status ==="
    docker ps --filter "name=${CONTAINER_BASE}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo

    echo "=== Health Check ==="
    local health_url="${HEALTH_CHECK_URL}"
    if command -v curl &> /dev/null; then
        curl -s "$health_url" | jq '.' 2>/dev/null || curl -s "$health_url"
    else
        wget -q -O - "$health_url"
    fi
    echo
}

# ============================================================================
# Main
# ============================================================================

main() {
    local command="${1:-deploy}"

    check_docker
    validate_env

    case "$command" in
        deploy)
            build_image

            if [ -z "$(get_active_color)" ]; then
                deploy_initial
            else
                deploy_blue_green
            fi
            ;;
        rollback)
            rollback
            ;;
        status)
            show_status
            ;;
        health-check)
            local active_color
            active_color="$(get_active_color)"
            if [ -n "$active_color" ]; then
                health_check "${CONTAINER_BASE}-${active_color}"
            else
                log_error "No active container found"
                exit 1
            fi
            ;;
        *)
            echo "Usage: $0 {deploy|rollback|status|health-check}"
            exit 1
            ;;
    esac
}

main "$@"
