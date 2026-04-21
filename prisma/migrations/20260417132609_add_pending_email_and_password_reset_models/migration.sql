-- CreateTable
CREATE TABLE "PendingEmailChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingEmailChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingPasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingPasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingEmailChange_tokenHash_key" ON "PendingEmailChange"("tokenHash");

-- CreateIndex
CREATE INDEX "PendingEmailChange_userId_idx" ON "PendingEmailChange"("userId");

-- CreateIndex
CREATE INDEX "PendingEmailChange_expiresAt_idx" ON "PendingEmailChange"("expiresAt");

-- CreateIndex
CREATE INDEX "PendingEmailChange_newEmail_idx" ON "PendingEmailChange"("newEmail");

-- CreateIndex
CREATE UNIQUE INDEX "PendingPasswordReset_tokenHash_key" ON "PendingPasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PendingPasswordReset_userId_idx" ON "PendingPasswordReset"("userId");

-- CreateIndex
CREATE INDEX "PendingPasswordReset_expiresAt_idx" ON "PendingPasswordReset"("expiresAt");

-- AddForeignKey
ALTER TABLE "PendingEmailChange" ADD CONSTRAINT "PendingEmailChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingPasswordReset" ADD CONSTRAINT "PendingPasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
