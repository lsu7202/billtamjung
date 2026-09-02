# backups/ — DB 덤프 자리

`scripts/deploy/load_db.sh` 가 기본으로 `backups/billtamjung.dump` 를 찾는다.
폴더 안의 덤프는 gitignore 다. 이 README 만 추적한다.

2026-09-02 에 08-03 자 덤프(535MB)를 지웠다 — 그때 DB 는 parcels v4 였고 지금은 v6 라
되돌릴 대상이 아니었다. 새로 뜨려면:

    docker exec docker-db-1 pg_dump -U postgres -Fc billtamjung > backups/billtamjung.dump
