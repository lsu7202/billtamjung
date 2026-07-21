# DB 마이그레이션

PostgreSQL 14+ / PostGIS. 스키마 정본 = [[../specs/04-data/schema-ddl.md]] · [[../specs/04-data/schema-ref.md]].

## 순서
| 파일 | 내용 |
|---|---|
| `0001_init_ref.sql` | 확장(postgis·pg_trgm)·스키마(master/app/ref) + 레지스트리 테이블 |
| `0002_master.sql` | master 버전 물리테이블 + 뷰 + 공간/접두/유사도 인덱스 + master_version/loads |
| `0003_app.sql` | app: 계정·팀·크레딧·매물선점·오버레이·커뮤니티·산출물 |
| `0004_functions.sql` | 트리거·함수(updated_at·오버레이검증·크레딧캐시·deduct_credit·building_view·search_polygon·신선도) |
| `0005_seed_ref.sql` | 레지스트리 시드(용도지역 UQA·주용도·등급·명도·필드·가중치) |

## 로컬 적용 (Docker PostGIS)
```bash
docker run -d --name bt_pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=billtamjung \
  -p 55432:5432 postgis/postgis:16-3.4
for f in db/migrations/[0-9]*.sql; do
  docker exec -i bt_pg psql -U postgres -d billtamjung -v ON_ERROR_STOP=1 < "$f"
done
```
또는 `DATABASE_URL="-h localhost -p 55432 -U postgres -d billtamjung" ./db/apply.sh`

## 검증 상태
2026-07-21 PostGIS 16-3.4 컨테이너에서 0001~0005 전량 적용·스모크 통과
(크레딧 캐시 트리거·오버레이 병합·enum 검증·deduct_credit).
