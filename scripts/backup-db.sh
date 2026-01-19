#!/bin/bash
# Database Backup Script for elongoat
# Supports PostgreSQL with automatic rotation and S3 upload

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Load environment
if [ -f "${PROJECT_ROOT}/.env" ]; then
    # shellcheck source=/dev/null
    export "$(grep -v '^#' "${PROJECT_ROOT}/.env" | grep -v '^$' | xargs)"
fi

DATABASE_URL="${DATABASE_URL:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-elongoat/backups}"

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

validate_database_url() {
    if [ -z "$DATABASE_URL" ]; then
        log_error "DATABASE_URL is not set"
        exit 1
    fi

    # Parse DATABASE_URL to extract connection info
    # Format: postgresql://user:password@host:port/database
    if [[ ! "$DATABASE_URL" =~ ^postgresql:// ]]; then
        log_error "Invalid DATABASE_URL format. Expected: postgresql://..."
        exit 1
    fi
}

check_dependencies() {
    local missing_deps=()

    command -v pg_dump >/dev/null 2>&1 || missing_deps+=("postgresql-client")
    command -v gzip >/dev/null 2>&1 || missing_deps+=("gzip")

    if [ -n "$S3_BUCKET" ]; then
        command -v aws >/dev/null 2>&1 || missing_deps+=("awscli")
    fi

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
    local backup_file="${BACKUP_DIR}/elongoat-backup-${TIMESTAMP}.sql.gz"
    local backup_start
    backup_start=$(date +%s)

    log_info "Starting database backup..."
    log_info "Backup file: $backup_file"

    # Perform backup with pg_dump
    if pg_dump "$DATABASE_URL" --format=plain --no-owner --no-acl \
        --exclude-table-data='pg_stat_statements' \
        2>&1 | gzip > "$backup_file"; then

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
    else
        log_error "Backup failed"
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
    find "$BACKUP_DIR" -name "elongoat-backup-*.sql.gz" -type f -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null || true
    find "$BACKUP_DIR" -name "elongoat-backup-*.sha256" -type f -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null || true

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

generate_backup_manifest() {
    local manifest_file="${BACKUP_DIR}/manifest.json"

    log_info "Generating backup manifest..."

    cat > "$manifest_file" << EOF
{
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "retention_days": ${RETENTION_DAYS},
  "s3_bucket": "${S3_BUCKET:-}",
  "s3_prefix": "${S3_PREFIX:-}",
  "backups": [
EOF

    local first=true
    for backup in "$BACKUP_DIR"/elongoat-backup-*.sql.gz; do
        if [ -f "$backup" ]; then
            local basename
            basename=$(basename "$backup")
            local size
            size=$(stat -f%z "$backup" 2>/dev/null || stat -c%s "$backup" 2>/dev/null || echo "0")
            local date
            date=$(date -r "$backup" -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || stat -c %y "$backup" | cut -d'.' -f1)

            if [ "$first" = false ]; then
                echo "," >> "$manifest_file"
            fi
            first=false

            cat >> "$manifest_file" << EOF
    {
      "filename": "${basename}",
      "size": ${size},
      "created_at": "${date}"
    }
EOF
        fi
    done

    cat >> "$manifest_file" << EOF

  ]
}
EOF

    log_success "Manifest generated: $manifest_file"
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
    log_warning "This will REPLACE the current database!"
    read -rp "Continue? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        log_info "Restore cancelled"
        exit 0
    fi

    log_info "Dropping existing tables..."
    psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

    log_info "Restoring database..."
    gunzip -c "$backup_file" | psql "$DATABASE_URL"

    log_success "Restore completed"
}

list_backups() {
    echo "=== Available Backups ==="
    echo

    if [ -d "$BACKUP_DIR" ]; then
        for backup in "$BACKUP_DIR"/elongoat-backup-*.sql.gz; do
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
  backup          Perform a database backup
  restore FILE    Restore from a backup file
  list            List available backups
  rotate          Rotate old backups
  manifest        Generate backup manifest

Environment Variables:
  DATABASE_URL    PostgreSQL connection string (required)
  BACKUP_DIR      Directory for local backups (default: ./backups)
  RETENTION_DAYS  Days to retain backups (default: 7)
  S3_BUCKET       S3 bucket for remote backups (optional)
  S3_PREFIX       S3 prefix for backups (default: elongoat/backups)

Examples:
  $0 backup
  $0 restore ./backups/elongoat-backup-20240101-120000.sql.gz
  $0 list
EOF
}

main() {
    local command="${1:-backup}"

    case "$command" in
        backup)
            validate_database_url
            check_dependencies
            create_backup_dir

            backup_file=$(perform_backup)
            upload_to_s3 "$backup_file"
            rotate_backups
            generate_backup_manifest
            ;;
        restore)
            if [ -z "${2:-}" ]; then
                log_error "Please specify backup file to restore"
                usage
                exit 1
            fi
            validate_database_url
            check_dependencies
            restore_backup "$2"
            ;;
        list)
            list_backups
            ;;
        rotate)
            rotate_backups
            ;;
        manifest)
            generate_backup_manifest
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
