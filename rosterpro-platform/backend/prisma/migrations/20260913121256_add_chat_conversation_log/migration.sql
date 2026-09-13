-- CreateTable
CREATE TABLE "chat_conversation_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "stationId" TEXT,
    "airlineId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "toolCalls" JSONB,
    "outcome" TEXT NOT NULL DEFAULT 'answered',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_conversation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_conversation_logs_userId_idx" ON "chat_conversation_logs"("userId");

-- CreateIndex
CREATE INDEX "chat_conversation_logs_stationId_idx" ON "chat_conversation_logs"("stationId");

-- CreateIndex
CREATE INDEX "chat_conversation_logs_createdAt_idx" ON "chat_conversation_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "chat_conversation_logs" ADD CONSTRAINT "chat_conversation_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
