-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('pending', 'processing', 'done', 'error');

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "consumerUnitId" TEXT NOT NULL,
    "referenceMonth" TIMESTAMP(3) NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bill_consumerUnitId_idx" ON "Bill"("consumerUnitId");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_consumerUnitId_fkey" FOREIGN KEY ("consumerUnitId") REFERENCES "ConsumerUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
