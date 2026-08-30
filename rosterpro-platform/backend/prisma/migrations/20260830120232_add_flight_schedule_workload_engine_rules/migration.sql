-- CreateTable
CREATE TABLE "flight_schedule_imports" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "turnRowCount" INTEGER NOT NULL DEFAULT 0,
    "charterRowCount" INTEGER NOT NULL DEFAULT 0,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_schedule_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turn_records" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "aln" TEXT,
    "inboundFlt" TEXT,
    "inboundDepSta" TEXT,
    "inboundDepMin" INTEGER,
    "inboundArrSta" TEXT,
    "inboundArrMin" INTEGER,
    "groundTimeMin" INTEGER,
    "outboundDepSta" TEXT,
    "outboundFlt" TEXT,
    "outboundDepMin" INTEGER,
    "outboundArrSta" TEXT,
    "outboundArrMin" INTEGER,
    "effectiveDate" TIMESTAMP(3),
    "discontinueDate" TIMESTAMP(3),
    "daysOfWeekPattern" TEXT,
    "remark" TEXT,

    CONSTRAINT "turn_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charter_records" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "flightDesg" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "discontinueDate" TIMESTAMP(3),
    "daysOfWeekPattern" TEXT,
    "depSta" TEXT,
    "depMin" INTEGER,
    "arrSta" TEXT,
    "arrMin" INTEGER,
    "serviceType" TEXT,

    CONSTRAINT "charter_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_workload_configs" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "transitMinutesDefault" INTEGER NOT NULL DEFAULT 40,
    "pdcMinutesBeforeDeparture" INTEGER NOT NULL DEFAULT 60,
    "clashProximityMinutes" INTEGER NOT NULL DEFAULT 60,
    "transitVsPdcThresholdMinutes" INTEGER NOT NULL DEFAULT 120,
    "movementsPerB1Staff" INTEGER NOT NULL DEFAULT 4,
    "movementsPerCMStaff" INTEGER NOT NULL DEFAULT 1,
    "movementsPerNCSStaff" INTEGER NOT NULL DEFAULT 1,
    "unplannedMethod" TEXT NOT NULL DEFAULT 'frequency',
    "unplannedManpowerHoursPerMonth" INTEGER NOT NULL DEFAULT 0,
    "unplannedBufferPct" INTEGER NOT NULL DEFAULT 20,
    "bufferB1" INTEGER NOT NULL DEFAULT 0,
    "bufferB2" INTEGER NOT NULL DEFAULT 0,
    "bufferCM" INTEGER NOT NULL DEFAULT 0,
    "bufferNCS" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_workload_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandatory_coverage_rules" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "mandatory_coverage_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_task_master_entries" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 0,
    "frequencyUnit" TEXT NOT NULL DEFAULT 'per_month',
    "avgDurationMin" INTEGER NOT NULL DEFAULT 0,
    "reqB1" INTEGER NOT NULL DEFAULT 0,
    "reqB2" INTEGER NOT NULL DEFAULT 0,
    "reqCM" INTEGER NOT NULL DEFAULT 0,
    "reqNCS" INTEGER NOT NULL DEFAULT 0,
    "preferredShift" TEXT,
    "nightApplicable" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "planned_task_master_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unplanned_task_master_entries" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avgFreqPerMonth" INTEGER NOT NULL DEFAULT 0,
    "avgDurationMin" INTEGER NOT NULL DEFAULT 0,
    "reqB1" INTEGER NOT NULL DEFAULT 0,
    "reqB2" INTEGER NOT NULL DEFAULT 0,
    "reqCM" INTEGER NOT NULL DEFAULT 0,
    "reqNCS" INTEGER NOT NULL DEFAULT 0,
    "preferredShift" TEXT,
    "nightApplicable" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "unplanned_task_master_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_demand_entries" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "timeStart" TEXT,
    "timeEnd" TEXT,
    "reqB1" INTEGER NOT NULL DEFAULT 0,
    "reqB2" INTEGER NOT NULL DEFAULT 0,
    "reqCM" INTEGER NOT NULL DEFAULT 0,
    "reqNCS" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_demand_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_groups" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "staff_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_group_members" (
    "id" TEXT NOT NULL,
    "staffGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "staff_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workload_rules" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appliesToType" TEXT NOT NULL DEFAULT 'all',
    "appliesToValue" TEXT,
    "conditionType" TEXT NOT NULL,
    "limitValue" INTEGER,
    "offDays" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workload_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_operational_adjustments" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reqB1" INTEGER NOT NULL DEFAULT 0,
    "reqB2" INTEGER NOT NULL DEFAULT 0,
    "reqCM" INTEGER NOT NULL DEFAULT 0,
    "reqNCS" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_operational_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flight_schedule_imports_stationId_year_month_key" ON "flight_schedule_imports"("stationId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "station_workload_configs_stationId_key" ON "station_workload_configs"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "mandatory_coverage_rules_stationId_category_shift_key" ON "mandatory_coverage_rules"("stationId", "category", "shift");

-- CreateIndex
CREATE UNIQUE INDEX "staff_group_members_staffGroupId_userId_key" ON "staff_group_members"("staffGroupId", "userId");

-- AddForeignKey
ALTER TABLE "flight_schedule_imports" ADD CONSTRAINT "flight_schedule_imports_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_records" ADD CONSTRAINT "turn_records_importId_fkey" FOREIGN KEY ("importId") REFERENCES "flight_schedule_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_records" ADD CONSTRAINT "charter_records_importId_fkey" FOREIGN KEY ("importId") REFERENCES "flight_schedule_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_workload_configs" ADD CONSTRAINT "station_workload_configs_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandatory_coverage_rules" ADD CONSTRAINT "mandatory_coverage_rules_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_task_master_entries" ADD CONSTRAINT "planned_task_master_entries_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unplanned_task_master_entries" ADD CONSTRAINT "unplanned_task_master_entries_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_demand_entries" ADD CONSTRAINT "manual_demand_entries_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_groups" ADD CONSTRAINT "staff_groups_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_group_members" ADD CONSTRAINT "staff_group_members_staffGroupId_fkey" FOREIGN KEY ("staffGroupId") REFERENCES "staff_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_group_members" ADD CONSTRAINT "staff_group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_rules" ADD CONSTRAINT "workload_rules_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_operational_adjustments" ADD CONSTRAINT "daily_operational_adjustments_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
