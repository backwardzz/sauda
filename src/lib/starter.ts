/** Товар общего справочника глазами магазина. */
export interface CatalogItem {
  id: string;
  name: string;
  barcode: string;
  unit: string;
  category: string;
  subcategory: string;
  /** Товар уже есть в списке магазина (совпал штрихкод). */
  mine: boolean;
}

export interface StarterItem extends CatalogItem {
  starter_pack: string;
}

export interface StarterPack {
  key: string;
  title: string;
  hint: string;
  /** Пакет не отмечен заранее: товар подходит не каждому магазину. */
  optional?: boolean;
}

/** Пакеты мастера «У меня новый магазин». Состав пакетов задаётся в scripts/catalog-packs.ts. */
export const STARTER_PACKS: StarterPack[] = [
  { key: 'drinks', title: 'Напитки', hint: 'Вода, газировка, соки, холодный чай, энергетики' },
  { key: 'dairy', title: 'Молочные продукты', hint: 'Молоко, кефир и айран, сметана, масло, йогурты, сгущёнка' },
  { key: 'grocery', title: 'Бакалея', hint: 'Мука, крупы, макароны, масло, соусы, специи, консервы' },
  { key: 'tea', title: 'Чай и кофе', hint: 'Чай в пачках и пакетиках, растворимый кофе, 3 в 1' },
  { key: 'sweets', title: 'Сладости', hint: 'Шоколад, батончики, печенье, вафли, жвачка' },
  { key: 'snacks', title: 'Снеки и лапша', hint: 'Чипсы, сухарики, семечки, лапша быстрого приготовления' },
  { key: 'frozen', title: 'Заморозка', hint: 'Мороженое, пельмени, полуфабрикаты' },
  { key: 'hygiene', title: 'Гигиена', hint: 'Мыло, шампуни, зубная паста, прокладки, подгузники, салфетки' },
  { key: 'household', title: 'Бытовая химия и хозтовары', hint: 'Стирка, посуда, уборка, пакеты, губки, спички' },
  { key: 'tobacco', title: 'Табак', hint: 'Сигареты, стики, зажигалки', optional: true },
  { key: 'alcohol', title: 'Пиво и алкоголь', hint: 'Нужна лицензия на продажу алкоголя', optional: true },
];
