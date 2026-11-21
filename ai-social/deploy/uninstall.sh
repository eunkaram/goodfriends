#!/usr/bin/env bash
# goodfriends ai-social LaunchDaemon 제거 (Bryan이 sudo로 실행). 멱등.
#   sudo ./uninstall.sh [--yes]
set -euo pipefail

LABEL="com.server.goodfriends-ai-social"
DEST="/Library/LaunchDaemons/${LABEL}.plist"
ASSUME_YES=0
case "${1:-}" in
  "") ;;
  --yes|-y) ASSUME_YES=1 ;;
  *) echo "사용법: sudo $0 [--yes]" >&2; exit 2 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "root 권한이 필요합니다: sudo $0" >&2; exit 1
fi
echo "제거 대상: system/$LABEL 서비스 정지 + $DEST 삭제 (로그·데이터는 유지)"
if [ "$ASSUME_YES" -ne 1 ]; then
  [ -t 0 ] || { echo "대화형으로 실행하세요 (또는 --yes)" >&2; exit 1; }
  read -r -p "계속할까요? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "취소"; exit 1; }
fi

if launchctl print "system/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "system/$LABEL" || true
  for _ in $(seq 1 30); do
    launchctl print "system/$LABEL" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if launchctl print "system/$LABEL" >/dev/null 2>&1; then
    echo "오류: bootout 후에도 서비스가 남아 있습니다. plist는 지우지 않았습니다." >&2; exit 1
  fi
fi
rm -f "$DEST"
echo "제거 완료"
