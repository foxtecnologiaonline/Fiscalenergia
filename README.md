# Fiscalenergia

SaaS de fiscalização de consumo de energia elétrica. Responde a 5 perguntas do usuário:

1. A fatura está certa? (bandeira, tarifa de kWh, taxas, matemática)
2. A leitura de consumo está certa? (leitura anterior x atual x kWh faturado)
3. Algum aparelho está gastando mais do que deveria? (defasado, sem manutenção, acima da referência)
4. Há indício de desperdício, dispersão ou desvio de energia?
5. O que fazer para economizar, e funcionou? (sugestões com acompanhamento na fatura seguinte)

Público: empresas (com uma ou várias unidades consumidoras) e consumidores finais.

Veja o escopo completo e o plano de implementação em [`docs/SCOPE.md`](docs/SCOPE.md).

## Stack (Fase 0)

Next.js (App Router) + TypeScript, Tailwind CSS + shadcn/ui, Prisma + Postgres,
Auth.js (credenciais e-mail/senha). Gerenciador de pacotes: pnpm.

## Rodando localmente

1. Suba um Postgres local (ou use um serviço como Neon) e copie `.env.example`
   para `.env`, preenchendo `DATABASE_URL` e `NEXTAUTH_SECRET`
   (`openssl rand -base64 32`).
2. Instale as dependências e gere o client do Prisma:
   ```bash
   pnpm install
   ```
3. Aplique as migrations:
   ```bash
   pnpm db:migrate
   ```
4. Rode o app:
   ```bash
   pnpm dev
   ```
5. Acesse `http://localhost:3000`, crie uma conta em `/register` e faça login
   em `/login`.

### Scripts úteis

- `pnpm lint` — ESLint
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest + Testing Library
- `pnpm build` — build de produção do Next.js
- `pnpm db:migrate` — cria/aplica migrations do Prisma em desenvolvimento
- `pnpm db:generate` — regenera o Prisma Client

## CI

`.github/workflows/ci.yml` roda lint, typecheck, testes e build a cada push/PR,
subindo um Postgres de serviço para aplicar as migrations (`prisma migrate
deploy`) antes do build.

## Deploy (Vercel)

O projeto ainda não está deployado. Para o deploy inicial:

1. Crie um projeto na Vercel a partir deste repositório
   (`vercel link` ou pela dashboard).
2. Provisione um Postgres (Neon ou Vercel Postgres) e configure em
   **Project Settings → Environment Variables** as mesmas chaves de
   `.env.example`: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
   (URL de produção do projeto), `BLOB_READ_WRITE_TOKEN`,
   `ANTHROPIC_API_KEY`, `RESEND_API_KEY`.
3. Rode `pnpm prisma migrate deploy` contra o banco de produção (localmente
   apontando `DATABASE_URL` para ele, ou via um passo de deploy) antes do
   primeiro acesso — o build da Vercel só gera o Prisma Client, não aplica
   migrations.
4. Faça o deploy (`vercel --prod` ou push para a branch conectada) e valide
   que `/register` e `/login` funcionam em produção.
