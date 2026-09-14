#!/usr/bin/env bash
# 할당 과금 리소스 일괄 관리 — SQL·Cloud Run이 "켜져만 있어도" 나가는 비용을 한 번에 제어.
# 사용:
#   ./costctl.sh status   # 현재 과금 상태 한눈에
#   ./costctl.sh sleep    # 전부 절전: SQL 정지 + Run min=0  (서비스 중단! 스토리지 비용만 남음, 월 ~5천원)
#   ./costctl.sh wake     # 전부 기동: SQL 시작 + Run min=1  (~2분 소요)
#   ./costctl.sh lite     # 절약 모드: SQL db-g1-small + Run min=0  (서비스 유지·느려짐, 월 ~4만원)
#   ./costctl.sh full     # 표준 모드: SQL db-custom-1-3840 + Run min=1  (월 ~17만원)
set -euo pipefail
PROJECT=billtamjung REGION=asia-northeast3 SQL=bt-pg RUN=bt-api

case "${1:-status}" in
  status)
    echo "── Cloud SQL ($SQL)"
    gcloud sql instances describe $SQL --project=$PROJECT \
      --format="table(state, settings.activationPolicy, settings.tier, settings.dataDiskSizeGb)"
    echo "── Cloud Run ($RUN)"
    gcloud run services describe $RUN --project=$PROJECT --region=$REGION \
      --format="value(spec.template.metadata.annotations['autoscaling.knative.dev/minScale'])" \
      | sed 's/^/min-instances: /;s/^min-instances: $/min-instances: 0(기본)/'
    echo "── 스토리지"
    gcloud storage du -s gs://$PROJECT-bt-artifacts 2>/dev/null || true
    ;;
  sleep)
    echo "⏸ 전체 절전(서비스 중단됨)"
    gcloud run services update $RUN --project=$PROJECT --region=$REGION --min-instances=0 --async
    gcloud sql instances patch $SQL --project=$PROJECT --activation-policy=NEVER
    echo "✓ 완료 — 남는 비용: 디스크·백업 저장분(월 ~5천원). 재개=wake"
    ;;
  wake)
    echo "▶ 전체 기동(~2분)"
    gcloud sql instances patch $SQL --project=$PROJECT --activation-policy=ALWAYS
    gcloud run services update $RUN --project=$PROJECT --region=$REGION --min-instances=1
    ;;
  lite)
    echo "⬇ 절약 모드: DB 축소 + Run 콜드스타트 허용 (월 ~4만원)"
    gcloud run services update $RUN --project=$PROJECT --region=$REGION --min-instances=0 --async
    gcloud sql instances patch $SQL --project=$PROJECT --tier=db-g1-small   # 무중단 아님: 수분 재시작
    ;;
  full)
    echo "⬆ 표준 모드 (월 ~17만원)"
    gcloud sql instances patch $SQL --project=$PROJECT --tier=db-custom-1-3840
    gcloud run services update $RUN --project=$PROJECT --region=$REGION --min-instances=1
    ;;
  *) echo "사용법: costctl.sh [status|sleep|wake|lite|full]"; exit 1 ;;
esac
