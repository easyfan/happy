#!/bin/bash
set -euo pipefail

# Load env
set -a; source /opt/happy/.env; set +a

BACKUP_DIR=/home/ubuntu/happy-backup
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILENAME=pg-$TIMESTAMP.sql.gz
LOCAL_PATH=$BACKUP_DIR/$FILENAME

mkdir -p $BACKUP_DIR

# Always clean up local file on exit (success or failure)
trap 'rm -f "$LOCAL_PATH"' EXIT

# Dump from postgres container
docker exec happy-postgres-1 pg_dump -U handy handy | gzip > $LOCAL_PATH

# Configure aws cli for COS
export AWS_ACCESS_KEY_ID=$S3_ACCESS_KEY
export AWS_SECRET_ACCESS_KEY=$S3_SECRET_KEY
export AWS_DEFAULT_REGION=$S3_REGION

# Force single-part upload (COS requires Content-Length in multipart, aws-cli v1 doesn't send it)
export AWS_CONFIG_FILE=/tmp/aws-backup-config
cat > /tmp/aws-backup-config << AWSEOF
[default]
s3 =
    multipart_threshold = 100GB
    multipart_chunksize = 100GB
    addressing_style = virtual
AWSEOF

# Upload to COS
/home/ubuntu/.local/bin/aws s3 cp "$LOCAL_PATH" "s3://$S3_BUCKET/backups/$FILENAME" \
    --endpoint-url "https://cos.${S3_REGION}.myqcloud.com"

# Remove backups older than 7 days from COS
CUTOFF=$(date -d '7 days ago' +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -v-7d +%Y-%m-%dT%H:%M:%S)
/home/ubuntu/.local/bin/aws s3 ls "s3://$S3_BUCKET/backups/" \
    --endpoint-url "https://cos.${S3_REGION}.myqcloud.com" \
    | while read -r date time size fname; do
        if [[ "$date $time" < "$CUTOFF" ]]; then
            /home/ubuntu/.local/bin/aws s3 rm "s3://$S3_BUCKET/backups/$fname" \
                --endpoint-url "https://cos.${S3_REGION}.myqcloud.com"
        fi
    done

echo "Backup complete: $FILENAME"
