#!/usr/bin/env bash
# Runs ON THE SERVER as root: replaces the running container with image spcfz-licence-card:<sha>.
# Health-checked; if the new container does not become healthy the previous one is restored.
# Usage: bash /opt/spcfz-licence-card/releases/<sha>/deploy/run.sh <sha>
set -euo pipefail

SHA="${1:?usage: run.sh <sha>}"
ROOT=/opt/spcfz-licence-card
NAME=spcfz-licence-card
IMAGE="spcfz-licence-card:${SHA}"
ENV_FILE="${ROOT}/licence-card.env"

[ -f "$ENV_FILE" ] || { echo "missing ${ENV_FILE}; run tools/deploy.sh env-init first" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "image ${IMAGE} not built" >&2; exit 1; }

install -d -m 750 -o 10001 -g 10001 "${ROOT}/data"

PREV_IMAGE=""
if docker container inspect "$NAME" >/dev/null 2>&1; then
  PREV_IMAGE="$(docker container inspect -f '{{.Config.Image}}' "$NAME")"
  echo "stopping current container (${PREV_IMAGE})"
  docker stop -t 30 "$NAME" >/dev/null
  docker rm -f "${NAME}-prev" >/dev/null 2>&1 || true
  docker rename "$NAME" "${NAME}-prev"
fi

echo "starting ${IMAGE}"
docker run -d --name "$NAME" \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  --memory 1500m --memory-swap 1500m --cpus 2 --pids-limit 512 \
  --env-file "$ENV_FILE" \
  -e DATA_DIR=/data -e HOST=0.0.0.0 -e PORT=8787 \
  -v "${ROOT}/data:/data" \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=5 \
  "$IMAGE" >/dev/null

ok=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8787/healthz >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [ -n "$ok" ]; then
  echo "healthy: ${IMAGE}"
  docker rm "${NAME}-prev" >/dev/null 2>&1 || true
  exit 0
fi

echo "NOT healthy; last log lines:" >&2
docker logs --tail 50 "$NAME" >&2 || true
docker rm -f "$NAME" >/dev/null
if [ -n "$PREV_IMAGE" ]; then
  echo "restoring previous container (${PREV_IMAGE})" >&2
  docker rename "${NAME}-prev" "$NAME"
  docker start "$NAME" >/dev/null
fi
exit 1
