import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import type { AcceptedBillFileType } from "@/lib/validations/bill";
import {
  type ExtractedBill,
  extractedBillSchema,
} from "@/lib/validations/extracted-bill";

const MODEL = "claude-opus-5";

const client = new Anthropic();

const EXTRACTION_INSTRUCTIONS = `Você é um assistente que lê faturas de energia elétrica de distribuidoras brasileiras e extrai os dados em formato estruturado.

Extraia os seguintes campos da fatura anexada:
- totalAmount: valor total da fatura em R$.
- consumptionKwh: consumo faturado no período, em kWh.
- tariffFlag: bandeira tarifária cobrada ("verde", "amarela", "vermelha_p1" ou "vermelha_p2").
- previousReadingKwh: leitura anterior do medidor, em kWh.
- currentReadingKwh: leitura atual do medidor, em kWh.
- billingDays: quantidade de dias do período de faturamento.
- appliedKwhRate: tarifa de kWh aplicada (R$/kWh), sem os demais encargos.
- lineItems: lista dos itens detalhados da fatura (consumo, TUSD, bandeira, ICMS, COSIP/iluminação pública, outros encargos etc.), cada um com description, quantity, unitRate e amount.

Regras importantes:
- Se não tiver certeza de um valor, retorne null para aquele campo em vez de estimar ou inventar um número.
- Não confunda a leitura do medidor com o consumo faturado — são coisas diferentes.
- Números devem usar ponto como separador decimal (nunca vírgula).`;

function buildDocumentBlock(
  mimeType: AcceptedBillFileType,
  base64Data: string,
): Anthropic.ContentBlockParam {
  if (mimeType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64Data },
    };
  }
  return {
    type: "image",
    source: { type: "base64", media_type: mimeType, data: base64Data },
  };
}

export async function extractBillData(
  fileBuffer: Buffer,
  mimeType: AcceptedBillFileType,
): Promise<ExtractedBill> {
  const base64Data = fileBuffer.toString("base64");

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          buildDocumentBlock(mimeType, base64Data),
          { type: "text", text: EXTRACTION_INSTRUCTIONS },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(extractedBillSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("O Claude não retornou uma extração válida para esta fatura");
  }

  return response.parsed_output;
}
