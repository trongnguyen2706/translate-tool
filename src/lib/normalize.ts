export function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

export function meaningKey(meaningEn: string, meaningVi: string) {
  return normalizeText(meaningEn || meaningVi).slice(0, 180);
}
