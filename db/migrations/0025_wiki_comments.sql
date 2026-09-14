-- 0025_wiki_comments.sql — 위키 댓글(집단지성 대화). specs S02 §4.2
BEGIN;

CREATE TABLE IF NOT EXISTS app.wiki_comments (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id           bigint NOT NULL REFERENCES app.wiki_posts(id),
  author_account_id bigint REFERENCES app.accounts(id),
  body              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS wiki_comments_post ON app.wiki_comments(post_id) WHERE deleted_at IS NULL;

COMMIT;
