import { fileToPhoto } from './image';
import { db, errorText } from './supabase';

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

/** Хранилище фото товаров: папка на компанию, читать может кто угодно, класть — сотрудники компании. */
const BUCKET = 'product-photos';

/** Сжимает картинку с компьютера, кладёт её в хранилище и возвращает постоянную ссылку для карточки товара. */
export async function uploadProductPhoto(orgId: string, file: File): Promise<string> {
  const blob = await fileToPhoto(file);
  const path = `${orgId}/${crypto.randomUUID()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
  // имя файла случайное и не повторяется, поэтому картинку можно кешировать надолго
  const { error } = await db.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
  if (error) throw new Error(errorText(error));
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Убирает из хранилища фото, загруженное с компьютера. Чужие ссылки (открытые базы, свой сайт) не трогает. */
export async function removeProductPhoto(url: string): Promise<void> {
  const path = url.split(`/storage/v1/object/public/${BUCKET}/`)[1];
  if (path) await db.storage.from(BUCKET).remove([decodeURIComponent(path)]);
}
