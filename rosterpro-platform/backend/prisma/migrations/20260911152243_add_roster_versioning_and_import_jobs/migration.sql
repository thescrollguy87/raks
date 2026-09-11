-- CreateTable
CREATE TABLE "roster_versions" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "reason" TEXT,
    "isPublishedSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "restoredFromVersionId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roster_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_version_items" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftDate" DATE NOT NULL,
    "shiftDefId" TEXT NOT NULL,
    "shiftCode" TEXT NOT NULL,
    "note" TEXT,
    "in1" TEXT,
    "out1" TEXT,
    "in2" TEXT,
    "out2" TEXT,

    CONSTRAINT "roster_version_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "warningRows" INTEGER NOT NULL,
    "errorRows" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "validatedPayload" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_errors" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "field" TEXT,
    "value" TEXT,
    "message" TEXT NOT NULL,
    "suggestion" TEXT,
    "severity" TEXT NOT NULL,

    CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roster_versions_rosterId_idx" ON "roster_versions"("rosterId");

-- CreateIndex
CREATE UNIQUE INDEX "roster_versions_rosterId_versionNumber_key" ON "roster_versions"("rosterId", "versionNumber");

-- CreateIndex
CREATE INDEX "roster_version_items_versionId_idx" ON "roster_version_items"("versionId");

-- CreateIndex
CREATE INDEX "import_jobs_stationId_idx" ON "import_jobs"("stationId");

-- CreateIndex
CREATE INDEX "import_jobs_createdAt_idx" ON "import_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "import_errors_jobId_idx" ON "import_errors"("jobId");

-- AddForeignKey
ALTER TABLE "roster_versions" ADD CONSTRAINT "roster_versions_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "rosters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_version_items" ADD CONSTRAINT "roster_version_items_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "roster_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
