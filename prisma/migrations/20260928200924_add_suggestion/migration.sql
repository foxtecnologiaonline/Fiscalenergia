-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('suggested', 'applied', 'dismissed');

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "consumerUnitId" TEXT NOT NULL,
    "findingId" TEXT,
    "householdApplianceId" TEXT,
    "ruleCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedSavingsKwh" DOUBLE PRECISION,
    "estimatedSavingsAmount" DOUBLE PRECISION,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'suggested',
    "appliedAt" TIMESTAMP(3),
    "appliedNote" TEXT,
    "baselineBillId" TEXT,
    "followUpBillId" TEXT,
    "actualSavingsKwh" DOUBLE PRECISION,
    "actualSavingsAmount" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suggestion_consumerUnitId_idx" ON "Suggestion"("consumerUnitId");

-- CreateIndex
CREATE INDEX "Suggestion_findingId_idx" ON "Suggestion"("findingId");

-- CreateIndex
CREATE INDEX "Suggestion_householdApplianceId_idx" ON "Suggestion"("householdApplianceId");

-- CreateIndex
CREATE INDEX "Suggestion_baselineBillId_idx" ON "Suggestion"("baselineBillId");

-- CreateIndex
CREATE INDEX "Suggestion_followUpBillId_idx" ON "Suggestion"("followUpBillId");

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_consumerUnitId_ruleCode_title_key" ON "Suggestion"("consumerUnitId", "ruleCode", "title");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_consumerUnitId_fkey" FOREIGN KEY ("consumerUnitId") REFERENCES "ConsumerUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_householdApplianceId_fkey" FOREIGN KEY ("householdApplianceId") REFERENCES "HouseholdAppliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_baselineBillId_fkey" FOREIGN KEY ("baselineBillId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_followUpBillId_fkey" FOREIGN KEY ("followUpBillId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
