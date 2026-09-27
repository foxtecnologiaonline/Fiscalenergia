-- CreateEnum
CREATE TYPE "TariffFlag" AS ENUM ('verde', 'amarela', 'vermelha_p1', 'vermelha_p2');

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "appliedKwhRate" DOUBLE PRECISION,
ADD COLUMN     "billingDays" INTEGER,
ADD COLUMN     "consumptionKwh" DOUBLE PRECISION,
ADD COLUMN     "currentReadingKwh" DOUBLE PRECISION,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "extractedData" JSONB,
ADD COLUMN     "lineItems" JSONB,
ADD COLUMN     "previousReadingKwh" DOUBLE PRECISION,
ADD COLUMN     "tariffFlag" "TariffFlag",
ADD COLUMN     "totalAmount" DOUBLE PRECISION;
