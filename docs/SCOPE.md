# Fiscalenergia — Escopo do Produto e Plano de Implementação

> Documento vivo. Nasceu de uma sessão de brainstorming e serve como guia para o
> desenvolvimento com Claude Code. Fases devem ser implementadas em ordem;
> cada fase deve terminar com o app rodando e testável antes de avançar para a próxima.

## 1. Visão do produto

Aplicativo web onde o usuário faz upload da fatura de energia elétrica
(PDF ou foto) e recebe automaticamente:

- Os dados da fatura extraídos e estruturados (consumo, valor, bandeira
  tarifária, tributos, demanda, etc.)
- Uma lista de **achados** (findings): cobranças possivelmente indevidas,
  anomalias de consumo e oportunidades de economia, explicadas em
  linguagem simples
- Um **dashboard** de consumo e gasto histórico, por unidade consumidora (UC)

## 2. Público-alvo

- **Empresas**: podem ter uma ou várias UCs (ex: matriz + filiais), cada
  uma com seu próprio histórico de faturas.
- **Consumidores finais**: normalmente uma única UC (a própria residência).

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

Finding (achado)
  id, billId -> Bill
  type ("billing_error" | "savings_opportunity" | "consumption_anomaly")
  ruleCode, severity ("low" | "medium" | "high"),
  description, estimatedSavingsAmount?,
  createdAt

Notification
  id, userId -> User, billId? -> Bill,
  channel ("email" | "in_app"), message, sentAt
```

## 5. Motor de regras de detecção

### MVP (fase 4)

1. **Bandeira tarifária incorreta** — bandeira cobrada na fatura ≠ bandeira
   vigente no mês de referência (tabela oficial ANEEL, mantida manualmente
   ou atualizada por script mensal).
2. **Anomalia de consumo** — consumo do mês foge do padrão histórico do
   cliente (ex: variação acima de um limite configurável, considerando
   sazonalidade simples).
3. **Tributo fora da faixa esperada** — alíquota de ICMS aplicada
   incompatível com a alíquota vigente para energia elétrica no estado (UF)
   da UC (tabela por UF).
4. **Ultrapassagem de demanda (grupo A)** — demanda medida muito acima da
   contratada (multa de ultrapassagem) ou demanda contratada muito acima do
   uso real (oportunidade de reduzir o contrato e economizar).
5. **Cobrança indevida de item legado** — itens que não deveriam mais
   constar na fatura de energia (ex: iluminação pública cobrada fora do
   padrão atual).

### Fase 2 (pós-MVP)

6. Recomendação de troca de modalidade tarifária (Branca × Convencional)
   com base no perfil de consumo por horário.
7. Simulação de migração para o Mercado Livre de Energia (ACL).
8. Multa por baixo fator de potência (energia reativa).

> As regras 1 e 3 dependem de tabelas de referência (bandeira tarifária
> mensal e ICMS por UF) que precisam de uma fonte de dados definida antes
> da fase 4 — ver seção 8 (pontos em aberto).

## 6. Fluxo do usuário (MVP)

1. Cadastro / login.
2. Cadastro de uma ou mais UCs (código da UC, distribuidora, UF/cidade,
   grupo tarifário).
3. Upload de fatura (PDF ou foto) vinculada a uma UC.
4. Processamento assíncrono: extração via Claude → validação básica →
   execução das regras de detecção → geração de `Finding`s.
5. Usuário visualiza a fatura processada: dados extraídos + achados +
   economia estimada total.
6. Dashboard: consumo (kWh) e gasto (R$) histórico por UC, com comparação
   entre UCs quando houver mais de uma.
7. Notificação por e-mail quando o processamento termina ou quando há um
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
- **Fase 4 — Motor de regras**: implementação das 5 regras do MVP,
  geração de `Finding`s a partir de `extractedData` e do histórico da UC.
- **Fase 5 — Dashboard e visualização**: tela de detalhe da fatura (dados +
  achados), dashboard de histórico de consumo/gasto por UC.
- **Fase 6 — Notificações**: e-mail transacional ao concluir processamento
  e ao gerar achado de severidade alta.
- **Fase 7 (futuro)** — múltiplos usuários por empresa (papéis), regras 6-8,
  exportação de relatórios, integração direta com portais de distribuidoras.

## 8. Critérios de aceite do MVP (fases 0-6)

- Usuário se cadastra, faz login e cadastra pelo menos uma UC.
- Usuário faz upload de uma fatura em PDF ou foto e, em poucos minutos,
  vê os dados extraídos (consumo, valor, bandeira, tributos).
- O sistema aplica as 5 regras do MVP e exibe os achados aplicáveis, com
  explicação em linguagem simples e, quando possível, economia estimada.
- O dashboard mostra a evolução de consumo (kWh) e gasto (R$) por UC ao
  longo dos meses.
- Falhas de extração (fatura ilegível, campo não identificado) são
  sinalizadas ao usuário em vez de gerar dados incorretos silenciosamente.

## 9. Pontos em aberto / decisões pendentes

- **Fonte da tabela de bandeiras tarifárias mensais**: manter tabela manual
  no banco (atualização mensal manual) no MVP; automatizar depois.
- **Fonte da tabela de ICMS por UF para energia elétrica**: mesmo
  tratamento — tabela mantida manualmente no MVP.
- **Faturas de teste**: precisamos de exemplos reais (anonimizados) de
  faturas de distribuidoras diferentes para validar o prompt de extração
  antes da fase 3.
- **Modelo de monetização** (assinatura, % da economia identificada, etc.)
  não afeta o escopo técnico do MVP e pode ser decidido em paralelo.
