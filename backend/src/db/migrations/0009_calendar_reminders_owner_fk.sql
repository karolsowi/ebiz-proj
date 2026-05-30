-- Sprint polish: make calendar reminder ownership relational

DELETE FROM "calendar_reminders"
WHERE "created_by" IS NULL
   OR NOT EXISTS (
    SELECT 1 FROM "users" WHERE "users"."id" = "calendar_reminders"."created_by"
  );

ALTER TABLE "calendar_reminders"
  ALTER COLUMN "created_by" TYPE VARCHAR(36),
  ALTER COLUMN "created_by" SET NOT NULL;

ALTER TABLE "calendar_reminders"
  DROP CONSTRAINT IF EXISTS "calendar_reminders_created_by_users_id_fk";

ALTER TABLE "calendar_reminders"
  ADD CONSTRAINT "calendar_reminders_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE;
