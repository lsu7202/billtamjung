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

    # ── AI 어시스턴트 (10-AI-어시스턴트) ──────────────────────────────
    # 키가 비어 있으면 /ai/* 는 AI_NOT_CONFIGURED 로 답한다(소셜 키와 같은 어법).
    # **절대 프론트로 안 간다.** 모델 호출은 전부 서버에서만 난다.
    anthropic_api_key: str = ""
    # 2026-09-09 대표 지시로 하이쿠·low. 값이 절반이다.
    # **잣대에서 8○ → 6○ 로 내려간다.** 특히 SQL 을 짜서 세는 질문에서
    # 「성수동1가 200평 넘는 건물」을 415동 대신 **10동**이라고 냈다(참값 415).
    # 되돌리려면 이 줄만 claude-sonnet-5 로. 잣대: qa/ai/bench/result-20260909-1135.md
    ai_model: str = "claude-haiku-4-5"                   # 대화 본체·문서·SQL
    ai_model_fast: str = "claude-haiku-4-5-20251001"     # 제목·기억 뽑기·분류
    ai_max_tokens: int = 4096
    # 겨루기 첫 판(2026-09-08, 케이스 열 × 2회): 소넷 low 가 high 와 같은 답을 입력 25% 적게, 절반 시간에 냈다.
    # 하이쿠는 3배 싸지만 평·㎡ 를 뒤바꾸고 공시지가를 10배로 읽었다. 등급을 내리기 전에 effort 부터.
    ai_effort: str = "low"                                # "" 이면 모델 기본(high)
    # bt_ai 롤로 붙는 **별도 접속**. master·ref 만 읽는다(0167). 비어 있으면 query() 도구가 안 선다.
    # 앱 접속(database_url)은 postgres 슈퍼유저라 모델에게 절대 안 준다.
    ai_database_url: str = ""
    # 대화가 길어지면 앞쪽을 요약해 접는다. 그 전까지는 통째로 다시 보낸다
    ai_history_turns: int = 40

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
