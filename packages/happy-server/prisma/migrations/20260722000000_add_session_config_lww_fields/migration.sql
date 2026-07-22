-- Add effortLevel column and three LWW server-time timestamp columns to Session table (FEAT-16).
-- All columns fully nullable; no backfill. Existing rows get NULL (safe for scheme-A value-compare reconciliation).
ALTER TABLE "Session" ADD COLUMN "effortLevel" TEXT;
ALTER TABLE "Session" ADD COLUMN "permissionModeUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "modelModeUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "effortLevelUpdatedAt" TIMESTAMP(3);
