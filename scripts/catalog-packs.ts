// Состав пакетов мастера «У меня новый магазин»: ходовые марки по подкатегориям справочника.
// Правило берёт из подкатегории товары, в названии которых есть марка, не больше max штук.
// Ключи пакетов — src/lib/starter.ts.

export interface PackRule {
  /** Подкатегория справочника (или категория, если подкатегории нет), без учёта регистра. */
  sub: RegExp;
  /** Марки и слова в названии. */
  name: RegExp;
  max: number;
}

export const PACK_RULES: Record<string, PackRule[]> = {
  drinks: [
    { sub: /^вода$/, name: /tassay|asu|bonaqua|turan|borjomi|сарыагаш|saryagash/i, max: 24 },
    { sub: /^газ соки$/, name: /coca|fanta|sprite|pepsi|mirinda|7 ?up|piko|maxi|дюшес|буратино|тархун|лимонад/i, max: 24 },
    { sub: /^(натуральные соки|безгаз соки)$/, name: /rich|juicy|gracio|da-?da|palma|piko|добрый|нектар/i, max: 20 },
    { sub: /^холодный чай$/, name: /fuse|lipton|tassay|maxi|piala/i, max: 10 },
    { sub: /^энергетики$/, name: /red bull|gorilla|dizzy|burn|monster|adrenaline|flash|riks/i, max: 12 },
  ],
  dairy: [
    { sub: /^молоко$/, name: /./, max: 16 },
    { sub: /^айран\/кымыз$/, name: /айран|кефир|тан|ряженка|food ?master|milky/i, max: 10 },
    { sub: /^сметана$/, name: /./, max: 8 },
    { sub: /^сливочные масла/, name: /масло|president|rama|маргарин/i, max: 10 },
    { sub: /^йогурты$/, name: /fruttis|danone|food ?master|alpenland|активиа|чудо/i, max: 10 },
    { sub: /^творог/, name: /./, max: 6 },
    { sub: /^сыр плавленный$/, name: /hochland|president|дружба/i, max: 6 },
    { sub: /^сгущенка$/, name: /./, max: 6 },
  ],
  grocery: [
    { sub: /^мука$/, name: /./, max: 8 },
    { sub: /^крупа фасованная$/, name: /рис|греч|овсян|геркулес|пшен|манн|перлов|горох/i, max: 16 },
    { sub: /^макароны в пачках/, name: /makfa|султан|корона|granum|кайма|barilla|спагетти/i, max: 14 },
    { sub: /^масло растительное$/, name: /подсолнеч|шедевр|злато|олейна|золотая/i, max: 8 },
    { sub: /^сахар рафинад$/, name: /./, max: 4 },
    { sub: /^майонез$/, name: /calve|3 желания|три желания|махеев|слобода|ряба|провансаль/i, max: 8 },
    { sub: /^кетчуп\/соус\/уксус$/, name: /кетчуп|уксус|соевый|аджика/i, max: 10 },
    { sub: /^томатная паста$/, name: /./, max: 5 },
    { sub: /^специи$/, name: /соль|перец черн|лавр|приправа|maggi|ванил|сода|разрыхл/i, max: 16 },
    { sub: /^бульоны/, name: /maggi|gallina|rollton/i, max: 6 },
    { sub: /^дрожжи$/, name: /./, max: 3 },
    { sub: /^(овощи\/фрукты)$/, name: /горошек|кукуруз|огурц|томат|фасоль|bonduelle/i, max: 10 },
    { sub: /^(рыба|тушенка)$/, name: /шпрот|сайра|сардин|килька|скумбри|тушен|говядина/i, max: 10 },
  ],
  tea: [
    { sub: /^чай$/, name: /piala|пиала|assam|ассам|жамбо|jambo|симба|simba|greenfield|lipton|tess|ahmad|акбар|шах/i, max: 24 },
    { sub: /^кофе$/, name: /jacobs|nescafe|maccoffee|carte noire|jockey/i, max: 16 },
    { sub: /^какао$/, name: /nesquik|какао/i, max: 3 },
  ],
  sweets: [
    { sub: /^батончики$/, name: /snickers|twix|mars|bounty|milky way|kit ?kat|nuts|albeni|kinder|picnic/i, max: 16 },
    { sub: /^шоколад$/, name: /казахстан|рахат|alpen gold|milka|ozera|россия|dove|kinder/i, max: 12 },
    { sub: /^жвачки$/, name: /orbit|dirol|eclipse|colfresh|love is/i, max: 10 },
    { sub: /^(печенье\/пряники в коробках\/м\.у\.|печенье\/крекер\/крендель)$/, name: /choco ?pie|orion|юбилейное|oreo|tuc|яшкино|крекер/i, max: 14 },
    { sub: /^вафли$/, name: /яшкино|bayan sulu|баян сулу|артек/i, max: 6 },
    { sub: /^чупа чупс\/леденец$/, name: /chupa|halls|mentos/i, max: 6 },
    { sub: /^кекс\/рулет$/, name: /яшкино|kovis|7 ?days|барни/i, max: 6 },
    { sub: /^круассаны$/, name: /./, max: 4 },
  ],
  snacks: [
    { sub: /^чипсы$/, name: /lay'?s|pringles|cheetos|doritos|daritos|grizzly/i, max: 14 },
    { sub: /^сухарики$/, name: /flint|хрус|кириешки|3 корочки/i, max: 8 },
    { sub: /^семечки$/, name: /./, max: 8 },
    { sub: /^арахис\/фисташки$/, name: /beerka|big bob|арахис|фисташ/i, max: 6 },
    { sub: /^кукурузные палочки$/, name: /./, max: 4 },
    { sub: /^лапша бп$/, name: /big ?bon|биг ?бон|rollton|роллтон|доширак|dosirak|бизнес/i, max: 14 },
  ],
  frozen: [
    { sub: /^мороженое$/, name: /bahroma|эскимо|пломбир|рожок|стаканчик/i, max: 20 },
    { sub: /^пельмени$/, name: /./, max: 10 },
    { sub: /^вареники\/манты\/хинкали$/, name: /./, max: 5 },
    { sub: /^котлеты/, name: /./, max: 4 },
    { sub: /^тесто$/, name: /слоеное|слоёное/i, max: 3 },
  ],
  hygiene: [
    { sub: /^мыло$/, name: /duru|safeguard|dove|absolut|хозяйствен|жидкое|детское/i, max: 10 },
    { sub: /^шампунь/, name: /head|pantene|clear|dove|garnier|elseve|wash&go|шаума|чистая линия/i, max: 10 },
    { sub: /^зубная паста$/, name: /colgate|splat|blend|лесной/i, max: 6 },
    { sub: /^зубная щетка$/, name: /colgate/i, max: 3 },
    { sub: /^прокладки/, name: /kotex|always|ola|naturella|милана/i, max: 10 },
    { sub: /^подгузники$/, name: /huggies|pampers/i, max: 6 },
    { sub: /^туалетная бумага$/, name: /./, max: 5 },
    { sub: /^салфетки\/полотенца бум\.$/, name: /./, max: 5 },
    { sub: /^влажные салфетки$/, name: /./, max: 5 },
    { sub: /^ватный диск\/палочки$/, name: /./, max: 4 },
    { sub: /^дезодорант$/, name: /rexona|nivea|old spice|axe/i, max: 5 },
    { sub: /^для бритья$/, name: /gillette|bic|arko/i, max: 5 },
  ],
  household: [
    { sub: /^для стирки$/, name: /tide|ariel|persil|миф|lenor|vanish|белизна|bimax/i, max: 12 },
    { sub: /^для посуды$/, name: /fairy|aos|sorti|капля|миф/i, max: 6 },
    { sub: /^чистящие средства для дома$/, name: /domestos|sanfor|comet|mr\.? ?muscle|cif|grass/i, max: 8 },
    { sub: /^освежитель воздуха$/, name: /./, max: 3 },
    { sub: /^пакет\/маечка\/мусор\.п$/, name: /./, max: 8 },
    { sub: /^губки/, name: /./, max: 6 },
    { sub: /^пленка пищ/, name: /paclan|фольга|пленка|плёнка|пергамент/i, max: 5 },
    { sub: /^электротовары$/, name: /батарейк|лампо/i, max: 6 },
    { sub: /^от вредителей$/, name: /raid|раптор|дихлофос|mosquitall/i, max: 4 },
  ],
  tobacco: [
    { sub: /^сигареты$/, name: /esse|chapman|l&m|winston|parliament|kent|marlboro|camel|sobranie|ld|bond|davidoff|rothmans/i, max: 40 },
    { sub: /^стики$/, name: /heets|terea|fiit/i, max: 16 },
    { sub: /^зажигалки\/спички$/, name: /./, max: 6 },
  ],
  alcohol: [
    { sub: /^пиво$/, name: /./, max: 30 },
    { sub: /^водка$/, name: /хаома|haoma|хортиця|finlandia|absolut|parliament|нектар|wimbledon/i, max: 12 },
    { sub: /^коньяк\/бренди$/, name: /казахстан|kazakhstan|bacchus|арарат/i, max: 8 },
    { sub: /^вино$/, name: /bacchus|иссык|arba|киндзмараули/i, max: 8 },
  ],
};
