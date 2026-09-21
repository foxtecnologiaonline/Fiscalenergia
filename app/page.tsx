import Link from "next/link";

import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Fiscalenergia</h1>
      <p className="max-w-md text-muted-foreground">
        SaaS de fiscalização de consumo de energia elétrica.
      </p>

      {session?.user ? (
        <div className="flex flex-col items-center gap-4">
          <p>
            Você está logado como{" "}
            <span className="font-medium">{session.user.email}</span>.
          </p>
          <LogoutButton />
        </div>
      ) : (
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/register">Criar conta</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
