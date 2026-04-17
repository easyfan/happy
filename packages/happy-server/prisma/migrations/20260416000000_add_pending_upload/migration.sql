-- CreateEnum
CREATE TYPE "UploadDirection" AS ENUM ('app_to_cli', 'cli_to_app');

-- CreateTable
CREATE TABLE "PendingUpload" (
    "uploadId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "encryptedMeta" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "direction" "UploadDirection" NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "downloadedAt" TIMESTAMP(3),

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("uploadId")
);

-- CreateIndex
CREATE INDEX "PendingUpload_expiresAt_idx" ON "PendingUpload"("expiresAt");

-- CreateIndex
CREATE INDEX "PendingUpload_accountId_sessionId_idx" ON "PendingUpload"("accountId", "sessionId");

-- CreateIndex
CREATE INDEX "PendingUpload_accountId_notified_idx" ON "PendingUpload"("accountId", "notified");

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
