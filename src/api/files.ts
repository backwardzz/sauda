// Файлы и серверные функции: хранилище фото и вызов серверного кода.
import { db, errorText } from '../lib/supabase';

/** Кладёт файл в открытое хранилище и возвращает его постоянную ссылку. Имя файла должно быть уникальным: ответ кешируется надолго. */
export async function uploadPublicFile(bucket: string, path: string, blob: Blob): Promise<string> {
  const { error } = await db.storage.from(bucket).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
  if (error) throw new Error(errorText(error));
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export const removeFile = (bucket: string, path: string) => db.storage.from(bucket).remove([path]);

export const invokeFunction = (name: string, body: Record<string, string>) => db.functions.invoke(name, { body });
