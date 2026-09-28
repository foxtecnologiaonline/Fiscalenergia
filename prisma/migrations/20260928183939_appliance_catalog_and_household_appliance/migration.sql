-- CreateEnum
CREATE TYPE "Room" AS ENUM ('cozinha', 'sala', 'quarto', 'banheiro', 'area_servico', 'escritorio', 'area_externa');

-- CreateEnum
CREATE TYPE "ApplianceCondition" AS ENUM ('novo', 'normal', 'antigo', 'sem_manutencao');

-- CreateTable
CREATE TABLE "ApplianceCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "room" "Room" NOT NULL,
    "typicalPowerW" DOUBLE PRECISION NOT NULL,
    "typicalUsageHoursPerDay" DOUBLE PRECISION NOT NULL,
    "typicalUsageDaysPerWeek" DOUBLE PRECISION NOT NULL,
    "referenceKwhMonth" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "ApplianceCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdAppliance" (
    "id" TEXT NOT NULL,
    "consumerUnitId" TEXT NOT NULL,
    "catalogId" TEXT,
    "name" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "powerW" DOUBLE PRECISION NOT NULL,
    "usageHoursPerDay" DOUBLE PRECISION NOT NULL,
    "usageDaysPerWeek" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "ageYears" DOUBLE PRECISION,
    "lastMaintenanceAt" TIMESTAMP(3),
    "condition" "ApplianceCondition" NOT NULL DEFAULT 'normal',
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseholdAppliance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplianceCatalog_room_idx" ON "ApplianceCatalog"("room");

-- CreateIndex
CREATE INDEX "HouseholdAppliance_consumerUnitId_idx" ON "HouseholdAppliance"("consumerUnitId");

-- AddForeignKey
ALTER TABLE "HouseholdAppliance" ADD CONSTRAINT "HouseholdAppliance_consumerUnitId_fkey" FOREIGN KEY ("consumerUnitId") REFERENCES "ConsumerUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdAppliance" ADD CONSTRAINT "HouseholdAppliance_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "ApplianceCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
