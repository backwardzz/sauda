import { useRef, useState } from 'react';
import { fileToLogo } from '../lib/image';
import { CompanyAvatar } from './CompanyAvatar';
import { Icon } from './Icon';
import { toast } from './toast';

interface Props {
  name: string;
  value: string;
  /** Без обработчика — только показ. */
  onChange?: (logo: string) => Promise<void> | void;
  size?: number;
}

/** Логотип с загрузкой из файла: картинка сжимается в браузере и сохраняется сразу. */
export function LogoUpload({ name, value, onChange, size = 88 }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (make: () => Promise<string> | string) => {
    if (!onChange) return;
    setBusy(true);
    try {
      await onChange(await make());
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  if (!onChange) return <CompanyAvatar name={name} logo={value} size={size} />;

  return (
    <div className="logo-upload">
      <button type="button" className="logo-button" disabled={busy} onClick={() => file.current?.click()} aria-label="Загрузить логотип" title="Загрузить логотип">
        <CompanyAvatar name={name} logo={value} size={size} />
        <span className="logo-badge"><Icon name="edit" size={14} /></span>
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && apply(() => fileToLogo(e.target.files![0]))} />
      {value && <button type="button" className="btn ghost small" disabled={busy} onClick={() => apply(() => '')}>Убрать</button>}
    </div>
  );
}
