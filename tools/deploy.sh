#!/usr/bin/env bash
# Deploys spcfz-licence-card to 13.206.34.102 FROM THIS MAC. Every subcommand is one approval step:
# run it only after the user has said yes to that step. Each remote command is printed before it runs;
# --dry-run prints and runs nothing. See docs/RUNBOOK.md.
#
#   tools/deploy.sh [--dry-run] release      copy HEAD to /opt/spcfz-licence-card/releases/<sha>, build the image
#   tools/deploy.sh [--dry-run] env-init     create /opt/spcfz-licence-card/licence-card.env with random secrets (once)
#   tools/deploy.sh [--dry-run] start [sha]  replace the running container with that image (default: HEAD)
#   tools/deploy.sh [--dry-run] cert         copy the *.spcfz.ae origin certificate for the vhost
#   tools/deploy.sh [--dry-run] vhost        install the Apache site, config-test, graceful reload (removed again if the test fails)
#   tools/deploy.sh status                   read-only: container, health, recent logs
set -euo pipefail

HOST="${DEPLOY_HOST:-root@13.206.34.102}"
ROOT=/opt/spcfz-licence-card
VHOST=/www/server/panel/vhost/apache/licensed.spcfz.ae.conf
CERT_DIR=/www/server/panel/vhost/cert/licensed.spcfz.ae
CERT_SRC=/www/server/panel/vhost/cert/coworking.spcfz.ae
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

DRY=""
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
CMD="${1:-}"; shift || true

cd "$(dirname "$0")/.."

remote() {               # remote "<shell command>"
  printf '\n[%s] $ %s\n' "$HOST" "$1"
  [ -n "$DRY" ] && return 0
  "${SSH[@]}" "$1"
}

require_clean() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "working tree is not clean; commit first so the release is exactly a commit" >&2; exit 1
  fi
}

sha() { git rev-parse --short=12 HEAD; }

case "$CMD" in
  release)
    require_clean
    S="$(sha)"
    printf '\n[local] $ git archive HEAD | ssh %s tar -x -C %s/releases/%s\n' "$HOST" "$ROOT" "$S"
    if [ -z "$DRY" ]; then
      "${SSH[@]}" "test ! -e ${ROOT}/releases/${S}" || { echo "release ${S} already uploaded" >&2; exit 1; }
      git archive --format=tar HEAD | "${SSH[@]}" "install -d -m 755 ${ROOT}/releases/${S} && tar -x -C ${ROOT}/releases/${S}"
    fi
    remote "docker build --pull -t spcfz-licence-card:${S} ${ROOT}/releases/${S}"
    echo; echo "built spcfz-licence-card:${S}"
    ;;

  env-init)
    remote "test ! -e ${ROOT}/licence-card.env || { echo 'licence-card.env already exists; not touching it' >&2; exit 1; }"
    S="$(sha)"
    remote "umask 077 && gen() { openssl rand -base64 64 | tr -dc A-Za-z0-9 | head -c 48; } && sed -e \"s/^WEBHOOK_SECRET_CURRENT=__GENERATED__/WEBHOOK_SECRET_CURRENT=\$(gen)/\" -e \"s/^TEST_SECRET_CURRENT=__GENERATED__/TEST_SECRET_CURRENT=\$(gen)/\" -e \"s/^ADMIN_LOGIN_KEY=__GENERATED__/ADMIN_LOGIN_KEY=\$(gen)/\" ${ROOT}/releases/${S}/deploy/licence-card.env.example > ${ROOT}/licence-card.env && chmod 600 ${ROOT}/licence-card.env && grep -c '^[A-Z_]*_SECRET_CURRENT=[A-Za-z0-9]\\{48\\}\$' ${ROOT}/licence-card.env"
    echo; echo "secrets were generated on the server and never printed. To read one:"
    echo "  ssh ${HOST} grep '^TEST_SECRET_CURRENT=' ${ROOT}/licence-card.env"
    ;;

  start)
    S="${1:-$(sha)}"
    remote "bash ${ROOT}/releases/${S}/deploy/run.sh ${S}"
    ;;

  cert)
    remote "test ! -e ${CERT_DIR} || { echo '${CERT_DIR} already exists; not touching it' >&2; exit 1; }"
    remote "install -d -m 755 ${CERT_DIR} && cp -p ${CERT_SRC}/fullchain.pem ${CERT_DIR}/fullchain.pem && cp -p ${CERT_SRC}/privkey.pem ${CERT_DIR}/privkey.pem && chmod 600 ${CERT_DIR}/privkey.pem && openssl x509 -in ${CERT_DIR}/fullchain.pem -noout -ext subjectAltName | tail -1"
    ;;

  vhost)
    test -f deploy/apache-licensed.spcfz.ae.conf
    remote "test ! -e ${VHOST} || { echo '${VHOST} already exists; edit it deliberately, this command only installs' >&2; exit 1; }"
    remote "test -f ${CERT_DIR}/fullchain.pem || { echo 'certificate missing: run cert first' >&2; exit 1; }"
    remote "/usr/bin/httpd -t"
    printf '\n[local] $ scp deploy/apache-licensed.spcfz.ae.conf %s:%s\n' "$HOST" "$VHOST"
    [ -z "$DRY" ] && scp -o BatchMode=yes -q deploy/apache-licensed.spcfz.ae.conf "${HOST}:${VHOST}"
    remote "if /usr/bin/httpd -t; then /etc/init.d/httpd reload; else echo 'config test FAILED; removing the new file, Apache was not reloaded' >&2; rm -f ${VHOST}; exit 1; fi"
    ;;

  status)
    DRY=""
    remote "docker ps -a --filter name=spcfz-licence-card --format '{{.Names}}  {{.Image}}  {{.Status}}'; curl -fsS --max-time 3 http://127.0.0.1:8787/healthz; echo; docker logs --tail 20 spcfz-licence-card 2>&1 | tail -20"
    ;;

  *)
    sed -n '2,12p' "$0"; exit 2
    ;;
esac
