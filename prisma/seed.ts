import { PrismaClient, type TariffFlag } from "@prisma/client";

import { referenceMonthToDate } from "../lib/validations/bill";

const db = new PrismaClient();

// Histórico de bandeira tarifária vigente por mês (dado público ANEEL).
// Últimos ~12 meses a partir de quando este seed foi escrito (setembro de
// 2026), levantados via busca na web em fontes que citam o calendário de
// acionamento da ANEEL — não é uma cópia direta do Portal de Dados Abertos
// (https://dadosabertos.aneel.gov.br/dataset/bandeiras-tarifarias).
// Confirme contra a fonte oficial antes de usar em produção.
const TARIFF_FLAG_HISTORY: { referenceMonth: string; flag: TariffFlag }[] = [
  { referenceMonth: "2025-10", flag: "vermelha_p1" },
  { referenceMonth: "2025-11", flag: "vermelha_p1" },
  { referenceMonth: "2025-12", flag: "amarela" },
  { referenceMonth: "2026-01", flag: "verde" },
  { referenceMonth: "2026-02", flag: "verde" },
  { referenceMonth: "2026-03", flag: "verde" },
  { referenceMonth: "2026-04", flag: "verde" },
  { referenceMonth: "2026-05", flag: "amarela" },
  { referenceMonth: "2026-06", flag: "amarela" },
  { referenceMonth: "2026-07", flag: "amarela" },
  { referenceMonth: "2026-08", flag: "amarela" },
  { referenceMonth: "2026-09", flag: "amarela" },
];

// Tarifas homologadas (TE+TUSD) e alíquota de ICMS por distribuidora/UF/
// grupo/subgrupo. Valores ILUSTRATIVOS para viabilizar o desenvolvimento e
// os testes automatizados (ver docs/SCOPE.md, seção 10) — precisam ser
// substituídos pelos valores homologados reais (ANEEL/distribuidora) antes
// de usar em produção.
const TARIFF_REFERENCES = [
  {
    distributor: "Enel SP",
    uf: "SP",
    tariffGroup: "B" as const,
    tariffSubgroup: "B1",
    validFrom: "2025-01",
    validTo: null,
    kwhRate: 0.98,
    icmsRate: 0.18,
  },
  {
    distributor: "Cemig",
    uf: "MG",
    tariffGroup: "B" as const,
    tariffSubgroup: "B1",
    validFrom: "2025-01",
    validTo: null,
    kwhRate: 0.92,
    icmsRate: 0.18,
  },
];

async function main() {
  for (const entry of TARIFF_FLAG_HISTORY) {
    const referenceMonth = referenceMonthToDate(entry.referenceMonth);
    await db.tariffFlagHistory.upsert({
      where: { referenceMonth },
      update: { flag: entry.flag },
      create: { referenceMonth, flag: entry.flag },
    });
  }
  console.log(`TariffFlagHistory: ${TARIFF_FLAG_HISTORY.length} meses.`);

  for (const entry of TARIFF_REFERENCES) {
    const validFrom = referenceMonthToDate(entry.validFrom);
    const validTo = entry.validTo ? referenceMonthToDate(entry.validTo) : null;
    await db.tariffReference.upsert({
      where: {
        distributor_uf_tariffGroup_tariffSubgroup_validFrom: {
          distributor: entry.distributor,
          uf: entry.uf,
          tariffGroup: entry.tariffGroup,
          tariffSubgroup: entry.tariffSubgroup,
          validFrom,
        },
      },
      update: {
        validTo,
        kwhRate: entry.kwhRate,
        icmsRate: entry.icmsRate,
      },
      create: {
        distributor: entry.distributor,
        uf: entry.uf,
        tariffGroup: entry.tariffGroup,
        tariffSubgroup: entry.tariffSubgroup,
        validFrom,
        validTo,
        kwhRate: entry.kwhRate,
        icmsRate: entry.icmsRate,
      },
    });
  }
  console.log(`TariffReference: ${TARIFF_REFERENCES.length} registros.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
