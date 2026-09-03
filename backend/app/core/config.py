"""환경설정. 프로덕션은 Secret Manager가 env로 주입(01-상세설계 §1.1)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BT_", env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:test@localhost:55432/billtamjung"
    jwt_secret: str = "dev-secret-change-me-please-32bytes-minimum-000"
    jwt_alg: str = "HS256"
    access_ttl_min: int = 30
    refresh_ttl_days: int = 30

    # 베타 크레딧 정책 (P2: 그림자 계량 → 실차단 off)
    billing_enforced: bool = False
    trial_credits: int = 60
    cost_analysis: int = 30
    cost_briefing: int = 10   # 브리핑=사실 나열(계산 없음). 스펙 확정가

    cors_origins: str = "http://localhost:5173"

    # 신규 가입 개방 여부. false면 이메일 가입·소셜 신규가입이 모두 막히고
    # 기존 회원 로그인·refresh·팀 초대 수락은 그대로 동작한다(홍보 선행 · 베타 개시 전 차단용).
    signups_open: bool = True

    # 로그인 허용 목록(2026-08-20) — **개발서버 전용 빗장**. 값이 있으면 그 이메일만 로그인된다.
    # 설문 링크를 밖으로 뿌리는 동안 테스트계정 외의 접속을 막는다(운영은 미설정이라 무영향).
    # 예: BT_LOGIN_ALLOW="coms1768@gmail.com,demo9@billtamjung.com"
    login_allow: str = ""

    # 소셜 로그인(OAuth) — 키는 카카오/네이버 개발자센터 발급 후 env로 주입(BT_KAKAO_CLIENT_ID 등).
    # 비어 있으면 /auth/social/* 은 503(미설정) 반환. 스키마·골격은 준비됨(기능목록 §1).
    kakao_client_id: str = ""
    kakao_client_secret: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    frontend_base: str = "http://localhost:5173"       # OAuth 콜백 리다이렉트 대상


settings = Settings()
