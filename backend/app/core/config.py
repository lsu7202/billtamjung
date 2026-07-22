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
    cost_briefing: int = 10

    cors_origins: str = "http://localhost:5173"

    # 소셜 로그인(OAuth) — 키는 카카오/네이버 개발자센터 발급 후 env로 주입(BT_KAKAO_CLIENT_ID 등).
    # 비어 있으면 /auth/social/* 은 503(미설정) 반환. 스키마·골격은 준비됨(기능목록 §1).
    kakao_client_id: str = ""
    kakao_client_secret: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    frontend_base: str = "http://localhost:5173"       # OAuth 콜백 리다이렉트 대상


settings = Settings()
