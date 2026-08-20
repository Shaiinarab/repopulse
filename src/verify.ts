const encoder = new TextEncoder();

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    return null;
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function verifyGitHubSignature(
  secret: string | undefined,
  signatureHeader: string | null,
  payload: ArrayBuffer,
): Promise<boolean> {
  if (!secret || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const signature = hexToBytes(signatureHeader.slice("sha256=".length));
  if (!signature) {
    return false;
  }

  const algorithm: HmacImportParams = {
    name: "HMAC",
    hash: "SHA-256",
  };

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    algorithm,
    false,
    ["verify"],
  );

  const signatureBytes = new Uint8Array(signature.byteLength);
  signatureBytes.set(signature);
  return crypto.subtle.verify("HMAC", key, signatureBytes.buffer, payload);
}
