import { get, put } from "@vercel/blob";

export async function uploadBillFile(
  consumerUnitId: string,
  file: File,
): Promise<string> {
  const pathname = `bills/${consumerUnitId}/${crypto.randomUUID()}-${file.name}`;
  // Bills contain personal financial data, so the underlying file must not be
  // publicly reachable by anyone who guesses/obtains the URL.
  const blob = await put(pathname, file, { access: "private" });
  return blob.url;
}

export async function downloadBillFile(
  fileUrl: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const result = await get(fileUrl, { access: "private" });
  if (!result || result.statusCode !== 200) {
    throw new Error("Arquivo da fatura não encontrado no Vercel Blob");
  }

  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: result.blob.contentType,
  };
}
