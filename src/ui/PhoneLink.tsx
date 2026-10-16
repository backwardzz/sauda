/** Номер телефона ссылкой для звонка: в адрес идут только цифры и «+». */
export function PhoneLink({ phone }: { phone: string }) {
  return <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>;
}
