import { put } from "@vercel/blob";

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
