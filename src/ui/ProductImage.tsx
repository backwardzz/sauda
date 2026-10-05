import { useState } from 'react';
import { Icon } from './Icon';

/** Фото товара по ссылке; если ссылки нет или картинка не загрузилась — нейтральная заглушка. */
export function ProductImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`product-image ${className}`}>
      {src && !broken ? (
        <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <Icon name="image" size={22} />
      )}
    </span>
  );
}
