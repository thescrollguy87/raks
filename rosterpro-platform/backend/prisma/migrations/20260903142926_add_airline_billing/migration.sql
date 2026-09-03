-- CreateTable
CREATE TABLE "airline_billing" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "trialStartAt" TIMESTAMP(3) NOT NULL,
    "trialEndAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "nextBillingDate" TIMESTAMP(3) NOT NULL,
    "razorpayCustomerId" TEXT,
    "paymentMethodToken" TEXT,
    "paymentMethodLast4" TEXT,
    "paymentMethodNetwork" TEXT,
    "paymentMethodAddedAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "firstFailureAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airline_billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_charges" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "staffCount" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "razorpayPaymentId" TEXT,
    "razorpayOrderId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "airline_billing_airlineId_key" ON "airline_billing"("airlineId");

-- CreateIndex
CREATE INDEX "billing_charges_billingId_idx" ON "billing_charges"("billingId");

-- AddForeignKey
ALTER TABLE "airline_billing" ADD CONSTRAINT "airline_billing_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "airlines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "airline_billing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
