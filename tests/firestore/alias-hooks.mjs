// "@/..." を src/ 配下の .ts に解決する(テスト専用)。
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
}
