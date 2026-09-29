import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeleteConsumerUnitButton } from "@/components/units/delete-consumer-unit-button";
import { ConsumerUnitForm } from "@/components/units/consumer-unit-form";

export default async function EditConsumerUnitPage({
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
      <Link
        href={`/units/${unit.id}`}
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        &larr; {unit.code}
      </Link>
      <div className="mt-2 mb-6 flex items-center justify-between">
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
    </div>
  );
}
