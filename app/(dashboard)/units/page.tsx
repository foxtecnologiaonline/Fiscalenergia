import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";

export default async function UnitsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const units = await db.consumerUnit.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Unidades consumidoras</h1>
        <Button asChild>
          <Link href="/units/new">Nova UC</Link>
        </Button>
      </div>

      {units.length === 0 ? (
        <p className="text-muted-foreground">
          Você ainda não cadastrou nenhuma UC.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Código</th>
                <th className="px-4 py-2 font-medium">Distribuidora</th>
                <th className="px-4 py-2 font-medium">Cidade/UF</th>
                <th className="px-4 py-2 font-medium">Grupo</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link
                      href={`/units/${unit.id}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {unit.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{unit.distributor}</td>
                  <td className="px-4 py-2">
                    {unit.city}/{unit.uf}
                  </td>
                  <td className="px-4 py-2">{unit.tariffGroup}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
