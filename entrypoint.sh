#!/bin/sh
# Production Entrypoint for elongoat
# Handles startup validation, cache warmup, and graceful shutdown

set -e

# ============================================================================
# Configuration
# ============================================================================

# Signal handling for graceful shutdown
trap 'echo "[entrypoint] Received shutdown signal, exiting gracefully"; exit 0' TERM INT

# Health check startup flag
HEALTH_CHECK_FILE="${HEALTH_CHECK_FILE:-/tmp/healthz-ready}"
STARTUP_LOG="${STARTUP_LOG:-/tmp/startup.log}"

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
    echo "[entrypoint] $(date +'%Y-%m-%d %H:%M:%S') INFO: $*"
}

log_error() {
    echo "[entrypoint] $(date +'%Y-%m-%d %H:%M:%S') ERROR: $*" >&2
}

log_success() {
    echo "[entrypoint] $(date +'%Y-%m-%d %H:%M:%S') SUCCESS: $*"
}

# ============================================================================
# Startup Validation
# ============================================================================

validate_environment() {
    if [ "${VALIDATE_ENV_ON_STARTUP:-0}" = "1" ]; then
        log_info "Validating environment variables..."

        local errors=0

        # Check critical variables
        [ -n "${DATABASE_URL:-}" ] || { log_error "DATABASE_URL is not set"; errors=$((errors + 1)); }
        [ -n "${VECTORENGINE_API_KEY:-}" ] || { log_error "VECTORENGINE_API_KEY is not set"; errors=$((errors + 1)); }
        [ -n "${ELONGOAT_ADMIN_TOKEN:-}" ] || { log_error "ELONGOAT_ADMIN_TOKEN is not set"; errors=$((errors + 1)); }
        [ -n "${ELONGOAT_ADMIN_SESSION_SECRET:-}" ] || { log_error "ELONGOAT_ADMIN_SESSION_SECRET is not set"; errors=$((errors + 1)); }
        [ -n "${ELONGOAT_RAG_API_KEY:-}" ] || { log_error "ELONGOAT_RAG_API_KEY is not set"; errors=$((errors + 1)); }
        [ -n "${RATE_LIMIT_IP_SECRET:-}" ] || { log_error "RATE_LIMIT_IP_SECRET is not set"; errors=$((errors + 1)); }

        # Check for placeholder values
        local placeholder_patterns="your_ change_me REPLACE_WITH default_value"
        for var in ELONGOAT_ADMIN_TOKEN ELONGOAT_ADMIN_SESSION_SECRET ELONGOAT_RAG_API_KEY RATE_LIMIT_IP_SECRET; do
            local value
            eval "value=\${$var:-}"
            for pattern in $placeholder_patterns; do
                case "$value" in
                    *"$pattern"*)
                        log_error "$var contains placeholder value"
                        errors=$((errors + 1))
                        ;;
                esac
            done
        done

        if [ "$errors" -gt 0 ]; then
            log_error "Environment validation failed with $errors error(s)"
            exit 1
        fi

        log_success "Environment validation passed"
    fi
}

# ============================================================================
# Cache Warmup
# ============================================================================

warm_cache() {
    if [ "${SKIP_WARMUP:-0}" = "1" ]; then
        log_info "Cache warmup skipped (SKIP_WARMUP=1)"
        return
    fi

    local delay="${WARMUP_DELAY_MS:-10}"
    log_info "Starting cache warmup in ${delay}s..."

    (
        sleep "$delay"

        # Warmup endpoints
        local endpoints="http://localhost:3000/api/healthz http://localhost:3000/api/health http://localhost:3000/api/variables"

        for endpoint in $endpoints; do
            log_info "Warming: $endpoint"
            if command -v wget >/dev/null 2>&1; then
                wget -q -O - --timeout=5 "$endpoint" >/dev/null 2>&1 || true
            elif command -v curl >/dev/null 2>&1; then
                curl -s -o /dev/null --max-time 5 "$endpoint" >/dev/null 2>&1 || true
            fi
        done

        log_success "Cache warmup complete"
        touch "$HEALTH_CHECK_FILE"
    ) &
}

# ============================================================================
# Health Check Setup
# ============================================================================

create_health_check_file() {
    # Create file for readiness probe
    touch "$HEALTH_CHECK_FILE"
}

# ============================================================================
# Main Startup
# ============================================================================

main() {
    log_info "ElonGoat Backend starting..."
    log_info "Node version: $(node --version)"
    log_info "Environment: ${NODE_ENV:-development}"

    # Validate environment
    validate_environment

    # Create health check file
    create_health_check_file

    # Start cache warmup in background
    warm_cache

    # Log startup
    log_info "Starting Node.js server on port ${PORT:-3000}..."

    # Start the Node.js server
    # Using exec to replace shell with node process (proper signal handling)
    exec node server.js
}

# Run main function
main "$@"
