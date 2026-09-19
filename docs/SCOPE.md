# Fiscalenergia — Escopo do Produto e Plano de Implementação

> Documento vivo. Nasceu de uma sessão de brainstorming e serve como guia para o
> desenvolvimento com Claude Code. Fases devem ser implementadas em ordem;
> cada fase deve terminar com o app rodando e testável antes de avançar para a próxima.

## 1. Visão do produto

SaaS de **fiscalização de consumo de energia elétrica**. A partir da fatura
e de um cadastro guiado dos aparelhos da casa/empresa, o app:

1. Confere se os valores da fatura (kWh e R$) estão corretos.
2. Estima **quanto cada aparelho/eletrodoméstico consome**, mostrando quem
   mais pesa na conta.
3. Faz uma **varredura completa dos gastos** (cômodo por cômodo) para
   mapear todo o consumo da unidade.
4. Dá **sugestões de economia** priorizadas pelo maior impacto financeiro.

As duas frentes são complementares: a fatura dá o número real (kWh e R$
faturados) e serve para **calibrar** as estimativas por aparelho; o
cadastro de aparelhos explica **onde** esse consumo está sendo gerado.

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
O prompt de extração deve pedir um JSON com schema fixo e sinalizar campos
que não conseguiu ler com confiança (para revisão manual do usuário).

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
  extractedData (JSON: consumo kWh, valor total, bandeira tarifária,
    tributos, demanda faturada, datas de leitura, etc.),
  totalAmount, consumptionKwh,
  createdAt

Finding (achado — cobrança/consumo)
  id, consumerUnitId -> ConsumerUnit, billId? -> Bill
  type ("billing_error" | "savings_opportunity" | "consumption_anomaly")
  source ("bill_rule" | "appliance_rule")
  ruleCode, severity ("low" | "medium" | "high"),
  description, estimatedSavingsAmount?,
  createdAt

ApplianceCatalog (catálogo de referência, global — seed inicial da Fiscalenergia)
  id, name, category, room (ver lista de cômodos abaixo),
  typicalPowerW, typicalUsageHoursPerDay, typicalUsageDaysPerWeek,
  notes (ex: "consumo cíclico, não é potência contínua")

HouseholdAppliance (aparelho cadastrado pelo usuário numa UC)
  id, consumerUnitId -> ConsumerUnit, catalogId? -> ApplianceCatalog
  name, room, powerW, usageHoursPerDay, usageDaysPerWeek, quantity,
  isCustom (true quando não veio do catálogo / usuário editou os valores)

Notification
  id, userId -> User, billId? -> Bill,
  channel ("email" | "in_app"), message, sentAt
```

### Cômodos padrão do questionário de varredura

Cozinha, Sala, Quarto (repetível por quantidade de quartos), Banheiro,
Área de serviço/Lavanderia, Escritório/Home office, Área externa/Garagem.
Cada cômodo tem uma lista pré-filtrada do `ApplianceCatalog` (ex: Cozinha
sugere geladeira, freezer, micro-ondas, forno elétrico; Área de serviço
sugere máquina de lavar, ferro de passar, bomba d'água).

### Cálculo de consumo estimado por aparelho

```
consumoMensalEstimadoKwh =
  (powerW * usageHoursPerDay * (usageDaysPerWeek / 7) * diasNoMes) / 1000
  * quantity
```

A soma do consumo estimado de todos os aparelhos de uma UC é comparada ao
`consumptionKwh` real da fatura do mesmo mês (**calibração**):

- Se a soma estimada ficar muito abaixo do valor real, o app sinaliza
  "consumo não identificado" (aparelhos não cadastrados) e sugere revisar
  a varredura.
- Se ficar muito acima, sinaliza que algum tempo de uso informado está
  superestimado.
- O ranking "quem mais consome" é sempre relativo (% do total), o que
  reduz o impacto de erro absoluto na potência/tempo informado.

## 5. Motores de análise

### 5.1 Regras sobre a fatura (MVP)

1. **Bandeira tarifária incorreta** — bandeira cobrada na fatura ≠ bandeira
   vigente no mês de referência (tabela oficial ANEEL, mantida manualmente
   ou atualizada por script mensal).
2. **Anomalia de consumo total** — consumo do mês foge do padrão histórico
   do cliente (variação acima de um limite configurável).
3. **Tributo fora da faixa esperada** — alíquota de ICMS aplicada
   incompatível com a alíquota vigente para energia elétrica no estado
   (UF) da UC (tabela por UF).
4. **Ultrapassagem de demanda (grupo A)** — demanda medida muito acima da
   contratada (multa de ultrapassagem) ou demanda contratada muito acima
   do uso real (oportunidade de reduzir o contrato).
5. **Cobrança indevida de item legado** — itens que não deveriam mais
   constar na fatura de energia.

### 5.2 Regras sobre aparelhos/varredura (MVP)

6. **Maior consumidor da casa** — ranking dos aparelhos por % do consumo
   total estimado; sempre gera ao menos um achado destacando o top 1-3.
7. **Aparelho com uso acima do padrão** — comparação do `usageHoursPerDay`
   informado contra o `typicalUsageHoursPerDay` do catálogo (ex: chuveiro
   elétrico usado muito mais tempo que a média).
8. **Categoria de alto impacto conhecida** — aparelhos com potência alta e
   uso comum em horário de ponta (chuveiro elétrico, ar-condicionado, ferro
   de passar) recebem sugestão específica de mudança de hábito/horário.
9. **Consumo não identificado** — gap entre soma estimada dos aparelhos e
   consumo real da fatura acima de um limiar, sugerindo completar a
   varredura.

### 5.3 Fase 2 (pós-MVP)

10. Recomendação de troca de modalidade tarifária (Branca × Convencional).
11. Simulação de migração para o Mercado Livre de Energia (ACL).
12. Multa por baixo fator de potência (energia reativa).
13. Substituição de equipamento ineficiente com estimativa de payback
    (ex: "trocar geladeira de 15 anos economiza R$X/mês").

## 6. Fluxo do usuário (MVP)

1. Cadastro / login.
2. Cadastro de uma ou mais UCs (código da UC, distribuidora, UF/cidade,
   grupo tarifário).
3. **Varredura guiada por cômodo**: wizard percorre os cômodos padrão,
   usuário marca os aparelhos que tem (a partir do catálogo, com potência
   típica pré-preenchida) e ajusta tempo de uso; pode pular e completar
   depois.
4. Upload de fatura (PDF ou foto) vinculada a uma UC.
5. Processamento assíncrono: extração via Claude → validação básica →
   execução das regras de fatura (5.1) → geração de `Finding`s.
6. Cálculo/atualização do ranking de aparelhos e calibração contra o
   consumo real da fatura → geração de `Finding`s de aparelhos (5.2).
7. Usuário visualiza a fatura processada: dados extraídos, achados de
   cobrança, ranking "quem mais consome" e sugestões de economia
   priorizadas por impacto em R$.
8. Dashboard: consumo (kWh) e gasto (R$) histórico por UC, ranking de
   aparelhos, comparação entre UCs quando houver mais de uma.
9. Notificação por e-mail quando o processamento termina ou quando há um
   achado de severidade alta.

## 7. Fases de implementação

- **Fase 0 — Setup**: projeto Next.js + TypeScript, Prisma + Postgres,
  Auth.js, deploy inicial na Vercel, CI básico (lint + typecheck + testes).
- **Fase 1 — Contas e UCs**: cadastro/login de usuário, CRUD de `Company`
  (opcional) e `ConsumerUnit`.
- **Fase 2 — Upload de fatura**: upload de PDF/foto para o Blob storage,
  criação do registro `Bill` com status `pending`.
- **Fase 3 — Extração via Claude**: rota/job que envia o arquivo da fatura
  para a API da Anthropic com um prompt de extração e schema JSON fixo,
  salva `extractedData`, atualiza status para `done` ou `error`.
- **Fase 4 — Motor de regras da fatura**: implementação das regras 1-5
  (seção 5.1).
- **Fase 5 — Catálogo de aparelhos e varredura**: seed do
  `ApplianceCatalog` (lista inicial de ~40-60 aparelhos comuns agrupados
  por cômodo), wizard de varredura, cálculo de consumo estimado e
  calibração contra a fatura.
- **Fase 6 — Motor de regras de aparelhos**: implementação das regras 6-9
  (seção 5.2) e do motor de sugestões de economia consolidado (fatura +
  aparelhos, ordenado por economia estimada).
- **Fase 7 — Dashboard consolidado**: histórico de consumo/gasto por UC,
  ranking de aparelhos, lista de achados e sugestões, comparação entre UCs.
- **Fase 8 — Notificações**: e-mail transacional ao concluir processamento
  e ao gerar achado de severidade alta.
- **Fase 9 (futuro)** — ver seção 9.

## 8. Critérios de aceite do MVP (fases 0-8)

- Usuário se cadastra, faz login e cadastra pelo menos uma UC.
- Usuário completa a varredura guiada de pelo menos um cômodo e vê o
  consumo estimado calculado automaticamente.
- Usuário faz upload de uma fatura em PDF ou foto e, em poucos minutos,
  vê os dados extraídos (consumo, valor, bandeira, tributos).
- O sistema aplica as regras de fatura (5.1) e de aparelhos (5.2) quando
  aplicável, exibindo achados em linguagem simples com economia estimada
  quando houver.
- O usuário vê claramente **qual aparelho mais consome** (ranking em % e
  em R$/mês estimado) e recebe ao menos uma sugestão de economia
  acionável.
- O dashboard mostra a evolução de consumo (kWh) e gasto (R$) por UC ao
  longo dos meses.
- Falhas de extração (fatura ilegível, campo não identificado) são
  sinalizadas ao usuário em vez de gerar dados incorretos silenciosamente.

## 9. Evoluções futuras (fora do MVP)

- **Medição real via IoT**: integração com tomadas inteligentes e
  medidores de energia (ex: protocolos comuns de smart plugs) para
  substituir a estimativa por dado medido de verdade, aparelho a aparelho.
- Multi-usuário por empresa (papéis/permissões).
- Modalidade tarifária (Branca × Convencional) e simulação de Mercado
  Livre de Energia.
- Exportação de relatórios (PDF) da varredura e dos achados.
- Substituição de equipamento com cálculo de payback.

## 10. Pontos em aberto / decisões pendentes

- **Fonte da tabela de bandeiras tarifárias mensais**: manter tabela manual
  no banco (atualização mensal manual) no MVP; automatizar depois.
- **Fonte da tabela de ICMS por UF para energia elétrica**: mesmo
  tratamento — tabela mantida manualmente no MVP.
- **Conteúdo inicial do `ApplianceCatalog`**: precisa de uma lista
  validada de aparelhos comuns por cômodo com potência típica (W) e
  padrão de uso (h/dia) — pode ser levantada com fontes públicas
  (INMETRO/PROCEL) antes da fase 5.
- **Faturas de teste**: precisamos de exemplos reais (anonimizados) de
  faturas de distribuidoras diferentes para validar o prompt de extração
  antes da fase 3.
- **Modelo de monetização** (assinatura, % da economia identificada, etc.)
  não afeta o escopo técnico do MVP e pode ser decidido em paralelo.
