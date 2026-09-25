"""환경설정. 프로덕션은 Secret Manager가 env로 주입(01-상세설계 §1.1)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BT_", env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:test@localhost:55432/billtamjung"
    jwt_secret: str = "dev-secret-change-me-please-32bytes-minimum-000"
    jwt_alg: str = "HS256"
    access_ttl_min: int = 30
    refresh_ttl_days: int = 30

    billing_enforced: bool = False

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
    # 로컬 API(키워드 검색)용 REST 키. 카카오는 앱 하나에 로그인 client_id 와 REST 키가 같은 값이라
    # 비워 두면 kakao_client_id 를 그대로 쓴다(2026-09-16 실측: 같은 키로 검색이 됐다).
    kakao_rest_key: str = ""
    kakao_client_secret: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    frontend_base: str = "http://localhost:5173"       # OAuth 콜백 리다이렉트 대상

    # ── 모델 (2026-09-18 다시 세움) ─────────────────────────────────
    # 키가 비어 있으면 /ai/chat 은 AI_NOT_CONFIGURED 로 답한다(소셜 키와 같은 어법).
    # **절대 프론트로 안 간다.** 모델 호출은 전부 서버에서만 난다.
    # 벤더는 둘. 스키마·도구·응답은 하나를 쓰고 고리만 갈린다(app/ai/claude.py·gemini.py).
    # 같은 물음을 둘에 던져 무엇이 갈리는지 보려고 갈래를 둔다.
    ai_vendor: str = "claude"        # claude | gemini
    ai_max_tokens: int = 16000
    ai_max_turns: int = 12           # 한 물음에 도구를 몇 바퀴까지 돌릴지
    # `building` 도구를 모델에게 보일지. 끄면 스키마에서만 빠지고 핸들러·라우트는 산다
    # (`/ai/buildings` 로 여전히 찔러 볼 수 있다). 검색 `조건` 안에 묶음을 넣은 뒤
    # 바퀴가 줄었는지 보려고 둔 손잡이다 — 둘 다 보이면 모델이 옛 쪽만 쓴다.
    ai_building_tool: bool = True
    # 첫 바퀴에 도구를 **강제**한다(제미나이 mode=ANY). 안 걸면 모델이 우리 DB 를 안 보고
    # 답하거나 조건을 되묻는다(2026-09-21 실측: 「강남구에 신축하기 좋은 곳」에 도구 0번).
    ai_force_first_tool: bool = True
    # 도구 응답을 로그에 몇 자까지 남길지. 0이면 안 남긴다. 모델에게 가는 것과 같은 글이다.
    ai_log_chars: int = 4000

    anthropic_api_key: str = ""
    ai_model: str = "claude-haiku-4-5"
    # **Haiku 4.5 는 effort 를 안 받는다**(보내면 400). 등급을 올릴 때만 채운다.
    ai_effort: str = ""              # low|medium|high|xhigh|max · "" 이면 안 보낸다

    gemini_api_key: str = ""
    # lite 가 싸긴 한데 재시도가 늘어 되레 더 들 수 있다. 견주는 중이다(2026-09-19).
    # **별칭을 안 쓴다**(2026-09-21). `gemini-flash-latest` 는 문서 표 어디에도 없고
    # (모델 목록·가격·캐시 하한 전부) API 로 물어도 뭘 가리키는지 안 알려 준다.
    #
    # **2.5 로는 못 간다.** 싸긴 한데(입력 $0.30 vs 3.8 의 $0.75) `mode=ANY` 가 400 으로
    # 튕긴다 — "schema produces a constraint that has too many states for serving".
    # ANY 는 함수 호출을 강제하느라 스키마를 문법으로 컴파일하는데, 우리 98칸에 갈래값이
    # 수십 개씩 달려 2.5 의 제약 엔진이 감당을 못 한다(도구 하나만 주면 통과한다).
    # 3.8 과 flash-latest 는 같은 스키마로 통과. ANY 를 버리면 모델이 DB 를 안 보고
    # 되묻거나 지어내므로, 값을 치르고 3.8 을 쓴다(2026-09-21 실측).
    gemini_model: str = "gemini-3.8-flash"


settings = Settings()
