-- CreateTable
CREATE TABLE "departure_manpower_assignments" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "flightRef" TEXT NOT NULL,
    "releaserUserId" TEXT,
    "releaserCategory" TEXT,
    "supportUserId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departure_manpower_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departure_manpower_assignments_stationId_date_eventType_eve_key" ON "departure_manpower_assignments"("stationId", "date", "eventType", "eventId");

-- AddForeignKey
ALTER TABLE "departure_manpower_assignments" ADD CONSTRAINT "departure_manpower_assignments_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departure_manpower_assignments" ADD CONSTRAINT "departure_manpower_assignments_releaserUserId_fkey" FOREIGN KEY ("releaserUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departure_manpower_assignments" ADD CONSTRAINT "departure_manpower_assignments_supportUserId_fkey" FOREIGN KEY ("supportUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
