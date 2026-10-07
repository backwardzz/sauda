import { maskPhone, PHONE_PATTERN } from '../lib/format';

interface Props {
  value: string;
  onChange: (phone: string) => void;
  required?: boolean;
  autoComplete?: string;
}

/** Телефон в виде «+7 701 000 00 00»: принимает только цифры, не больше десяти после «+7», неполный номер не даёт сохранить форму. */
export function PhoneInput({ value, onChange, required, autoComplete }: Props) {
  return (
    <div className="phone-input">
      <span aria-hidden="true">KZ</span>
      <input
        value={value}
        onChange={(e) => onChange(maskPhone(e.target.value))}
        onFocus={() => { if (!value) onChange('+7 '); }}
        onBlur={() => { if (!/\d\D*\d/.test(value)) onChange(''); }}
        required={required}
        inputMode="tel"
        autoComplete={autoComplete}
        pattern={PHONE_PATTERN}
        title="Номер полностью: +7 и десять цифр"
        placeholder="+7 701 000 00 00"
      />
    </div>
  );
}
