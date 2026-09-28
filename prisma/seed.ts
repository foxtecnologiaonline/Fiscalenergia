import { PrismaClient, type Room, type TariffFlag } from "@prisma/client";

import { estimateMonthlyKwh } from "../lib/calculations";
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

// Catálogo de referência de aparelhos por cômodo, usado para pré-preencher o
// assistente de varredura (Fase 5). Potências e padrões de uso são
// ILUSTRATIVOS — baseados em faixas típicas de mercado conhecidas
// publicamente, não em uma tabela consolidada do INMETRO/Procel (a busca
// feita para este seed não retornou uma tabela pronta com valores por
// categoria — ver docs/SCOPE.md, seção 10). Precisam ser substituídos ou
// confirmados contra fontes oficiais (INMETRO/Procel/Procon) antes de usar
// em produção. `typicalUsageHoursPerDay` para aparelhos com ciclo
// intermitente (geladeira, ar-condicionado) representa uma média equivalente
// de uso em potência plena, não o tempo ligado na tomada. `referenceKwhMonth`
// é calculado a partir dos próprios valores típicos (mesma fórmula de
// lib/calculations.ts), servindo apenas como referência de exibição.
const APPLIANCE_CATALOG: {
  room: Room;
  name: string;
  category: string;
  typicalPowerW: number;
  typicalUsageHoursPerDay: number;
  typicalUsageDaysPerWeek: number;
  notes?: string;
}[] = [
  // Cozinha
  {
    room: "cozinha",
    name: "Geladeira",
    category: "Refrigeração",
    typicalPowerW: 150,
    typicalUsageHoursPerDay: 8,
    typicalUsageDaysPerWeek: 7,
    notes: "Horas equivalentes de compressor em potência plena, não tempo ligado na tomada (24h).",
  },
  {
    room: "cozinha",
    name: "Freezer",
    category: "Refrigeração",
    typicalPowerW: 200,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "cozinha",
    name: "Micro-ondas",
    category: "Cocção",
    typicalPowerW: 1200,
    typicalUsageHoursPerDay: 0.3,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "cozinha",
    name: "Forno elétrico",
    category: "Cocção",
    typicalPowerW: 1500,
    typicalUsageHoursPerDay: 0.5,
    typicalUsageDaysPerWeek: 4,
  },
  {
    room: "cozinha",
    name: "Cafeteira elétrica",
    category: "Cocção",
    typicalPowerW: 800,
    typicalUsageHoursPerDay: 0.25,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "cozinha",
    name: "Liquidificador",
    category: "Utilidades",
    typicalPowerW: 400,
    typicalUsageHoursPerDay: 0.15,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "cozinha",
    name: "Batedeira",
    category: "Utilidades",
    typicalPowerW: 300,
    typicalUsageHoursPerDay: 0.1,
    typicalUsageDaysPerWeek: 3,
  },
  {
    room: "cozinha",
    name: "Fritadeira elétrica (air fryer)",
    category: "Cocção",
    typicalPowerW: 1400,
    typicalUsageHoursPerDay: 0.4,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "cozinha",
    name: "Torradeira",
    category: "Cocção",
    typicalPowerW: 800,
    typicalUsageHoursPerDay: 0.1,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "cozinha",
    name: "Lava-louças",
    category: "Utilidades",
    typicalPowerW: 1200,
    typicalUsageHoursPerDay: 1,
    typicalUsageDaysPerWeek: 4,
  },
  {
    room: "cozinha",
    name: "Purificador de água elétrico",
    category: "Utilidades",
    typicalPowerW: 20,
    typicalUsageHoursPerDay: 24,
    typicalUsageDaysPerWeek: 7,
    notes: "Consumo em stand-by contínuo (refrigeração do reservatório).",
  },
  {
    room: "cozinha",
    name: "Exaustor/depurador de ar",
    category: "Ventilação",
    typicalPowerW: 150,
    typicalUsageHoursPerDay: 1,
    typicalUsageDaysPerWeek: 7,
  },

  // Sala
  {
    room: "sala",
    name: "TV LED 50\"",
    category: "Eletrônicos",
    typicalPowerW: 120,
    typicalUsageHoursPerDay: 5,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "sala",
    name: "Ar-condicionado split 9000 BTU",
    category: "Climatização",
    typicalPowerW: 900,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "sala",
    name: "Ventilador de coluna",
    category: "Climatização",
    typicalPowerW: 70,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "sala",
    name: "Home theater/soundbar",
    category: "Eletrônicos",
    typicalPowerW: 60,
    typicalUsageHoursPerDay: 3,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "sala",
    name: "Videogame (console)",
    category: "Eletrônicos",
    typicalPowerW: 150,
    typicalUsageHoursPerDay: 2,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "sala",
    name: "Roteador Wi-Fi",
    category: "Eletrônicos",
    typicalPowerW: 10,
    typicalUsageHoursPerDay: 24,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "sala",
    name: "Aquecedor elétrico ambiente",
    category: "Climatização",
    typicalPowerW: 1500,
    typicalUsageHoursPerDay: 2,
    typicalUsageDaysPerWeek: 3,
  },

  // Quarto
  {
    room: "quarto",
    name: "TV LED 32\"",
    category: "Eletrônicos",
    typicalPowerW: 60,
    typicalUsageHoursPerDay: 3,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "quarto",
    name: "Ar-condicionado split 9000 BTU",
    category: "Climatização",
    typicalPowerW: 900,
    typicalUsageHoursPerDay: 8,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "quarto",
    name: "Ventilador de teto",
    category: "Climatização",
    typicalPowerW: 80,
    typicalUsageHoursPerDay: 8,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "quarto",
    name: "Ventilador de mesa",
    category: "Climatização",
    typicalPowerW: 50,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "quarto",
    name: "Notebook",
    category: "Eletrônicos",
    typicalPowerW: 65,
    typicalUsageHoursPerDay: 4,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "quarto",
    name: "Carregador de celular",
    category: "Eletrônicos",
    typicalPowerW: 10,
    typicalUsageHoursPerDay: 2,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "quarto",
    name: "Umidificador de ar",
    category: "Climatização",
    typicalPowerW: 30,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "quarto",
    name: "Aquecedor elétrico ambiente",
    category: "Climatização",
    typicalPowerW: 1500,
    typicalUsageHoursPerDay: 2,
    typicalUsageDaysPerWeek: 3,
  },

  // Banheiro
  {
    room: "banheiro",
    name: "Chuveiro elétrico",
    category: "Aquecimento de água",
    typicalPowerW: 5500,
    typicalUsageHoursPerDay: 0.3,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "banheiro",
    name: "Secador de cabelo",
    category: "Cuidados pessoais",
    typicalPowerW: 1800,
    typicalUsageHoursPerDay: 0.15,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "banheiro",
    name: "Torneira elétrica",
    category: "Aquecimento de água",
    typicalPowerW: 4500,
    typicalUsageHoursPerDay: 0.1,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "banheiro",
    name: "Exaustor",
    category: "Ventilação",
    typicalPowerW: 30,
    typicalUsageHoursPerDay: 1,
    typicalUsageDaysPerWeek: 7,
  },

  // Área de serviço/Lavanderia
  {
    room: "area_servico",
    name: "Máquina de lavar roupas",
    category: "Utilidades",
    typicalPowerW: 500,
    typicalUsageHoursPerDay: 1,
    typicalUsageDaysPerWeek: 4,
  },
  {
    room: "area_servico",
    name: "Secadora de roupas",
    category: "Utilidades",
    typicalPowerW: 3000,
    typicalUsageHoursPerDay: 1,
    typicalUsageDaysPerWeek: 3,
  },
  {
    room: "area_servico",
    name: "Ferro de passar roupa",
    category: "Utilidades",
    typicalPowerW: 1200,
    typicalUsageHoursPerDay: 0.5,
    typicalUsageDaysPerWeek: 3,
  },
  {
    room: "area_servico",
    name: "Tanquinho",
    category: "Utilidades",
    typicalPowerW: 400,
    typicalUsageHoursPerDay: 0.5,
    typicalUsageDaysPerWeek: 3,
  },

  // Escritório/Home office
  {
    room: "escritorio",
    name: "Computador desktop",
    category: "Eletrônicos",
    typicalPowerW: 250,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "escritorio",
    name: "Notebook",
    category: "Eletrônicos",
    typicalPowerW: 65,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "escritorio",
    name: "Monitor externo",
    category: "Eletrônicos",
    typicalPowerW: 30,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "escritorio",
    name: "Impressora",
    category: "Eletrônicos",
    typicalPowerW: 20,
    typicalUsageHoursPerDay: 0.2,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "escritorio",
    name: "Ar-condicionado portátil",
    category: "Climatização",
    typicalPowerW: 1000,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 5,
  },
  {
    room: "escritorio",
    name: "Ventilador de mesa",
    category: "Climatização",
    typicalPowerW: 50,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 5,
  },

  // Área externa/Garagem
  {
    room: "area_externa",
    name: "Bomba de piscina",
    category: "Utilidades",
    typicalPowerW: 750,
    typicalUsageHoursPerDay: 6,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "area_externa",
    name: "Portão eletrônico",
    category: "Utilidades",
    typicalPowerW: 200,
    typicalUsageHoursPerDay: 0.05,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "area_externa",
    name: "Iluminação externa (refletor LED)",
    category: "Iluminação",
    typicalPowerW: 30,
    typicalUsageHoursPerDay: 8,
    typicalUsageDaysPerWeek: 7,
  },
  {
    room: "area_externa",
    name: "Carregador de veículo elétrico",
    category: "Utilidades",
    typicalPowerW: 7000,
    typicalUsageHoursPerDay: 2,
    typicalUsageDaysPerWeek: 3,
  },
  {
    room: "area_externa",
    name: "Lavadora de alta pressão",
    category: "Utilidades",
    typicalPowerW: 1400,
    typicalUsageHoursPerDay: 0.3,
    typicalUsageDaysPerWeek: 1,
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

  for (const item of APPLIANCE_CATALOG) {
    const referenceKwhMonth = estimateMonthlyKwh({
      powerW: item.typicalPowerW,
      usageHoursPerDay: item.typicalUsageHoursPerDay,
      usageDaysPerWeek: item.typicalUsageDaysPerWeek,
      quantity: 1,
    });
    await db.applianceCatalog.upsert({
      where: { room_name: { room: item.room, name: item.name } },
      update: {
        category: item.category,
        typicalPowerW: item.typicalPowerW,
        typicalUsageHoursPerDay: item.typicalUsageHoursPerDay,
        typicalUsageDaysPerWeek: item.typicalUsageDaysPerWeek,
        referenceKwhMonth,
        notes: item.notes ?? null,
      },
      create: {
        room: item.room,
        name: item.name,
        category: item.category,
        typicalPowerW: item.typicalPowerW,
        typicalUsageHoursPerDay: item.typicalUsageHoursPerDay,
        typicalUsageDaysPerWeek: item.typicalUsageDaysPerWeek,
        referenceKwhMonth,
        notes: item.notes ?? null,
      },
    });
  }
  console.log(`ApplianceCatalog: ${APPLIANCE_CATALOG.length} itens.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
