import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ConsumerUnitForm } from "@/components/units/consumer-unit-form";
import { DeleteConsumerUnitButton } from "@/components/units/delete-consumer-unit-button";

export default async function ConsumerUnitDetailPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { unitId } = await params;
  const unit = await db.consumerUnit.findUnique({ where: { id: unitId } });

  if (!unit || unit.ownerId !== session.user.id) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Editar unidade consumidora</h1>
        <DeleteConsumerUnitButton unitId={unit.id} />
      </div>
      <ConsumerUnitForm
        mode="edit"
        unitId={unit.id}
        initialValues={{
          code: unit.code,
          distributor: unit.distributor,
          uf: unit.uf,
          city: unit.city,
          tariffGroup: unit.tariffGroup,
          tariffSubgroup: unit.tariffSubgroup,
          tariffModality: unit.tariffModality,
          contractedDemandKw: unit.contractedDemandKw,
        }}
      />

      <div className="mt-6 flex flex-col gap-2 border-t pt-6">
        <Button asChild variant="outline" className="w-full">
          <Link href={`/units/${unit.id}/bills`}>Ver faturas</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href={`/units/${unit.id}/appliances`}>
            Varredura de aparelhos
          </Link>
        </Button>
      </div>
    </div>
  );
}
