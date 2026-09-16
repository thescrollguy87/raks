-- CreateEnum
CREATE TYPE "AttendancePunchStatus" AS ENUM ('ON_TIME', 'LATE', 'EARLY_OUT', 'MISSING', 'REGULARIZED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "RegularizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegularizationReason" AS ENUM ('FORGOT_TO_PUNCH', 'FLIGHT_DUTY', 'DEPUTATION', 'NETWORK_ISSUE', 'OTHER');

-- CreateTable
CREATE TABLE "office_locations" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 200,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "office_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scheduledShiftDefId" TEXT,
    "scheduledShiftCode" TEXT,
    "scheduledStartTime" TEXT,
    "scheduledEndTime" TEXT,
    "punchInAt" TIMESTAMP(3),
    "punchInSyncedAt" TIMESTAMP(3),
    "punchInLat" DOUBLE PRECISION,
    "punchInLng" DOUBLE PRECISION,
    "punchInAccuracy" DOUBLE PRECISION,
    "punchInDistanceM" DOUBLE PRECISION,
    "punchInLocationId" TEXT,
    "punchInPhoto" BYTEA,
    "punchInPhotoMime" TEXT,
    "punchInDevice" TEXT,
    "punchInMockSuspected" BOOLEAN NOT NULL DEFAULT false,
    "punchOutAt" TIMESTAMP(3),
    "punchOutSyncedAt" TIMESTAMP(3),
    "punchOutLat" DOUBLE PRECISION,
    "punchOutLng" DOUBLE PRECISION,
    "punchOutAccuracy" DOUBLE PRECISION,
    "punchOutDistanceM" DOUBLE PRECISION,
    "punchOutLocationId" TEXT,
    "punchOutPhoto" BYTEA,
    "punchOutPhotoMime" TEXT,
    "punchOutDevice" TEXT,
    "punchOutMockSuspected" BOOLEAN NOT NULL DEFAULT false,
    "status" "AttendancePunchStatus" NOT NULL DEFAULT 'MISSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regularization_requests" (
    "id" TEXT NOT NULL,
    "attendanceRecordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "RegularizationReason" NOT NULL,
    "detail" TEXT,
    "status" "RegularizationStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "regularization_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "office_locations_stationId_idx" ON "office_locations"("stationId");

-- CreateIndex
CREATE INDEX "attendance_records_stationId_date_idx" ON "attendance_records"("stationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_userId_date_key" ON "attendance_records"("userId", "date");

-- CreateIndex
CREATE INDEX "regularization_requests_attendanceRecordId_idx" ON "regularization_requests"("attendanceRecordId");

-- CreateIndex
CREATE INDEX "regularization_requests_userId_idx" ON "regularization_requests"("userId");

-- AddForeignKey
ALTER TABLE "office_locations" ADD CONSTRAINT "office_locations_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
