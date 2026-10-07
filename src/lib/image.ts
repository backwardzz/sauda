/** Предел базы для логотипа (ограничение orgs.logo_url). */
const MAX_LENGTH = 200_000;

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать картинку: выберите файл PNG, JPG или WebP'));
    };
    img.src = url;
  });
}

/**
 * Фото товара из файла: уменьшается до max по большей стороне и сжимается, прозрачный фон становится белым.
 * Телефонный снимок на 5 МБ превращается в файл на 50–150 КБ — столько весит картинка в списке товаров.
 */
export async function fileToPhoto(file: File, max = 1000): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите картинку: PNG, JPG или WebP');
  const img = await load(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не смог обработать картинку');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  // браузер без WebP молча отдаёт PNG — тогда берём JPEG
  let blob = await encode('image/webp');
  if (blob?.type !== 'image/webp') blob = await encode('image/jpeg');
  if (!blob) throw new Error('Браузер не смог обработать картинку');
  return blob;
}

/**
 * Логотип из файла: картинка вписывается в белый квадрат и сжимается, чтобы храниться прямо в базе
 * и не тормозить списки. Хранилища файлов у площадки нет.
 */
export async function fileToLogo(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите картинку: PNG, JPG или WebP');
  const img = await load(file);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не смог обработать картинку');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / img.width, size / img.height);
  const [w, h] = [img.width * scale, img.height * scale];
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

  for (const quality of [0.9, 0.75, 0.6]) {
    // браузер без WebP молча отдаёт PNG — тогда берём JPEG
    let url = canvas.toDataURL('image/webp', quality);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= MAX_LENGTH) return url;
  }
  throw new Error('Картинка слишком большая: выберите файл попроще');
}
