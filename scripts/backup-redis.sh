#!/bin/bash
# Redis Backup Script for elongoat
# Supports RDB snapshotting and automatic rotation

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups/redis}"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Load environment
if [ -f "${PROJECT_ROOT}/.env" ]; then
    # shellcheck source=/dev/null
    export "$(grep -v '^#' "${PROJECT_ROOT}/.env" | grep -v '^$' | xargs)"
fi

REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-elongoat/backups/redis}"

# Parse REDIS_URL
# Format: redis://[password@]host:port/db
REDIS_HOST="redis"
REDIS_PORT="6379"
REDIS_PASSWORD=""

if [[ "$REDIS_URL" =~ redis://([^@]*)@([^:]+):([0-9]+)/([0-9]+) ]]; then
    REDIS_PASSWORD="${BASH_REMATCH[1]}"
    REDIS_HOST="${BASH_REMATCH[2]}"
    REDIS_PORT="${BASH_REMATCH[3]}"
    REDIS_DB="${BASH_REMATCH[4]}"
elif [[ "$REDIS_URL" =~ redis://([^:]+):([0-9]+)/([0-9]+) ]]; then
    REDIS_HOST="${BASH_REMATCH[1]}"
    REDIS_PORT="${BASH_REMATCH[2]}"
    REDIS_DB="${BASH_REMATCH[3]}"
elif [[ "$REDIS_URL" =~ redis://([^:]+):([0-9]+) ]]; then
    REDIS_HOST="${BASH_REMATCH[1]}"
    REDIS_PORT="${BASH_REMATCH[2]}"
fi

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $*"
}

log_error() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

log_success() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS: $*"
}

# ============================================================================
# Validation Functions
# ============================================================================

check_dependencies() {
    local missing_deps=()

    command -v redis-cli >/dev/null 2>&1 || missing_deps+=("redis-tools")

    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        log_info "Install with: apt-get install ${missing_deps[*]}"
        exit 1
    fi
}

# ============================================================================
# Backup Functions
# ============================================================================

create_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        mkdir -p "$BACKUP_DIR"
        log_info "Created backup directory: $BACKUP_DIR"
    fi
}

perform_backup() {
    local backup_file="${BACKUP_DIR}/redis-backup-${TIMESTAMP}.rdb"
    local backup_start
    backup_start=$(date +%s)

    log_info "Starting Redis backup..."
    log_info "Redis host: $REDIS_HOST:$REDIS_PORT"
    log_info "Backup file: $backup_file"

    # Build redis-cli command
    local redis_cmd="redis-cli -h $REDIS_HOST -p $REDIS_PORT"
    if [ -n "$REDIS_PASSWORD" ]; then
        redis_cmd="$redis_cmd -a $REDIS_PASSWORD --no-auth-warning"
    fi

    # Trigger background save and wait for completion
    log_info "Triggering background save..."

    if $redis_cmd BGSAVE >/dev/null 2>&1; then
        # Wait for save to complete
        local max_wait=300
        local waited=0

        while [ $waited -lt $max_wait ]; do
            local lastsave
            lastsave=$($redis_cmd LASTSAVE 2>/dev/null | tr -d '\r' || echo "")
            local persistence
            persistence=$($redis_cmd INFO persistence 2>/dev/null | grep -i "rdb_bgsave_in_progress" | cut -d: -f2 | tr -d '\r' || echo "0")

            if [ "$persistence" = "0" ]; then
                break
            fi

            sleep 2
            waited=$((waited + 2))
        done

        # If Redis is running in a container, we need to copy the RDB file
        # Check if we can access the RDB file directly
        if docker ps --format '{{.Names}}' | grep -q "^redis$"; then
            log_info "Copying RDB file from Redis container..."

            if docker exec redis redis-cli --rdb - > "$backup_file" 2>/dev/null; then
                local backup_end
                backup_end=$(date +%s)
                local duration=$((backup_end - backup_start))
                local file_size
                file_size=$(du -h "$backup_file" | cut -f1)

                log_success "Backup completed in ${duration}s"
                log_info "Backup size: $file_size"

                # Generate checksum
                if command -v sha256sum >/dev/null 2>&1; then
                    sha256sum "$backup_file" > "${backup_file}.sha256"
                    log_info "Checksum: $(cat "${backup_file}.sha256" | cut -d' ' -f1)"
                fi

                echo "$backup_file"
                return
            fi
        fi

        # Fallback: use redis-cli --rdb or key-value dump
        log_info "Using key-value dump as fallback..."

        # Get all keys and dump them
        local temp_file="${BACKUP_DIR}/redis-dump-${TIMESTAMP}.txt"
        $redis_cmd --scan > "$temp_file" 2>/dev/null || true

        # Create a JSON dump of all keys
        local dump_file="${BACKUP_DIR}/redis-backup-${TIMESTAMP}.json"
        echo "{" > "$dump_file"

        local first=true
        while IFS= read -r key; do
            if [ -n "$key" ]; then
                local value
                value=$($redis_cmd GET "$key" 2>/dev/null || echo "")
                local ttl
                ttl=$($redis_cmd TTL "$key" 2>/dev/null || echo "-1")

                if [ "$first" = false ]; then
                    echo "," >> "$dump_file"
                fi
                first=false

                # Escape JSON values
                local escaped_key
                escaped_key=$(echo "$key" | sed 's/"/\\"/g')
                local escaped_value
                escaped_value=$(echo "$value" | sed 's/"/\\"/g')

                echo "  \"${escaped_key}\": {\"value\": \"${escaped_value}\", \"ttl\": ${ttl}}" >> "$dump_file"
            fi
        done < "$temp_file"

        echo "}" >> "$dump_file"
        rm -f "$temp_file"

        # Compress the dump
        gzip -c "$dump_file" > "${dump_file}.gz"
        rm -f "$dump_file"

        local backup_end
        backup_end=$(date +%s)
        local duration=$((backup_end - backup_start))
        local file_size
        file_size=$(du -h "${dump_file}.gz" | cut -f1)

        log_success "Backup completed in ${duration}s"
        log_info "Backup size: $file_size"

        echo "${dump_file}.gz"

    else
        log_error "Failed to trigger BGSAVE"
        exit 1
    fi
}

upload_to_s3() {
    local backup_file="$1"

    if [ -z "$S3_BUCKET" ]; then
        log_info "S3_BUCKET not set, skipping S3 upload"
        return
    fi

    log_info "Uploading to S3: s3://${S3_BUCKET}/${S3_PREFIX}/$(basename "$backup_file")"

    if aws s3 cp "$backup_file" "s3://${S3_BUCKET}/${S3_PREFIX}/$(basename "$backup_file")" \
        --storage-class STANDARD_IA; then

        # Upload checksum
        if [ -f "${backup_file}.sha256" ]; then
            aws s3 cp "${backup_file}.sha256" "s3://${S3_BUCKET}/${S3_PREFIX}/$(basename "${backup_file}.sha256")"
        fi

        log_success "S3 upload completed"
    else
        log_error "S3 upload failed"
    fi
}

rotate_backups() {
    log_info "Rotating old backups (retaining ${RETENTION_DAYS} days)..."

    # Remove local backups older than retention period
    find "$BACKUP_DIR" -name "redis-backup-*" -type f -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null || true

    # Rotate S3 backups if configured
    if [ -n "$S3_BUCKET" ] && command -v aws >/dev/null 2>&1; then
        log_info "Rotating S3 backups..."
        aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" | while read -r line; do
            local file_date
            file_date=$(echo "$line" | awk '{print $1}' | date -f - +%s 2>/dev/null || echo "0")
            local cutoff_date
            cutoff_date=$(date -d "${RETENTION_DAYS} days ago" +%s 2>/dev/null || echo "$(date +%s) - ${RETENTION_DAYS} * 86400" | bc)

            if [ "$file_date" -lt "$cutoff_date" ]; then
                local file_name
                file_name=$(echo "$line" | awk '{print $4}')
                log_info "Deleting old S3 backup: $file_name"
                aws s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}/${file_name}"
            fi
        done
    fi

    log_success "Backup rotation completed"
}

# ============================================================================
# Restore Functions
# ============================================================================

restore_backup() {
    local backup_file="$1"

    if [ ! -f "$backup_file" ]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi

    log_info "Restoring from: $backup_file"

    # Build redis-cli command
    local redis_cmd="redis-cli -h $REDIS_HOST -p $REDIS_PORT"
    if [ -n "$REDIS_PASSWORD" ]; then
        redis_cmd="$redis_cmd -a $REDIS_PASSWORD --no-auth-warning"
    fi

    # Determine file type and restore accordingly
    if [[ "$backup_file" =~ \.rdb$ ]]; then
        log_info "Restoring RDB file (requires Redis restart)..."
        log_error "RDB restore requires manual intervention:"
        echo "  1. Stop Redis: docker stop redis"
        echo "  2. Copy RDB file: docker cp $backup_file redis:/data/dump.rdb"
        echo "  3. Start Redis: docker start redis"
    elif [[ "$backup_file" =~ \.json\.gz$ ]]; then
        log_info "Restoring from JSON dump..."

        # First, flush existing data (with confirmation)
        log_warning "This will FLUSH the current Redis database!"
        read -rp "Continue? (yes/no): " confirm

        if [ "$confirm" != "yes" ]; then
            log_info "Restore cancelled"
            exit 0
        fi

        # Decompress and restore
        local temp_file
        temp_file=$(mktemp)

        gunzip -c "$backup_file" > "$temp_file"

        # Parse JSON and restore keys
        # This is a simple implementation; for production, use a proper JSON parser
        log_info "Restoring keys..."
        $redis_cmd FLUSHDB >/dev/null 2>&1

        # Use jq if available
        if command -v jq >/dev/null 2>&1; then
            jq -r 'to_entries[] | "\(.key)::::\(.value.value)::::\(.value.ttl)"' "$temp_file" | \
            while IFS='::::' read -r key value ttl; do
                if [ -n "$key" ]; then
                    if [ "$ttl" -gt 0 ]; then
                        echo "$value" | $redis_cmd -x SET "$key" >/dev/null 2>&1
                        $redis_cmd EXPIRE "$key" "$ttl" >/dev/null 2>&1
                    else
                        echo "$value" | $redis_cmd -x SET "$key" >/dev/null 2>&1
                    fi
                fi
            done
        fi

        rm -f "$temp_file"

        log_success "Restore completed"
    else
        log_error "Unknown backup file type"
        exit 1
    fi
}

list_backups() {
    echo "=== Available Redis Backups ==="
    echo

    if [ -d "$BACKUP_DIR" ]; then
        for backup in "$BACKUP_DIR"/redis-backup-* "$BACKUP_DIR"/redis-dump-*; do
            if [ -f "$backup" ]; then
                local basename
                basename=$(basename "$backup")
                local size
                size=$(du -h "$backup" | cut -f1)
                local date
                date=$(ls -l "$backup" | awk '{print $6, $7, $8}')

                echo "  $basename ($size) - $date"
            fi
        done
    fi

    echo

    if [ -n "$S3_BUCKET" ] && command -v aws >/dev/null 2>&1; then
        echo "=== S3 Backups ==="
        aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" || echo "  No S3 backups found"
    fi
}

# ============================================================================
# Main
# ============================================================================

usage() {
    cat << EOF
Usage: $0 [COMMAND]

Commands:
  backup          Perform a Redis backup
  restore FILE    Restore from a backup file
  list            List available backups
  rotate          Rotate old backups

Environment Variables:
  REDIS_URL       Redis connection string (default: redis://redis:6379/0)
  BACKUP_DIR      Directory for local backups (default: ./backups/redis)
  RETENTION_DAYS  Days to retain backups (default: 7)
  S3_BUCKET       S3 bucket for remote backups (optional)
  S3_PREFIX       S3 prefix for backups (default: elongoat/backups/redis)

Examples:
  $0 backup
  $0 restore ./backups/redis/redis-backup-20240101-120000.rdb
  $0 list
EOF
}

main() {
    local command="${1:-backup}"

    case "$command" in
        backup)
            check_dependencies
            create_backup_dir

            backup_file=$(perform_backup)
            upload_to_s3 "$backup_file"
            rotate_backups
            ;;
        restore)
            if [ -z "${2:-}" ]; then
                log_error "Please specify backup file to restore"
                usage
                exit 1
            fi
            check_dependencies
            restore_backup "$2"
            ;;
        list)
            list_backups
            ;;
        rotate)
            rotate_backups
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
