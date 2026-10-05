// Открытые базы товаров (лицензия CC BY-SA): в каталоге хранится только ссылка на фото.
const SOURCES = ['world.openfoodfacts.org', 'world.openbeautyfacts.org', 'world.openproductsfacts.org'];

/** Фото лицевой стороны товара по заводскому штрихкоду; пустая строка — фото не нашлось. */
export async function findPhoto(barcode: string): Promise<string> {
  const code = barcode.trim();
  if (!/^\d{8,14}$/.test(code)) return '';
  for (const host of SOURCES) {
    try {
      const res = await fetch(`https://${host}/api/v2/product/${code}.json?fields=image_front_url`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const url = ((await res.json()) as { product?: { image_front_url?: string } }).product?.image_front_url;
      if (url?.startsWith('https://')) return url;
    } catch {
      // база недоступна: пробуем следующую
    }
  }
  return '';
}
