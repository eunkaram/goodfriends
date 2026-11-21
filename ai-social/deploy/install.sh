#!/usr/bin/env bash
# goodfriends ai-social LaunchDaemon 설치 (Bryan이 sudo로 실행). 멱등.
#   sudo ./install.sh [--yes] [--node /path/to/node] [--user server]
# 정적 검사용: DRY_RENDER_DIR=<dir> 를 주면 치환 결과만 그 디렉터리에 쓴다 (root·sudo·launchctl 사용 안 함).
set -euo pipefail

LABEL="com.server.goodfriends-ai-social"
DEST="/Library/LaunchDaemons/${LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_SOCIAL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/${LABEL}.plist.template"
LOG_DIR="$AI_SOCIAL_DIR/logs"
RUN_USER="server"
NODE_BIN=""
ASSUME_YES=0
RENDER_DIR="${DRY_RENDER_DIR:-}"

die() { echo "오류: $*" >&2; exit 1; }
usage() { echo "사용법: sudo $0 [--yes] [--node /path/to/node] [--user server]" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --node) [ $# -ge 2 ] || usage; NODE_BIN="$2"; shift 2 ;;
    --user) [ $# -ge 2 ] || usage; RUN_USER="$2"; shift 2 ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    *) usage ;;
  esac
done

if [ -z "$RENDER_DIR" ] && [ "$(id -u)" -ne 0 ]; then
  die "root 권한이 필요합니다: sudo $0"
fi
[ -f "$TEMPLATE" ] || die "템플릿 없음: $TEMPLATE"
[ -f "$AI_SOCIAL_DIR/src/index.ts" ] || die "ai-social 소스 없음: $AI_SOCIAL_DIR"
id "$RUN_USER" >/dev/null 2>&1 || die "사용자 없음: $RUN_USER"
[ "$RUN_USER" = "server" ] || echo "경고: --user=$RUN_USER (기본 server가 아님). data/·node_modules 접근 권한을 아래에서 확인합니다." >&2

# 실행 사용자 권한으로 명령 실행 (렌더 모드에서는 sudo 없이 현재 사용자로만)
as_user() {
  if [ -n "$RENDER_DIR" ]; then
    [ "$(id -un)" = "$RUN_USER" ] || return 99
    "$@"
  else
    sudo -u "$RUN_USER" -H "$@"
  fi
}

owner_of() { stat -f %Su "$1"; }

# --- 경로 안전 검사 (root로 사용자 영역을 만지지 않도록) ---
[ "$(cd "$SCRIPT_DIR/.." && pwd -P)" = "$AI_SOCIAL_DIR" ] || die "ai-social 경로에 심볼릭 링크가 포함돼 있습니다: $AI_SOCIAL_DIR"
[ -L "$AI_SOCIAL_DIR" ] && die "WorkingDirectory가 심볼릭 링크입니다: $AI_SOCIAL_DIR"
[ "$(owner_of "$AI_SOCIAL_DIR")" = "$RUN_USER" ] || die "$AI_SOCIAL_DIR 소유자가 $RUN_USER 가 아닙니다"
[ -d "$AI_SOCIAL_DIR/node_modules/tsx" ] || die "node_modules 없음: (cd $AI_SOCIAL_DIR && npm ci) 먼저"

if [ -L "$LOG_DIR" ]; then die "로그 경로가 심볼릭 링크입니다: $LOG_DIR (제거 후 다시 실행)"; fi
if [ ! -e "$LOG_DIR" ]; then
  if [ -n "$RENDER_DIR" ]; then
    echo "  (렌더 모드: 로그 디렉터리 생성 생략)"
  else
    # root가 아니라 실행 사용자 권한으로 만든다
    as_user mkdir -p "$LOG_DIR" || die "로그 디렉터리를 만들지 못했습니다: $LOG_DIR (먼저 $RUN_USER 로 mkdir 하세요)"
  fi
fi
if [ -e "$LOG_DIR" ]; then
  [ -L "$LOG_DIR" ] && die "로그 경로가 심볼릭 링크입니다: $LOG_DIR"
  [ -d "$LOG_DIR" ] || die "로그 경로가 디렉터리가 아닙니다: $LOG_DIR"
  [ "$(owner_of "$LOG_DIR")" = "$RUN_USER" ] || die "$LOG_DIR 소유자가 $RUN_USER 가 아닙니다"
fi

# node 경로 해석: --node > 실행 사용자의 mise > 실행 사용자 PATH의 node
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(as_user bash -lc 'mise which node 2>/dev/null || command -v node' 2>/dev/null | tail -n 1 || true)"
fi
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || die "node를 찾지 못했습니다. --node 로 지정하세요."
# brew의 node는 심볼릭 링크(brew upgrade에도 유지되는 안정 경로)라 plist에는 그대로 쓰고, 실제 파일을 검사한다. 실제 파일이 root/실행 사용자 소유가 아니거나 그룹·타인 쓰기 가능이면 거부.
NODE_REAL="$(cd "$(dirname "$NODE_BIN")" && pwd -P)/$(basename "$NODE_BIN")"
if [ -L "$NODE_REAL" ]; then
  NODE_LINK="$(readlink "$NODE_REAL")"
  case "$NODE_LINK" in /*) NODE_REAL="$NODE_LINK" ;; *) NODE_REAL="$(cd "$(dirname "$NODE_REAL")/$(dirname "$NODE_LINK")" && pwd -P)/$(basename "$NODE_LINK")" ;; esac
fi
[ -f "$NODE_REAL" ] && [ -x "$NODE_REAL" ] && [ ! -L "$NODE_REAL" ] || die "node 실제 경로를 확인하지 못했습니다: $NODE_REAL"
NODE_OWNER="$(owner_of "$NODE_REAL")"
[ "$NODE_OWNER" = "root" ] || [ "$NODE_OWNER" = "$RUN_USER" ] || die "node 소유자가 root/$RUN_USER 가 아닙니다: $NODE_REAL ($NODE_OWNER)"
NODE_PERM="$(stat -f %Lp "$NODE_REAL")"
case "$NODE_PERM" in *[2367]?|*[2367]) die "node가 그룹/타인 쓰기 가능입니다: $NODE_REAL ($NODE_PERM)" ;; esac
NODE_VER="$("$NODE_BIN" -p 'process.versions.node')"
case "$NODE_VER" in
  [0-9].*|1[0-9].*|2[01].*|22.[0-4].*) die "node $NODE_VER 는 너무 낮습니다 (22.5+ 필요)" ;;
esac
NODE_DIR="$(dirname "$NODE_BIN")"

# PATH (중복 없이)
BASE_PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
case ":$BASE_PATH:" in
  *":$NODE_DIR:"*) PATH_VALUE="$BASE_PATH" ;;
  *) PATH_VALUE="$NODE_DIR:$BASE_PATH" ;;
esac

for v in "$AI_SOCIAL_DIR" "$NODE_BIN" "$LOG_DIR" "$RUN_USER" "$PATH_VALUE"; do
  case "$v" in *[\&\|\<\>\"\\]*) die "경로에 허용되지 않는 문자가 있습니다: $v" ;; esac
done

# 실행 사용자 접근 권한 (--user가 server가 아닐 때 특히 중요)
if as_user true 2>/dev/null; then
  as_user test -r "$AI_SOCIAL_DIR/node_modules" || die "$RUN_USER 가 node_modules를 읽을 수 없습니다"
  if [ -d "$AI_SOCIAL_DIR/data" ]; then
    as_user test -r "$AI_SOCIAL_DIR/data" -a -w "$AI_SOCIAL_DIR/data" -a -x "$AI_SOCIAL_DIR/data" || die "$RUN_USER 가 ai-social/data를 읽고 쓸 수 없습니다"
  else
    as_user test -w "$AI_SOCIAL_DIR" || die "data/가 없고 $RUN_USER 가 $AI_SOCIAL_DIR 에 쓸 수 없어 만들 수 없습니다"
  fi
else
  echo "  (렌더 모드: 다른 사용자 권한 검사는 건너뜀)"
fi

echo "== 설치 내용 확인 =="
echo "  Label     : $LABEL"
echo "  사용자    : $RUN_USER"
echo "  작업 경로 : $AI_SOCIAL_DIR"
echo "  node      : $NODE_BIN (v$NODE_VER)"
echo "  로그      : $LOG_DIR/ai-social.log, ai-social.err.log"
echo "  plist     : ${RENDER_DIR:-$DEST}"
[ -f "$AI_SOCIAL_DIR/.env" ] || echo "  경고: $AI_SOCIAL_DIR/.env 가 없습니다 (Bryan이 준비). DRY_RUN은 .env에서 결정되며 기본 true." >&2

render() {
  sed -e "s|@@RUN_USER@@|$RUN_USER|g" \
      -e "s|@@AI_SOCIAL_DIR@@|$AI_SOCIAL_DIR|g" \
      -e "s|@@NODE_BIN@@|$NODE_BIN|g" \
      -e "s|@@PATH_VALUE@@|$PATH_VALUE|g" \
      -e "s|@@LOG_DIR@@|$LOG_DIR|g" "$TEMPLATE" > "$1"
  if grep -q '@@' "$1"; then die "치환되지 않은 변수가 남았습니다"; fi
  plutil -lint "$1" >/dev/null
}

if [ -n "$RENDER_DIR" ]; then
  mkdir -p "$RENDER_DIR"
  render "$RENDER_DIR/${LABEL}.plist"
  echo "렌더링만 완료 (설치 안 함)"; exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  [ -t 0 ] || die "대화형으로 실행하세요 (또는 --yes)"
  read -r -p "계속할까요? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "취소"; exit 1; }
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
render "$TMP"

if launchctl print "system/$LABEL" >/dev/null 2>&1; then
  echo "기존 서비스 bootout"
  launchctl bootout "system/$LABEL" || true
  for _ in $(seq 1 30); do
    launchctl print "system/$LABEL" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if launchctl print "system/$LABEL" >/dev/null 2>&1; then
    die "bootout 후에도 서비스가 남아 있습니다 (15초 대기). plist는 교체하지 않았습니다."
  fi
fi
install -o root -g wheel -m 644 "$TMP" "$DEST"
launchctl bootstrap system "$DEST" || die "launchctl bootstrap 실패"
launchctl enable "system/$LABEL" || true
launchctl print "system/$LABEL" >/dev/null 2>&1 || die "bootstrap 후 서비스가 로드되지 않았습니다"
echo "설치·시작 완료. 확인: sudo launchctl print system/$LABEL | head -20"
echo "로그: tail -f $LOG_DIR/ai-social.log"
