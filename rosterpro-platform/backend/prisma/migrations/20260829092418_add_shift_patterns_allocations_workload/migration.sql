-- CreateTable
CREATE TABLE "shift_patterns" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "shift_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_shift_allocations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patternId" TEXT,
    "cycleStartDay" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_shift_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workload_items" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "b1" INTEGER NOT NULL DEFAULT 0,
    "b2" INTEGER NOT NULL DEFAULT 0,
    "cm" INTEGER NOT NULL DEFAULT 0,
    "ncs" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "workload_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_patterns_stationId_code_key" ON "shift_patterns"("stationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "staff_shift_allocations_userId_key" ON "staff_shift_allocations"("userId");

-- AddForeignKey
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shift_allocations" ADD CONSTRAINT "staff_shift_allocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shift_allocations" ADD CONSTRAINT "staff_shift_allocations_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "shift_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_items" ADD CONSTRAINT "workload_items_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
