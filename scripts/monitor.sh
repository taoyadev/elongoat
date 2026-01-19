#!/bin/bash
# Monitoring Script for elongoat
# Provides health checks, metrics collection, and alerting

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Health check endpoints
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
HEALTHZ_URL="${HEALTHZ_URL:-http://localhost:3000/api/healthz}"
METRICS_URL="${METRICS_URL:-http://localhost:3000/api/metrics}"

# Alert thresholds
ALERT_MEMORY_PERCENT="${ALERT_MEMORY_PERCENT:-80}"
ALERT_CPU_PERCENT="${ALERT_CPU_PERCENT:-80}"
ALERT_RESPONSE_TIME_MS="${ALERT_RESPONSE_TIME_MS:-1000}"
ALERT_ERROR_RATE="${ALERT_ERROR_RATE:-0.05}"

# Alert configuration
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
EMAIL_ALERTS="${EMAIL_ALERTS:-}"

# Container name
CONTAINER_NAME="${CONTAINER_NAME:-standalone-elongoat}"

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $*"
}

log_error() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

log_warning() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $*"
}

# ============================================================================
# Health Check Functions
# ============================================================================

check_container_running() {
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "Container $CONTAINER_NAME is not running"
        return 1
    fi
    return 0
}

check_liveness() {
    local response
    local status_code

    response=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTHZ_URL" 2>/dev/null || echo "000")
    status_code=$response

    if [ "$status_code" = "200" ]; then
        log_info "Liveness check: OK"
        return 0
    else
        log_error "Liveness check: FAILED (HTTP $status_code)"
        return 1
    fi
}

check_readiness() {
    local response
    local start_time
    local duration

    start_time=$(date +%s%3N)
    response=$(curl -s "$HEALTH_URL" 2>/dev/null)
    duration=$(($(date +%s%3N) - start_time))

    if [ -z "$response" ]; then
        log_error "Readiness check: FAILED (no response)"
        return 1
    fi

    local overall_status
    overall_status=$(echo "$response" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")

    if [ "$overall_status" = "healthy" ]; then
        log_info "Readiness check: OK (${duration}ms)"
        return 0
    elif [ "$overall_status" = "degraded" ]; then
        log_warning "Readiness check: DEGRADED (${duration}ms)"
        return 0
    else
        log_error "Readiness check: FAILED (status: $overall_status, ${duration}ms)"
        return 1
    fi
}

# ============================================================================
# Component Health Functions
# ============================================================================

check_database_health() {
    local response
    response=$(curl -s "$HEALTH_URL" 2>/dev/null)

    local db_status
    db_status=$(echo "$response" | jq -r '.components.database.status // "unknown"' 2>/dev/null || echo "unknown")
    local db_latency
    db_latency=$(echo "$response" | jq -r '.components.database.latency // "null"' 2>/dev/null || echo "null")

    case "$db_status" in
        healthy)
            log_info "Database: OK (${db_latency}ms)"
            return 0
            ;;
        degraded)
            log_warning "Database: DEGRADED (${db_latency}ms)"
            return 0
            ;;
        unhealthy)
            log_error "Database: UNHEALTHY"
            return 1
            ;;
        disabled)
            log_info "Database: DISABLED"
            return 0
            ;;
        *)
            log_error "Database: UNKNOWN ($db_status)"
            return 1
            ;;
    esac
}

check_redis_health() {
    local response
    response=$(curl -s "$HEALTH_URL" 2>/dev/null)

    local redis_status
    redis_status=$(echo "$response" | jq -r '.components.redis.status // "unknown"' 2>/dev/null || echo "unknown")
    local redis_latency
    redis_latency=$(echo "$response" | jq -r '.components.redis.latency // "null"' 2>/dev/null || echo "null")

    case "$redis_status" in
        healthy)
            log_info "Redis: OK (${redis_latency}ms)"
            return 0
            ;;
        degraded)
            log_warning "Redis: DEGRADED (${redis_latency}ms)"
            return 0
            ;;
        unhealthy)
            log_error "Redis: UNHEALTHY"
            return 1
            ;;
        disabled)
            log_info "Redis: DISABLED"
            return 0
            ;;
        *)
            log_error "Redis: UNKNOWN ($redis_status)"
            return 1
            ;;
    esac
}

check_vector_engine_health() {
    local response
    response=$(curl -s "$HEALTH_URL" 2>/dev/null)

    local ve_status
    ve_status=$(echo "$response" | jq -r '.components.vectorEngine.status // "unknown"' 2>/dev/null || echo "unknown")
    local ve_latency
    ve_latency=$(echo "$response" | jq -r '.components.vectorEngine.latency // "null"' 2>/dev/null || echo "null")

    case "$ve_status" in
        healthy)
            log_info "VectorEngine: OK (${ve_latency}ms)"
            return 0
            ;;
        degraded)
            log_warning "VectorEngine: DEGRADED (${ve_latency}ms)"
            return 0
            ;;
        unhealthy)
            log_error "VectorEngine: UNHEALTHY"
            return 1
            ;;
        disabled)
            log_info "VectorEngine: DISABLED"
            return 0
            ;;
        *)
            log_error "VectorEngine: UNKNOWN ($ve_status)"
            return 1
            ;;
    esac
}

# ============================================================================
# Resource Monitoring Functions
# ============================================================================

check_memory_usage() {
    local stats
    stats=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemUsage}}" 2>/dev/null || echo "")

    if [ -z "$stats" ]; then
        log_error "Could not get memory stats"
        return 1
    fi

    local current_mb total_mb percent
    current_mb=$(echo "$stats" | awk '{print $1}' | sed 's/MiB//')
    total_mb=$(echo "$stats" | awk '{print $3}' | sed 's/MiB//')

    if [ -n "$total_mb" ] && [ "$total_mb" -gt 0 ]; then
        percent=$((current_mb * 100 / total_mb))

        log_info "Memory: ${current_mb}MiB / ${total_mb}MiB (${percent}%)"

        if [ "$percent" -ge "$ALERT_MEMORY_PERCENT" ]; then
            log_warning "Memory usage above threshold: ${percent}% >= ${ALERT_MEMORY_PERCENT}%"
            return 1
        fi
        return 0
    fi

    return 1
}

check_cpu_usage() {
    local stats
    stats=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.CPUPerc}}" 2>/dev/null || echo "")

    if [ -z "$stats" ]; then
        log_error "Could not get CPU stats"
        return 1
    fi

    local percent
    percent=$(echo "$stats" | sed 's/%//')

    log_info "CPU: ${percent}%"

    # Convert to integer for comparison
    local percent_int
    percent_int=$(echo "$percent" | cut -d. -f1)

    if [ -n "$percent_int" ] && [ "$percent_int" -ge "$ALERT_CPU_PERCENT" ]; then
        log_warning "CPU usage above threshold: ${percent}% >= ${ALERT_CPU_PERCENT}%"
        return 1
    fi

    return 0
}

check_disk_usage() {
    local usage
    usage=$(df -h "$PROJECT_ROOT" | tail -1 | awk '{print $5}' | sed 's/%//')

    log_info "Disk: ${usage}% used"

    if [ "$usage" -ge 80 ]; then
        log_warning "Disk usage high: ${usage}%"
        return 1
    fi

    return 0
}

# ============================================================================
# Alert Functions
# ============================================================================

send_slack_alert() {
    local message="$1"
    local color="${2:-danger}"

    if [ -z "$SLACK_WEBHOOK_URL" ]; then
        return
    fi

    local payload
    payload=$(jq -n \
        --arg text "[$CONTAINER_NAME] Alert" \
        --arg color "$color" \
        --arg message "$message" \
        '{
            attachments: [{
                color: $color,
                text: $message,
                footer: "elongoat monitor",
                ts: ((now | floor) | tostring)
            }]
        }')

    curl -s -X POST "$SLACK_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "$payload" > /dev/null 2>&1 || true
}

send_alert() {
    local severity="$1"
    local message="$2"
    local color

    case "$severity" in
        critical) color="danger" ;;
        warning) color="warning" ;;
        info) color="good" ;;
        *) color="danger" ;;
    esac

    log_info "Sending alert: [$severity] $message"

    # Slack alert
    send_slack_alert "$message" "$color"

    # Email alert (if configured)
    if [ -n "$EMAIL_ALERTS" ]; then
        echo "$message" | mail -s "[$CONTAINER_NAME] $severity alert" "$EMAIL_ALERTS" 2>/dev/null || true
    fi
}

# ============================================================================
# Metrics Functions
# ============================================================================

collect_metrics() {
    local response
    response=$(curl -s "$METRICS_URL" 2>/dev/null)

    if [ -z "$response" ]; then
        log_error "Could not collect metrics"
        return 1
    fi

    echo "$response"
}

show_metrics() {
    echo "=== Application Metrics ==="
    echo

    local metrics
    metrics=$(collect_metrics)

    if [ -n "$metrics" ]; then
        echo "$metrics"
    else
        echo "No metrics available"
    fi

    echo
    echo "=== Container Stats ==="
    echo
    docker stats "$CONTAINER_NAME" --no-stream
}

# ============================================================================
# Main Commands
# ============================================================================

health_check() {
    local exit_code=0

    echo "=== Health Check Report ==="
    echo "Container: $CONTAINER_NAME"
    echo "Time: $(date)"
    echo

    # Container status
    if ! check_container_running; then
        send_alert "critical" "Container $CONTAINER_NAME is not running"
        exit 1
    fi

    # Liveness
    if ! check_liveness; then
        send_alert "critical" "Liveness check failed for $CONTAINER_NAME"
        exit 1
    fi

    # Readiness
    if ! check_readiness; then
        send_alert "critical" "Readiness check failed for $CONTAINER_NAME"
        exit 1
    fi

    echo
    echo "=== Component Health ==="

    # Component checks
    check_database_health || exit_code=1
    check_redis_health || exit_code=1
    check_vector_engine_health || exit_code=1

    echo
    echo "=== Resource Usage ==="

    # Resource checks
    check_memory_usage || true
    check_cpu_usage || true
    check_disk_usage || true

    return $exit_code
}

watch_health() {
    local interval="${1:-60}"

    log_info "Watching health every ${interval}s (Ctrl+C to stop)"

    while true; do
        health_check
        echo
        echo "---"
        echo

        sleep "$interval"
    done
}

run_diagnostics() {
    echo "=== Diagnostic Report ==="
    echo

    # Container info
    echo "--- Container Info ---"
    docker inspect "$CONTAINER_NAME" | jq '.[0] | {
        Name: .Name,
        Image: .Config.Image,
        State: .State.Status,
        Created: .Created,
        RestartCount: .RestartCount
    }' 2>/dev/null || echo "Could not inspect container"
    echo

    # Recent logs
    echo "--- Recent Logs (last 50 lines) ---"
    docker logs --tail 50 "$CONTAINER_NAME" 2>&1
    echo

    # Network connectivity
    echo "--- Network Connectivity ---"
    docker exec "$CONTAINER_NAME" wget -q -O - "$HEALTHZ_URL" 2>&1 | jq . || echo "Could not fetch health from inside container"
    echo

    # Process info
    echo "--- Process Info ---"
    docker exec "$CONTAINER_NAME" ps aux | head -20 || true
    echo
}

# ============================================================================
# Main
# ============================================================================

usage() {
    cat << EOF
Usage: $0 [COMMAND] [OPTIONS]

Commands:
  health          Run full health check
  watch [SEC]     Watch health continuously (default: 60s interval)
  metrics         Show application metrics
  diagnostics     Run diagnostic report

Environment Variables:
  HEALTH_URL      Full health check endpoint (default: http://localhost:3000/api/health)
  HEALTHZ_URL     Liveness endpoint (default: http://localhost:3000/api/healthz)
  METRICS_URL     Metrics endpoint (default: http://localhost:3000/api/metrics)
  CONTAINER_NAME  Container name (default: standalone-elongoat)

  SLACK_WEBHOOK_URL  Slack webhook for alerts (optional)
  EMAIL_ALERTS       Email address for alerts (optional)

  ALERT_MEMORY_PERCENT   Memory alert threshold % (default: 80)
  ALERT_CPU_PERCENT      CPU alert threshold % (default: 80)

Examples:
  $0 health
  $0 watch 30
  $0 metrics
  $0 diagnostics
EOF
}

main() {
    local command="${1:-health}"

    case "$command" in
        health)
            health_check
            ;;
        watch)
            watch_health "${2:-60}"
            ;;
        metrics)
            show_metrics
            ;;
        diagnostics)
            run_diagnostics
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
