function verifiedRationale(candidate) {
  if (typeof candidate?.rationale !== "string") {
    throw new Error("candidate rationale must be text");
  }
  if (/\r|\n/.test(candidate.rationale)) {
    throw new Error("candidate rationale must not contain a line break");
  }
  const rationale = candidate.rationale.trim();
  if (!rationale) throw new Error("candidate rationale must be non-empty");
  return rationale.slice(0, 180);
}

function businessName(candidate) {
  if (typeof candidate?.businessName !== "string" || !candidate.businessName.trim()) {
    throw new Error("candidate businessName must be non-empty");
  }
  return candidate.businessName.trim();
}

export function initialMessage(candidate) {
  return [
    `Merhaba ${businessName(candidate)},`,
    "",
    verifiedRationale(candidate),
    "",
    "StockPulse ile fiziksel stok hareketlerini daha görünür kılmaya çalışıyoruz. örnek verili demoyu göndermemi ister misiniz?",
    "",
    "İlgilenmiyorsanız belirtmeniz yeterli; tekrar mesaj göndermem.",
  ].join("\n");
}

export function followupMessage(candidate) {
  return [
    `Merhaba ${businessName(candidate)},`,
    "",
    `${verifiedRationale(candidate)} Bu konuda örnek verili demoyu paylaşmamı ister misiniz?`,
    "",
    "İlgilenmiyorsanız belirtmeniz yeterli; bundan sonra tekrar yazmayacağım.",
  ].join("\n");
}
