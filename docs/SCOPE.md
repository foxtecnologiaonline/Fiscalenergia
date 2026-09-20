# Fiscalenergia — Escopo do Produto e Plano de Implementação

> Documento vivo. Nasceu de uma sessão de brainstorming e serve como guia para o
> desenvolvimento com Claude Code. Fases devem ser implementadas em ordem;
> cada fase deve terminar com o app rodando e testável antes de avançar para a próxima.

## 1. Visão do produto

SaaS de **fiscalização de consumo de energia elétrica**. A partir da fatura
e de um cadastro guiado dos aparelhos da casa/empresa, o app responde a
cinco perguntas do usuário:

1. **A fatura está certa?** — bandeira tarifária do período, valor do kWh
   aplicado, taxas/encargos e a matemática (quantidade × tarifa = valor)
   conferem com o que deveria ser cobrado.
2. **A leitura de consumo está certa?** — a diferença entre leitura atual e
   anterior do medidor bate com o kWh faturado.
3. **Algum aparelho está gastando mais do que deveria?** — por estar
   defasado, sem manutenção, ou consumindo acima do valor de referência
   (Inmetro/Procel/Procon) para aquele modelo/categoria.
4. **Há indício de desperdício, dispersão ou desvio de energia?** — consumo
   medido que não se explica pela soma dos aparelhos cadastrados nem por
   mudança de hábito, mês após mês.
5. **O que fazer, e funcionou?** — sugestões de economia priorizadas por
   impacto em R$; o usuário marca o que aplicou e o app acompanha a fatura
   seguinte para mostrar a economia real obtida.

As duas frentes de dados (fatura + varredura de aparelhos) são
complementares: a fatura dá o número real (kWh e R$ faturados) e serve
para calibrar as estimativas por aparelho; o cadastro de aparelhos explica
onde esse consumo está sendo gerado.

> **Importante sobre os pontos 3 e 4**: o app não tem como medir cada
> aparelho individualmente no MVP (não há hardware/IoT), nem acessar dados
> internos da distribuidora. Por isso essas duas análises são heurísticas
> baseadas em comparação estatística e em tabelas de referência — o
> resultado é sempre apresentado como **indício/alerta que sugere
> verificação**, nunca como diagnóstico definitivo ou acusação (ex: nunca
> afirmar "há furto de energia", e sim "consumo não explicado pelos
> aparelhos cadastrados — recomendamos inspeção da instalação").

## 2. Público-alvo

- **Consumidores finais**: residência com uma UC, quer entender a conta e
  onde economizar.
- **Empresas**: podem ter uma ou várias UCs (ex: matriz + filiais), cada
  uma com seu próprio histórico de faturas e seu próprio inventário de
  equipamentos/aparelhos.

Uma conta (`User`) pode gerenciar N unidades consumidoras desde o MVP.

## 3. Stack técnica

| Camada | Escolha |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Deploy | Vercel |
| Banco de dados | Postgres (Neon ou Vercel Postgres) |
| ORM | Prisma |
| Storage de arquivos | Vercel Blob (armazena o PDF/foto original da fatura) |
| Autenticação | Auth.js (NextAuth) — e-mail/senha ou magic link |
| Extração de dados da fatura | API da Anthropic (Claude, com suporte a imagem/PDF) |
| UI | Tailwind CSS + shadcn/ui |
| Processamento assíncrono | Fila simples via tabela `Bill.status` (pending → processing → done/error) + rota de processamento acionada após upload |

**Por que Claude para extração em vez de OCR tradicional + regex:**
existem dezenas de distribuidoras no Brasil, cada uma com layout de fatura
diferente. Um LLM com visão lê o documento e devolve os campos já
estruturados (JSON), sem precisar manter um template por distribuidora.
O prompt de extração precisa capturar não só os totais, mas os itens
detalhados da fatura (ver seção 4) para permitir a conferência linha a
linha, e sinalizar campos que não conseguiu ler com confiança.

**Consumo por aparelho no MVP é estimado, não medido.** Não há
integração com hardware (tomadas inteligentes/medidores IoT) na primeira
versão — ver seção 9 para essa evolução futura.

## 4. Modelo de dados (alto nível)

```
User
  id, email, name, passwordHash, createdAt

Company (opcional — null quando o usuário é pessoa física)
  id, name, cnpj, ownerId -> User

ConsumerUnit (UC)
  id, ownerId -> User, companyId? -> Company
  code (código da UC), distributor (nome da distribuidora),
  uf, city, tariffGroup ("A" | "B"), tariffSubgroup, tariffModality,
  contractedDemandKw? (quando grupo A)

Bill (fatura)
  id, consumerUnitId -> ConsumerUnit
  referenceMonth, fileUrl (arquivo original no Blob),
  status ("pending" | "processing" | "done" | "error"),
  -- dados gerais extraídos --
  totalAmount, consumptionKwh, tariffFlag (bandeira cobrada),
  -- para conferência da leitura (pergunta 2) --
  previousReadingKwh, currentReadingKwh, billingDays,
  -- para conferência da matemática/tarifa (pergunta 1) --
  appliedKwhRate (R$/kWh cobrado na fatura),
  lineItems (JSON: lista de itens da fatura — descrição, quantidade,
    tarifa unitária, valor — ex: consumo TE, TUSD, bandeira, ICMS,
    COSIP/iluminação pública, outros encargos),
  extractedData (JSON bruto retornado pelo Claude, para auditoria/debug),
  createdAt

TariffReference (tabela de referência mantida manualmente)
  id, distributor, uf, tariffGroup, tariffSubgroup,
  validFrom, validTo, kwhRate (TE+TUSD homologada), icmsRate

TariffFlagHistory (bandeira tarifária vigente por mês, tabela ANEEL)
  id, referenceMonth, flag ("verde" | "amarela" | "vermelha_p1" | "vermelha_p2")

Finding (achado — cobrança, leitura ou consumo)
  id, consumerUnitId -> ConsumerUnit, billId? -> Bill
  type ("billing_error" | "reading_error" | "appliance_inefficiency"
        | "possible_waste_or_loss" | "consumption_anomaly")
  ruleCode, severity ("low" | "medium" | "high"),
  description, estimatedImpactAmount?,
  createdAt

ApplianceCatalog (catálogo de referência, global — seed inicial da Fiscalenergia)
  id, name, category, room,
  typicalPowerW, typicalUsageHoursPerDay, typicalUsageDaysPerWeek,
  referenceKwhMonth (consumo mensal de referência para um aparelho em bom
    estado — baseado em selo Procel/Inmetro ou testes comparativos
    publicados, ex: Procon-SP),
  notes (ex: "consumo cíclico, não é potência contínua")

HouseholdAppliance (aparelho cadastrado pelo usuário numa UC)
  id, consumerUnitId -> ConsumerUnit, catalogId? -> ApplianceCatalog
  name, room, powerW, usageHoursPerDay, usageDaysPerWeek, quantity,
  ageYears?, lastMaintenanceAt?, condition ("novo" | "normal" | "antigo" | "sem_manutencao"),
  isCustom (true quando não veio do catálogo / usuário editou os valores)

Suggestion (sugestão de economia, com acompanhamento)
  id, consumerUnitId -> ConsumerUnit, findingId? -> Finding,
  householdApplianceId? -> HouseholdAppliance,
  title, description,
  estimatedSavingsKwh, estimatedSavingsAmount,
  status ("suggested" | "applied" | "dismissed"),
  appliedAt?, appliedNote? (o que o usuário efetivamente fez),
  baselineBillId? -> Bill (última fatura antes da ação),
  followUpBillId? -> Bill (primeira fatura após a ação),
  actualSavingsKwh?, actualSavingsAmount?, evaluatedAt?

Notification
  id, userId -> User, billId? -> Bill,
  channel ("email" | "in_app"), message, sentAt
```

### Cômodos padrão do questionário de varredura

Cozinha, Sala, Quarto (repetível por quantidade de quartos), Banheiro,
Área de serviço/Lavanderia, Escritório/Home office, Área externa/Garagem.
Cada cômodo tem uma lista pré-filtrada do `ApplianceCatalog`.

### Cálculo de consumo estimado por aparelho

```
consumoMensalEstimadoKwh =
  (powerW * usageHoursPerDay * (usageDaysPerWeek / 7) * diasNoMes) / 1000
  * quantity
```

A soma do consumo estimado de todos os aparelhos de uma UC é comparada ao
`consumptionKwh` real da fatura do mesmo mês (**calibração**) — a base do
ranking "quem mais consome" e também da regra de possível desperdício
(seção 5.4).

## 5. Motores de análise

### 5.1 Conferência da fatura — "a fatura está certa?"

1. **Bandeira tarifária incorreta** — bandeira cobrada (`Bill.tariffFlag`)
   ≠ bandeira vigente no mês de referência (`TariffFlagHistory`).
2. **Tarifa de kWh incorreta** — `Bill.appliedKwhRate` ≠ tarifa homologada
   vigente para a distribuidora/grupo/subgrupo da UC naquele período
   (`TariffReference`).
3. **Taxas/encargos fora do esperado** — itens de `lineItems` como ICMS,
   COSIP/iluminação pública ou "outros encargos" fora da faixa/valor
   esperado para a UF e o período.
4. **Erro de matemática na fatura** — para cada item de `lineItems`,
   recalcular `quantidade × tarifa unitária` e comparar com o valor
   cobrado (tolerância de arredondamento); sinalizar qualquer item que não
   feche a conta.

### 5.2 Conferência da leitura de consumo — "a leitura está certa?"

5. **Divergência de leitura do medidor** — recalcular
   `currentReadingKwh − previousReadingKwh` e comparar com
   `consumptionKwh` faturado; sinalizar divergência (possível erro de
   leitura, leitura estimada pela distribuidora, ou constante de medição
   incorreta).
6. **Período de faturamento atípico** — `billingDays` muito diferente do
   padrão (ex: 28-32 dias); ajustar comparações históricas
   proporcionalmente e alertar quando o período for muito fora do comum.
7. **Anomalia de consumo total** — consumo do mês foge do padrão histórico
   da UC (variação acima de um limite configurável).

### 5.3 Eficiência e manutenção de aparelhos — "algum aparelho gasta mais do que deveria?"

8. **Consumo acima da referência** — consumo estimado do aparelho
   (`HouseholdAppliance`) muito acima do `referenceKwhMonth` do
   `ApplianceCatalog` para a mesma categoria/potência, ajustado por
   `ageYears`/`condition` — sinaliza "esse aparelho está gastando mais do
   que o esperado para o modelo/categoria, considere manutenção".
9. **Aparelho defasado/sem manutenção declarado** — `condition` =
   "antigo" ou "sem_manutencao" combinado com alto consumo estimado →
   prioriza a sugestão de manutenção/substituição no topo do ranking.
10. **Uso acima do padrão** — `usageHoursPerDay` informado muito acima do
    `typicalUsageHoursPerDay` do catálogo (ex: chuveiro elétrico usado
    muito mais tempo que a média).

### 5.4 Indícios de desperdício, dispersão ou desvio — "tem vazamento/roubo de energia?"

> Estas regras produzem **alertas de investigação**, não conclusões. A
> UI deve deixar explícito que é um indício estatístico.

11. **Consumo não identificado persistente** — gap entre a soma estimada
    dos aparelhos e o consumo real da fatura (seção 4) acima de um
    limiar, repetindo-se por vários meses sem explicação por aparelho
    novo/mudança de hábito → alerta "consumo não explicado pelos
    aparelhos cadastrados — verifique instalação elétrica ou revise a
    varredura".
12. **Salto de consumo sem causa aparente** — aumento súbito de consumo
    sem novo aparelho cadastrado, mudança de `usageHoursPerDay`, ou
    variação sazonal esperada (ex: verão/ar-condicionado) → alerta
    "aumento de consumo sem causa identificada — recomendamos inspeção da
    instalação e conferência com a distribuidora".

### 5.5 Ranking de aparelhos

13. **Maior consumidor da casa** — ranking dos aparelhos por % do consumo
    total estimado; sempre gera ao menos um achado destacando o top 1-3.

### 5.6 Sugestões de economia e acompanhamento — "o que fazer, e funcionou?"

- Cada achado relevante (5.1 a 5.5) pode gerar uma ou mais `Suggestion`
  com estimativa de economia em kWh e R$/mês.
- O usuário marca uma sugestão como **aplicada**, descrevendo o que fez
  (`appliedNote`); o sistema registra a fatura mais recente daquela UC
  como `baselineBillId`.
- Quando a próxima fatura da mesma UC é processada (`followUpBillId`), o
  sistema compara consumo/custo com o baseline e calcula
  `actualSavingsKwh`/`actualSavingsAmount`, exibindo "economia estimada vs
  economia real obtida".
- Lista de sugestões é sempre ordenada por impacto financeiro estimado.

### 5.7 Fase 2 (pós-MVP)

14. Recomendação de troca de modalidade tarifária (Branca × Convencional).
15. Simulação de migração para o Mercado Livre de Energia (ACL).
16. Multa por baixo fator de potência (energia reativa).
17. Payback de substituição de equipamento (ex: "trocar geladeira de 15
    anos economiza R$X/mês, retorno do investimento em Y meses").

## 6. Fluxo do usuário (MVP)

1. Cadastro / login.
2. Cadastro de uma ou mais UCs (código da UC, distribuidora, UF/cidade,
   grupo tarifário).
3. **Varredura guiada por cômodo**: wizard percorre os cômodos padrão,
   usuário marca os aparelhos que tem (a partir do catálogo, com potência
   típica pré-preenchida), ajusta tempo de uso e informa idade/estado de
   manutenção quando souber; pode pular e completar depois.
4. Upload de fatura (PDF ou foto) vinculada a uma UC.
5. Processamento assíncrono: extração via Claude (incluindo itens
   detalhados e leituras) → execução das regras 5.1 e 5.2 → geração de
   `Finding`s.
6. Cálculo/atualização do ranking de aparelhos, regras 5.3 e 5.4, e
   geração de `Suggestion`s consolidadas (5.6), ordenadas por economia
   estimada.
7. Usuário visualiza a fatura processada: dados extraídos, achados de
   fatura/leitura, ranking "quem mais consome", alertas de eficiência ou
   possível desperdício, e sugestões priorizadas.
8. Usuário marca sugestões como aplicadas; no upload da fatura seguinte,
   vê a comparação "economia estimada vs real".
9. Dashboard: consumo (kWh) e gasto (R$) histórico por UC, ranking de
   aparelhos, comparação entre UCs quando houver mais de uma.
10. Notificação por e-mail quando o processamento termina, quando há um
    achado de severidade alta, ou quando uma sugestão aplicada já pode
    ser avaliada (fatura seguinte chegou).

## 7. Fases de implementação

Resumo — o detalhamento técnico de cada fase (schema exato, rotas,
arquivos, critérios de aceite testáveis e o que fica explicitamente fora
de escopo) está em [`docs/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
Use esse documento para conduzir a implementação com o Claude Code, uma
fase por vez.

0. Setup do projeto (Next.js, Prisma/Postgres, Auth.js, deploy Vercel, CI)
1. Contas, empresas e unidades consumidoras (UC) — CRUD
2. Upload de fatura (Blob storage + registro `Bill`)
3. Extração de dados via Claude (totais, leituras, itens detalhados)
4. Conferência da fatura e da leitura (regras 1-7, seções 5.1 e 5.2)
5. Catálogo de aparelhos e varredura guiada por cômodo
6. Eficiência, desperdício e ranking (regras 8-13, seções 5.3-5.5)
7. Motor de sugestões e acompanhamento (seção 5.6)
8. Dashboard consolidado
9. Notificações
10. (futuro) — ver seção 9 deste documento

## 8. Critérios de aceite do MVP (fases 0-9)

- Usuário se cadastra, faz login e cadastra pelo menos uma UC.
- Usuário completa a varredura guiada de pelo menos um cômodo e vê o
  consumo estimado calculado automaticamente.
- Usuário faz upload de uma fatura em PDF ou foto e, em poucos minutos,
  vê os dados extraídos, incluindo leituras e itens detalhados.
- O sistema confere bandeira, tarifa de kWh, taxas e matemática da fatura
  (5.1), e a coerência da leitura de consumo (5.2), exibindo achados em
  linguagem simples.
- O sistema aponta aparelhos com consumo acima da referência ou
  defasados/sem manutenção (5.3), e sinaliza — como indício, não
  diagnóstico — possível desperdício ou consumo não explicado (5.4).
- O usuário vê claramente **qual aparelho mais consome** (ranking em % e
  em R$/mês estimado).
- O usuário recebe sugestões priorizadas por economia estimada, pode
  marcar uma como aplicada, e na fatura seguinte vê a comparação entre
  economia estimada e economia real.
- O dashboard mostra a evolução de consumo (kWh) e gasto (R$) por UC ao
  longo dos meses.
- Falhas de extração (fatura ilegível, campo não identificado) são
  sinalizadas ao usuário em vez de gerar dados incorretos silenciosamente.

## 9. Evoluções futuras (fora do MVP)

- **Medição real via IoT**: integração com tomadas inteligentes e
  medidores de energia para substituir a estimativa por dado medido de
  verdade, aparelho a aparelho — eliminaria boa parte da incerteza das
  regras 8-12.
- Multi-usuário por empresa (papéis/permissões).
- Modalidade tarifária (Branca × Convencional) e simulação de Mercado
  Livre de Energia.
- Exportação de relatórios (PDF) da varredura, achados e sugestões.
- Payback de substituição de equipamento.
- Canal para o usuário anexar laudo/visita técnica quando um alerta de
  desperdício/desvio (5.4) for investigado, fechando o ciclo com o
  resultado real da inspeção.

## 10. Pontos em aberto / decisões pendentes

- **Fonte da tabela de bandeiras tarifárias mensais** (`TariffFlagHistory`):
  manter tabela manual no banco (atualização mensal manual) no MVP;
  automatizar depois.
- **Fonte da tabela de tarifas homologadas por distribuidora/UF**
  (`TariffReference`) e de ICMS por UF: mesmo tratamento — tabela mantida
  manualmente no MVP, começando pelas distribuidoras/UFs dos primeiros
  usuários.
- **Conteúdo inicial do `ApplianceCatalog`**, incluindo `referenceKwhMonth`:
  precisa de uma lista validada de aparelhos comuns por cômodo, com
  potência típica (W), padrão de uso (h/dia) e consumo de referência —
  pode ser levantada com fontes públicas (INMETRO/Procel/Procon) antes da
  fase 5.
- **Faturas de teste**: precisamos de exemplos reais (anonimizados) de
  faturas de distribuidoras diferentes, incluindo casos com leituras e
  itens detalhados, para validar o prompt de extração antes da fase 3.
- **Texto legal dos alertas de desperdício/desvio (5.4)**: validar com
  cuidado a linguagem usada (evitar qualquer afirmação de furto/fraude sem
  prova), possivelmente com revisão jurídica antes do lançamento.
- **Modelo de monetização** (assinatura, % da economia identificada, etc.)
  não afeta o escopo técnico do MVP e pode ser decidido em paralelo.
