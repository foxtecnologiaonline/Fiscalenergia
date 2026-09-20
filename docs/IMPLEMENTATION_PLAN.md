# Fiscalenergia — Plano de Implementação Detalhado

> Companion de [`docs/SCOPE.md`](./SCOPE.md). O SCOPE.md define o quê e o
> porquê (visão, regras de negócio, modelo de dados conceitual); este
> documento define o como, fase a fase, para ser executado com Claude Code.
>
> **Regra de ouro**: uma fase por vez. Cada fase termina com build,
> lint, typecheck e testes passando, e com um commit próprio, antes de
> começar a próxima. Não adiante tarefas de fases futuras — a coluna
> "Fora de escopo" existe para evitar isso.

## Convenções gerais (valem para todas as fases)

- **Gerenciador de pacotes**: pnpm.
- **Validação**: Zod — todo input de API/formulário passa por um schema
  Zod antes de tocar o banco.
- **Banco/ORM**: Postgres + Prisma. Toda mudança de schema é uma migration
  (`prisma migrate dev`), nunca edição manual do banco.
- **Testes**: Vitest + Testing Library para unidade/integração. Playwright
  fica para depois do MVP (não é bloqueante em nenhuma fase abaixo).
- **E-mail transacional**: Resend.
- **Gráficos**: Recharts (integra bem com shadcn/ui).
- **Cliente Anthropic**: `@anthropic-ai/sdk`, chave em `ANTHROPIC_API_KEY`.

### Estrutura de pastas alvo

```
/app
  /(auth)/login
  /(auth)/register
  /(dashboard)/units
  /(dashboard)/units/[unitId]
  /(dashboard)/units/[unitId]/appliances
  /(dashboard)/units/[unitId]/bills
  /(dashboard)/units/[unitId]/bills/[billId]
  /(dashboard)/units/[unitId]/suggestions
  /api/auth/[...nextauth]
  /api/consumer-units
  /api/consumer-units/[unitId]/appliances
  /api/bills
  /api/bills/[billId]/process
  /api/suggestions/[suggestionId]/apply
/lib
  db.ts                -- Prisma client singleton
  auth.ts               -- config do Auth.js
  claude.ts             -- client Anthropic + função de extração
  calculations.ts        -- fórmula de consumo estimado por aparelho
  rules/
    billing.ts           -- regras 5.1 (fatura)
    reading.ts            -- regras 5.2 (leitura)
    appliance-efficiency.ts -- regras 5.3
    waste.ts              -- regras 5.4
    ranking.ts             -- regra 5.5
    suggestions.ts          -- geração de Suggestion (5.6)
/prisma
  schema.prisma
  seed.ts               -- ApplianceCatalog, TariffReference, TariffFlagHistory
/components
  ui/                   -- shadcn/ui
  bills/, appliances/, dashboard/
/tests
```

Cada fase abaixo referencia esses caminhos; ajuste apenas se houver um
motivo técnico concreto para desviar.

---

## Fase 0 — Setup do projeto

**Objetivo**: ambiente rodando, vazio, mas com toda a fundação (auth,
banco, deploy) funcionando ponta a ponta.

**Tarefas**
- [ ] `create-next-app` (App Router, TypeScript, Tailwind, ESLint).
- [ ] Configurar Prisma com Postgres (Neon ou Vercel Postgres); schema
      inicial só com `User` (id, email, name, passwordHash, createdAt).
- [ ] Configurar Auth.js (credenciais e-mail/senha, ou magic link) usando
      o `User` do Prisma.
- [ ] Configurar Vercel Blob (env var de token).
- [ ] Criar `.env.example` com todas as variáveis necessárias
      (`DATABASE_URL`, `NEXTAUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`,
      `ANTHROPIC_API_KEY`, `RESEND_API_KEY`).
- [ ] Configurar shadcn/ui + tema base do Tailwind.
- [ ] CI (GitHub Actions ou checks da Vercel): lint + typecheck + testes
      a cada push.
- [ ] Deploy inicial na Vercel (mesmo com app vazio) para validar o
      pipeline.

**Critérios de aceite**
- Usuário consegue criar conta e fazer login em ambiente local e no
  deploy da Vercel.
- `pnpm build`, `pnpm lint`, `pnpm typecheck` e `pnpm test` rodam sem
  erro localmente e no CI.

**Fora de escopo**: qualquer tela ou modelo além de `User`/autenticação.

---

## Fase 1 — Contas, empresas e unidades consumidoras (UC)

**Depende de**: Fase 0.

**Modelo de dados** (adicionar ao `schema.prisma`)
```
Company        { id, name, cnpj, ownerId -> User }
ConsumerUnit   { id, ownerId -> User, companyId? -> Company, code,
                 distributor, uf, city, tariffGroup, tariffSubgroup,
                 tariffModality, contractedDemandKw? }
```

**Tarefas**
- [ ] Migration para `Company` e `ConsumerUnit`.
- [ ] `app/api/consumer-units/route.ts` (GET lista do usuário logado,
      POST cria) e `app/api/consumer-units/[unitId]/route.ts`
      (GET/PATCH/DELETE).
- [ ] Middleware/guard: todas as rotas de `/api/consumer-units/*` exigem
      sessão e verificam que o `ownerId` bate com o usuário logado.
- [ ] Telas: `app/(dashboard)/units/page.tsx` (lista), `.../units/new`
      (form de cadastro), `.../units/[unitId]/page.tsx` (detalhe/editar).
- [ ] Formulário com Zod (código UC, distribuidora, UF, cidade, grupo
      tarifário A/B, subgrupo, modalidade, demanda contratada se grupo A).
- [ ] Testes de integração das rotas de API (criar, listar, isolar por
      usuário).

**Critérios de aceite**
- Usuário logado cria, edita, lista e remove UCs.
- Um usuário não consegue ver/editar UC de outro usuário (testar
  explicitamente).
- Cadastro de `Company` é opcional (UC pode pertencer só ao `User`).

**Fora de escopo**: upload de fatura, aparelhos, qualquer regra de
negócio — esta fase é só CRUD.

---

## Fase 2 — Upload de fatura

**Depende de**: Fase 1.

**Modelo de dados**
```
Bill { id, consumerUnitId -> ConsumerUnit, referenceMonth, fileUrl,
       status ("pending"|"processing"|"done"|"error"), createdAt }
```
(campos de dados extraídos entram na Fase 3 — aqui só o essencial para
existir o registro e o arquivo.)

**Tarefas**
- [ ] Migration para `Bill` (status default `"pending"`).
- [ ] `app/api/bills/route.ts` — POST recebe `consumerUnitId` +
      `referenceMonth` + arquivo (PDF/imagem), sobe para o Vercel Blob,
      cria o `Bill` com status `pending`.
- [ ] Validação de tipo/tamanho de arquivo (aceitar PDF, JPG, PNG; limite
      de tamanho razoável, ex. 15MB).
- [ ] Tela `app/(dashboard)/units/[unitId]/bills/page.tsx` (lista de
      faturas da UC) e um componente de upload (drag-and-drop ou input).
- [ ] Ao criar o `Bill`, disparar a chamada para a rota de processamento
      da Fase 3 (pode ser síncrono no request ou fire-and-forget —
      decidir com base no tempo de resposta da API da Anthropic; se
      demorar, usar `after()`/edge function/queue simples).

**Critérios de aceite**
- Usuário faz upload de um arquivo vinculado a uma UC e vê o `Bill`
  aparecer na lista com status `pending` (e depois mudando, quando a
  Fase 3 estiver implementada).
- Upload de tipo de arquivo inválido é rejeitado com mensagem clara.

**Fora de escopo**: extração de dados em si (Fase 3), qualquer análise.

---

## Fase 3 — Extração de dados via Claude

**Depende de**: Fase 2.

**Modelo de dados** (adicionar campos a `Bill`)
```
Bill {
  ...
  totalAmount, consumptionKwh, tariffFlag,
  previousReadingKwh, currentReadingKwh, billingDays,
  appliedKwhRate,
  lineItems      Json   -- [{ description, quantity, unitRate, amount }]
  extractedData  Json   -- resposta bruta do Claude, para auditoria
}
```

**Tarefas**
- [ ] `lib/claude.ts`: função `extractBillData(fileUrl): Promise<ExtractedBill>`
      que envia o arquivo (via URL do Blob ou base64) para a API da
      Anthropic com um prompt de extração e um schema JSON fixo (usar
      tool use / structured output para forçar o formato).
- [ ] Definir o schema Zod de `ExtractedBill` espelhando os campos acima;
      usar o mesmo schema para validar a resposta do Claude.
- [ ] `app/api/bills/[billId]/process/route.ts`: busca o `Bill`, chama
      `extractBillData`, valida com Zod, salva os campos e muda status
      para `done`; em caso de falha de extração ou validação, status
      `error` e mensagem salva (campo `errorMessage` em `Bill`).
- [ ] Tratar campos de baixa confiança: o prompt deve pedir ao Claude
      para retornar `null`/flag quando não tiver certeza, em vez de
      inventar valor — a UI da Fase 4 exibe esses campos como
      "não identificado, revise manualmente".
- [ ] Montar uma pasta `tests/fixtures/bills/` com 3-5 faturas de
      exemplo (anonimizadas, de distribuidoras diferentes) para testar a
      extração manualmente/semi-automaticamente.
- [ ] Tela de detalhe da fatura (`.../bills/[billId]/page.tsx`) mostrando
      os dados extraídos brutos (ainda sem achados — isso é Fase 4).

**Critérios de aceite**
- Upload de uma fatura de teste resulta, em minutos, em um `Bill` com
  status `done` e todos os campos de `ExtractedBill` preenchidos ou
  explicitamente marcados como não identificados.
- Fatura ilegível/corrompida resulta em status `error` com mensagem
  legível para o usuário, sem quebrar o fluxo.

**Fora de escopo**: qualquer regra de negócio/comparação com tabelas de
referência (isso é Fase 4) — aqui só extrai e guarda.

---

## Fase 4 — Conferência da fatura e da leitura

**Depende de**: Fase 3.

**Modelo de dados**
```
TariffReference  { id, distributor, uf, tariffGroup, tariffSubgroup,
                    validFrom, validTo, kwhRate, icmsRate }
TariffFlagHistory { id, referenceMonth, flag }
Finding          { id, consumerUnitId -> ConsumerUnit, billId? -> Bill,
                    type, ruleCode, severity, description,
                    estimatedImpactAmount?, createdAt }
```

**Tarefas**
- [ ] Migrations para `TariffReference`, `TariffFlagHistory`, `Finding`.
- [ ] `prisma/seed.ts`: popular `TariffFlagHistory` com os últimos ~12
      meses (dado público ANEEL) e `TariffReference` com pelo menos as
      distribuidoras/UFs necessárias para os testes.
- [ ] `lib/rules/billing.ts`: implementar as regras 1-4 do SCOPE.md
      (bandeira incorreta, tarifa de kWh incorreta, taxas fora do
      esperado, erro de matemática linha a linha), cada uma retornando
      0..n `Finding`s.
- [ ] `lib/rules/reading.ts`: implementar as regras 5-7 (divergência de
      leitura, período atípico, anomalia de consumo histórico).
- [ ] Rodar os dois módulos de regras automaticamente ao final do
      processamento da Fase 3 (mesma rota `process`, ou uma etapa
      seguinte explícita `applyBillRules(billId)`).
- [ ] Atualizar a tela de detalhe da fatura para listar os `Finding`s
      gerados, com severidade e descrição em linguagem simples.

**Critérios de aceite**
- Para uma fatura de teste com bandeira/tarifa propositalmente erradas
  (fixture manipulada), o sistema gera o `Finding` correspondente.
- Para uma fatura correta, nenhum falso positivo é gerado pelas regras
  1-7.
- Anomalia de consumo (regra 7) só é avaliada quando a UC já tem
  histórico (≥2 faturas); não gera erro com uma única fatura.

**Fora de escopo**: aparelhos, ranking, sugestões (fases 5-7).

---

## Fase 5 — Catálogo de aparelhos e varredura guiada

**Depende de**: Fase 1 (não depende diretamente de 2-4, pode ser
paralelizada se necessário, mas a ordem recomendada é sequencial).

**Modelo de dados**
```
ApplianceCatalog   { id, name, category, room, typicalPowerW,
                      typicalUsageHoursPerDay, typicalUsageDaysPerWeek,
                      referenceKwhMonth, notes }
HouseholdAppliance { id, consumerUnitId -> ConsumerUnit,
                      catalogId? -> ApplianceCatalog, name, room,
                      powerW, usageHoursPerDay, usageDaysPerWeek,
                      quantity, ageYears?, lastMaintenanceAt?,
                      condition, isCustom }
```

**Tarefas**
- [ ] Migrations para `ApplianceCatalog` e `HouseholdAppliance`.
- [ ] `prisma/seed.ts`: adicionar seed do catálogo (~40-60 aparelhos,
      agrupados pelos cômodos definidos no SCOPE.md, com
      `referenceKwhMonth` — ver pendência na seção 10 do SCOPE.md sobre
      a fonte desses números).
- [ ] `lib/calculations.ts`: função pura
      `estimateMonthlyKwh(appliance: HouseholdAppliance): number`
      implementando a fórmula do SCOPE.md, com testes unitários cobrindo
      casos de borda (quantidade 0, uso 0, etc.).
- [ ] `app/api/consumer-units/[unitId]/appliances/route.ts` (GET lista,
      POST adiciona) e `[applianceId]/route.ts` (PATCH/DELETE).
- [ ] Wizard `app/(dashboard)/units/[unitId]/appliances/page.tsx`: fluxo
      por cômodo (Cozinha → Sala → Quarto → ... conforme SCOPE.md),
      cada tela lista os itens do catálogo daquele cômodo com valores
      pré-preenchidos, usuário marca quais tem e ajusta os campos.
- [ ] Cálculo de calibração: comparar soma de `estimateMonthlyKwh` de
      todos os aparelhos da UC com o `consumptionKwh` da fatura mais
      recente da mesma UC/mês; exibir na tela (ex: "83% do seu consumo
      identificado").

**Critérios de aceite**
- Usuário completa o wizard para pelo menos um cômodo e vê os aparelhos
  salvos com consumo estimado individual.
- Usuário pode pular cômodos e voltar depois sem perder o que já
  preencheu.
- Página de aparelhos mostra o % de calibração quando há fatura
  processada para a mesma UC/mês; mostra "sem fatura para comparar"
  quando não há.

**Fora de escopo**: regras de eficiência/desperdício e ranking (Fase 6);
sugestões (Fase 7).

---

## Fase 6 — Eficiência, desperdício e ranking

**Depende de**: Fases 4 e 5 (usa dados de fatura e de aparelhos juntos).

**Tarefas**
- [ ] `lib/rules/appliance-efficiency.ts`: regras 8-10 do SCOPE.md
      (consumo acima da referência do catálogo ajustado por
      idade/condição; aparelho defasado/sem manutenção; uso acima do
      padrão).
- [ ] `lib/rules/waste.ts`: regras 11-12 (consumo não identificado
      persistente ao longo de meses; salto de consumo sem causa
      aparente). Usar o texto de alerta definido no SCOPE.md (indício,
      nunca acusação).
- [ ] `lib/rules/ranking.ts`: regra 13 (ranking de aparelhos por % do
      consumo total estimado).
- [ ] Disparar essas regras sempre que: (a) uma fatura termina de
      processar (Fase 3/4), ou (b) a lista de aparelhos de uma UC muda.
- [ ] Tela de "consumo por aparelho" na UC: ranking visual (usar
      Recharts) + lista de achados de eficiência/desperdício.

**Critérios de aceite**
- Aparelho cadastrado com consumo muito acima do `referenceKwhMonth` do
  catálogo gera achado de eficiência.
- Gap persistente entre soma dos aparelhos e consumo real por 2+ meses
  seguidos gera o achado de "consumo não identificado" (regra 11); um
  único mês de gap não gera esse achado (evitar falso positivo).
- Texto de todos os achados de desperdício (5.4) passa pela revisão de
  linguagem indicada no SCOPE.md (nunca afirma furto/fraude).

**Fora de escopo**: geração/gestão de sugestões de economia (Fase 7).

---

## Fase 7 — Motor de sugestões e acompanhamento

**Depende de**: Fase 6.

**Modelo de dados**
```
Suggestion { id, consumerUnitId -> ConsumerUnit, findingId? -> Finding,
             householdApplianceId? -> HouseholdAppliance, title,
             description, estimatedSavingsKwh, estimatedSavingsAmount,
             status ("suggested"|"applied"|"dismissed"), appliedAt?,
             appliedNote?, baselineBillId? -> Bill,
             followUpBillId? -> Bill, actualSavingsKwh?,
             actualSavingsAmount?, evaluatedAt? }
```

**Tarefas**
- [ ] Migration para `Suggestion`.
- [ ] `lib/rules/suggestions.ts`: a partir de cada `Finding` relevante
      (de billing, reading, appliance-efficiency, waste, ranking), gerar
      0..n `Suggestion`s com estimativa de economia.
- [ ] `app/api/suggestions/[suggestionId]/apply/route.ts`: marca
      `status = "applied"`, salva `appliedNote` e `appliedAt`, define
      `baselineBillId` como a fatura mais recente `done` daquela UC.
- [ ] Ao processar uma nova fatura (Fase 3/4) de uma UC que tem
      `Suggestion`s com `status = "applied"` e sem `followUpBillId`:
      definir essa fatura como `followUpBillId`, calcular
      `actualSavingsKwh`/`actualSavingsAmount` (diferença entre baseline
      e follow-up, mesma UC) e marcar `evaluatedAt`.
- [ ] Tela de sugestões por UC: lista ordenada por
      `estimatedSavingsAmount` desc; ação "marcar como aplicada" com
      campo de texto livre; exibição do resultado (estimado vs real)
      quando `evaluatedAt` estiver preenchido.

**Critérios de aceite**
- Usuário marca uma sugestão como aplicada e ela sai da lista de
  "pendentes" para "em acompanhamento".
- Ao processar a fatura seguinte da mesma UC, a sugestão aplicada é
  automaticamente avaliada e mostra economia real vs estimada.
- Sugestões sempre aparecem ordenadas por impacto financeiro estimado.

**Fora de escopo**: dashboard consolidado (Fase 8), notificações (Fase 9).

---

## Fase 8 — Dashboard consolidado

**Depende de**: Fases 4, 6 e 7.

**Tarefas**
- [ ] `app/(dashboard)/units/[unitId]/page.tsx` (ou uma home de UC):
      consolidar em uma página: gráfico de histórico de consumo (kWh) e
      gasto (R$) por mês, ranking de aparelhos, contagem de achados por
      severidade, sugestões em aberto.
- [ ] Se o usuário tiver mais de uma UC: tela de comparação simples
      entre UCs (consumo total, gasto total, nº de achados).
- [ ] Aplicar boas práticas de visualização de dados (paleta acessível,
      eixos e legendas claras) nos gráficos — usar a skill `dataviz`
      deste projeto ao implementar os componentes de gráfico.

**Critérios de aceite**
- Com pelo menos 2 faturas processadas de uma UC, o gráfico de histórico
  exibe a evolução mês a mês corretamente.
- Dashboard carrega sem erro para uma UC recém-criada, sem faturas
  (estado vazio tratado, não quebra a tela).

**Fora de escopo**: notificações (Fase 9); qualquer item da seção 9 do
SCOPE.md (evoluções futuras).

---

## Fase 9 — Notificações

**Depende de**: Fase 3 (processamento) e Fase 7 (sugestões).

**Modelo de dados**
```
Notification { id, userId -> User, billId? -> Bill, channel, message,
                sentAt }
```

**Tarefas**
- [ ] Migration para `Notification`.
- [ ] Configurar Resend + template de e-mail (React Email ou HTML
      simples) para 3 eventos: (a) processamento de fatura concluído,
      (b) achado de severidade alta gerado, (c) sugestão aplicada teve
      sua avaliação concluída (fatura seguinte processada).
- [ ] Disparar o envio nos pontos correspondentes do código (fim da
      Fase 3/4 para (a) e (b); fim da Fase 7 para (c)) e registrar em
      `Notification`.
- [ ] Preferência básica de usuário para desativar e-mails (campo em
      `User` ou tabela de preferências simples) — opcional, incluir só
      se for rápido; caso contrário, documentar como próximo passo.

**Critérios de aceite**
- Processar uma fatura de teste dispara e-mail correspondente (validar
  em ambiente de teste do Resend ou com log/mock).
- Cada envio gera um registro em `Notification`.

**Fora de escopo**: canais além de e-mail (push, SMS) — ficam para depois
do MVP.

---

## Depois do MVP

Ver seção 9 (`Evoluções futuras`) do [`SCOPE.md`](./SCOPE.md): medição
real via IoT, multi-usuário por empresa, modalidade tarifária/Mercado
Livre, exportação de relatórios, payback de substituição de
equipamento, e canal de laudo/inspeção para os alertas de desperdício.
Nenhuma dessas entra em uma fase do MVP acima — só devem ser iniciadas
depois que as Fases 0-9 estiverem completas e validadas.
