-- 0257 · 사무소 · 일정 칸에 FK(2026-10-08 대표 승인)
--
-- 지워진 24번 사무소(8월 테스트 팀)의 일정 15건 · 매도자 4명이 남아 있었다. FK 가 없어
-- 사무소만 사라지고 딸린 줄이 고아로 남은 것이다. FK 는 걸 때 이미 있는 줄도 검사하므로
-- 고아를 먼저 지운다(목록은 대화에서 확인받음). 참석자는 schedule_people FK(cascade)로 같이 간다.
BEGIN;

DELETE FROM app.schedules s WHERE NOT EXISTS (SELECT 1 FROM app.teams t WHERE t.id = s.team_id);
DELETE FROM app.owners o WHERE NOT EXISTS (SELECT 1 FROM app.teams t WHERE t.id = o.team_id);

-- 사무소가 지워지면 같이 지워진다
ALTER TABLE app.schedules
  ADD CONSTRAINT schedules_team_id_fkey FOREIGN KEY (team_id) REFERENCES app.teams(id) ON DELETE CASCADE;
ALTER TABLE app.owners
  ADD CONSTRAINT owners_team_id_fkey FOREIGN KEY (team_id) REFERENCES app.teams(id) ON DELETE CASCADE;
ALTER TABLE app.listing_parcels
  ADD CONSTRAINT listing_parcels_team_id_fkey FOREIGN KEY (team_id) REFERENCES app.teams(id) ON DELETE CASCADE;

-- 담당 · 연결은 가리키던 것이 지워지면 비운다(일정 자체는 남는다)
ALTER TABLE app.schedules
  ADD CONSTRAINT schedules_assignee_account_id_fkey FOREIGN KEY (assignee_account_id) REFERENCES app.accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT schedules_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES app.proposals(id) ON DELETE SET NULL,
  ADD CONSTRAINT schedules_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES app.contacts(id) ON DELETE SET NULL,
  ADD CONSTRAINT schedules_promoted_by_contact_id_fkey FOREIGN KEY (promoted_by_contact_id) REFERENCES app.contacts(id) ON DELETE SET NULL;
ALTER TABLE app.contacts
  ADD CONSTRAINT contacts_src_schedule_id_fkey FOREIGN KEY (src_schedule_id) REFERENCES app.schedules(id) ON DELETE SET NULL;

COMMIT;
