-- CreateEnum
CREATE TYPE "TaskAllocationStatus" AS ENUM ('DRAFT', 'READY', 'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "TaskAllocationConflictType" AS ENUM ('EMPLOYEE_OVERLAP', 'QUALIFICATION', 'LOCATION_TRAVEL', 'DEADLINE', 'RESOURCE_SHORTAGE');

-- CreateEnum
CREATE TYPE "TaskAllocationConflictSeverity" AS ENUM ('WARNING', 'BLOCKING');

-- CreateEnum
CREATE TYPE "TaskAllocationTrigger" AS ENUM ('MANUAL', 'INITIAL_AUTO_ALLOCATION', 'FLIGHT_DELAY', 'FLIGHT_CANCELLATION', 'AIRCRAFT_SWAP', 'NEW_DEFECT', 'TASK_OVERRUN', 'STAFF_ABSENCE', 'STAFF_UNAVAILABLE', 'NEW_TASK', 'TASK_CANCELLATION', 'STAND_CHANGE', 'OPERATIONAL_DISRUPTION');

-- CreateTable
CREATE TABLE "task_allocation_flight_instances" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "flightDate" DATE NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "aircraftRegistration" TEXT NOT NULL,
    "aircraftType" TEXT,
    "std" TIMESTAMP(3),
    "sta" TIMESTAMP(3),
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "stand" TEXT,
    "terminal" TEXT,
    "isTransit" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "task_allocation_flight_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_rules" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'BOTH',
    "onlyTransit" BOOLEAN NOT NULL DEFAULT false,
    "startOffsetMin" INTEGER NOT NULL,
    "latestStartOffsetMin" INTEGER NOT NULL,
    "deadlineOffsetMin" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "requiredRole" TEXT,
    "requiredCategory" "StaffCategory",
    "requiredAircraftType" TEXT,
    "requiredAuthorization" TEXT,
    "teamSize" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "taskDescription" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "allocation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_settings" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "weightDeadline" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "weightWorkloadBalance" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "weightTravelTime" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "weightTaskContinuity" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "weightResourceUtilization" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "weightIdleTimeReduction" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "weightFairness" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "autoRefreshSeconds" INTEGER NOT NULL DEFAULT 60,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_time_matrix" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "fromLocation" TEXT NOT NULL,
    "toLocation" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_time_matrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_tasks" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "taskNumber" TEXT NOT NULL,
    "flightInstanceId" TEXT,
    "flightNumber" TEXT,
    "aircraftRegistration" TEXT,
    "aircraftType" TEXT,
    "taskType" TEXT NOT NULL,
    "taskCategory" TEXT,
    "taskDescription" TEXT,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "latestStart" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "estimatedDurationMin" INTEGER NOT NULL,
    "requiredRole" TEXT,
    "requiredCategory" "StaffCategory",
    "requiredAircraftType" TEXT,
    "requiredAuthorization" TEXT,
    "location" TEXT,
    "terminal" TEXT,
    "stand" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "teamSize" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "ruleId" TEXT,
    "status" "TaskAllocationStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "maintenance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "travelTimeMinutes" INTEGER,
    "workloadBeforePct" DOUBLE PRECISION,
    "workloadAfterPct" DOUBLE PRECISION,
    "runId" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_explanations" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "travelTimeMinutes" INTEGER,
    "workloadBeforePct" DOUBLE PRECISION,
    "workloadAfterPct" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "scoreBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_candidates" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "ineligibleReasons" JSONB,
    "score" DOUBLE PRECISION,
    "scoreBreakdown" JSONB,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_runs" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "runType" TEXT NOT NULL DEFAULT 'AUTO_ALLOCATION',
    "trigger" "TaskAllocationTrigger" NOT NULL DEFAULT 'MANUAL',
    "triggerDetail" TEXT,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "shiftFilter" TEXT,
    "taskSourceFilter" TEXT,
    "tasksProcessed" INTEGER NOT NULL DEFAULT 0,
    "tasksAssigned" INTEGER NOT NULL DEFAULT 0,
    "tasksUnassigned" INTEGER NOT NULL DEFAULT 0,
    "conflictsCount" INTEGER NOT NULL DEFAULT 0,
    "warningsCount" INTEGER NOT NULL DEFAULT 0,
    "isCommitted" BOOLEAN NOT NULL DEFAULT true,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_events" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "runId" TEXT,
    "taskId" TEXT,
    "eventType" TEXT NOT NULL,
    "previousUserId" TEXT,
    "newUserId" TEXT,
    "reason" TEXT,
    "trigger" "TaskAllocationTrigger",
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_conflicts" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "conflictType" "TaskAllocationConflictType" NOT NULL,
    "severity" "TaskAllocationConflictSeverity" NOT NULL DEFAULT 'BLOCKING',
    "userId" TEXT,
    "relatedTaskId" TEXT,
    "details" JSONB,
    "message" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_status_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "TaskAllocationStatus",
    "toStatus" "TaskAllocationStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_allocation_flight_instances_stationId_flightDate_idx" ON "task_allocation_flight_instances"("stationId", "flightDate");

-- CreateIndex
CREATE INDEX "allocation_rules_stationId_isEnabled_idx" ON "allocation_rules"("stationId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_settings_stationId_key" ON "allocation_settings"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "travel_time_matrix_stationId_fromLocation_toLocation_key" ON "travel_time_matrix"("stationId", "fromLocation", "toLocation");

-- CreateIndex
CREATE INDEX "maintenance_tasks_stationId_plannedStart_idx" ON "maintenance_tasks"("stationId", "plannedStart");

-- CreateIndex
CREATE INDEX "maintenance_tasks_status_idx" ON "maintenance_tasks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_tasks_stationId_taskNumber_key" ON "maintenance_tasks"("stationId", "taskNumber");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependsOnTaskId_key" ON "task_dependencies"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "task_assignments_taskId_idx" ON "task_assignments"("taskId");

-- CreateIndex
CREATE INDEX "task_assignments_userId_idx" ON "task_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_explanations_assignmentId_key" ON "allocation_explanations"("assignmentId");

-- CreateIndex
CREATE INDEX "allocation_candidates_runId_taskId_idx" ON "allocation_candidates"("runId", "taskId");

-- CreateIndex
CREATE INDEX "allocation_runs_stationId_startedAt_idx" ON "allocation_runs"("stationId", "startedAt");

-- CreateIndex
CREATE INDEX "allocation_events_stationId_createdAt_idx" ON "allocation_events"("stationId", "createdAt");

-- CreateIndex
CREATE INDEX "allocation_events_taskId_idx" ON "allocation_events"("taskId");

-- CreateIndex
CREATE INDEX "task_conflicts_stationId_taskId_idx" ON "task_conflicts"("stationId", "taskId");

-- CreateIndex
CREATE INDEX "task_conflicts_isResolved_idx" ON "task_conflicts"("isResolved");

-- CreateIndex
CREATE INDEX "task_status_history_taskId_idx" ON "task_status_history"("taskId");

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_flightInstanceId_fkey" FOREIGN KEY ("flightInstanceId") REFERENCES "task_allocation_flight_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "maintenance_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "maintenance_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "maintenance_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_explanations" ADD CONSTRAINT "allocation_explanations_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "task_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_candidates" ADD CONSTRAINT "allocation_candidates_runId_fkey" FOREIGN KEY ("runId") REFERENCES "allocation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_events" ADD CONSTRAINT "allocation_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "allocation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_conflicts" ADD CONSTRAINT "task_conflicts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "maintenance_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "maintenance_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
