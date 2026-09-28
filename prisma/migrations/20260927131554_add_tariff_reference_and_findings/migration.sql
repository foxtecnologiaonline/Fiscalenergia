-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('billing_error', 'reading_error', 'appliance_inefficiency', 'possible_waste_or_loss', 'consumption_anomaly');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "TariffReference" (
    "id" TEXT NOT NULL,
    "distributor" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "tariffGroup" "TariffGroup" NOT NULL,
    "tariffSubgroup" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "kwhRate" DOUBLE PRECISION NOT NULL,
    "icmsRate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TariffReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffFlagHistory" (
    "id" TEXT NOT NULL,
    "referenceMonth" TIMESTAMP(3) NOT NULL,
    "flag" "TariffFlag" NOT NULL,

    CONSTRAINT "TariffFlagHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "consumerUnitId" TEXT NOT NULL,
    "billId" TEXT,
    "type" "FindingType" NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedImpactAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TariffReference_distributor_uf_tariffGroup_tariffSubgroup_v_key" ON "TariffReference"("distributor", "uf", "tariffGroup", "tariffSubgroup", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TariffFlagHistory_referenceMonth_key" ON "TariffFlagHistory"("referenceMonth");

-- CreateIndex
CREATE INDEX "Finding_consumerUnitId_idx" ON "Finding"("consumerUnitId");

-- CreateIndex
CREATE INDEX "Finding_billId_idx" ON "Finding"("billId");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_consumerUnitId_fkey" FOREIGN KEY ("consumerUnitId") REFERENCES "ConsumerUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
