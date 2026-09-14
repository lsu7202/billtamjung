#!/usr/bin/env bash
# 프론트 배포 — vite build → Firebase Hosting(rewrite /api/** → Cloud Run bt-api).
# 사전 1회: firebase login && firebase use --add <프로젝트id>
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "── 프론트 빌드"
(cd frontend && npm run build)

echo "── Firebase Hosting 배포"
firebase deploy --only hosting

echo "✅ 웹 배포 완료 — Hosting URL을 FRONTEND_BASE로 deploy_api.sh 재실행(CORS·OAuth 콜백 반영)"
