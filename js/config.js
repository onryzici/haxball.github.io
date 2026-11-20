// TOPARLAK — sabitler, yetenekler, renkler
window.TP = window.TP || {};
TP.VERSION = 'v4.1 • 20.11.2026';

TP.C = {
  TICK: 1 / 60,
  // Saha (dünya koordinatları, merkez 0,0)
  FW: 420,          // saha yarı genişliği (çizgi)
  FH: 200,          // saha yarı yüksekliği
  GH: 66,           // kale ağzı yarı yüksekliği
  GD: 46,           // kale derinliği
  OW: 502,          // oyuncu sınırı yarı genişlik
  OH: 254,          // oyuncu sınırı yarı yükseklik
  CENTER_R: 76,
  POST_R: 7,

  PLAYER_R: 16,
  PLAYER_ACC: 0.125,
  PLAYER_KICK_ACC: 0.104,
  SPRINT_MULT: 1.5,
  STAMINA_DRAIN: 1 / 140,
  STAMINA_REGEN: 1 / 230,
  STAMINA_DELAY: 35,
  STAMINA_MIN: 0.3,  // tükenince tekrar koşmak için gereken
  PLAYER_DAMP: 0.958,
  PLAYER_INVMASS: 0.5,

  BALL_R: 10,
  BALL_DAMP: 0.99,
  BALL_INVMASS: 1,
  BALL_BOUNCE: 0.5,
  PLAYER_BOUNCE: 0.5,

  KICK_RANGE: 7,
  KICK_BUFFER: 12,   // tuşu bıraktıktan sonra şutun geçerli kaldığı tick
  AIM_ASSIST: 0.6,   // şut yönüne girdi yönünün katkısı
  KICK_BASE: 5.4,
  KICK_CHARGE_BONUS: 5.6,
  CHARGE_TIME: 55,  // tick'te tam şarj
  KICK_RECOIL: 0.35,
  // yetenek ayarları (Emir, PR #2)
  BUZ_RANGE: 220,     // buzun etki menzili
  GIANT_R: 27, GIANT_INVMASS: 0.12, GIANT_KICK: 1.25,
  GLOVE_TIME: 180,    // eldivenin açık kaldığı tick
  GLOVE_HOLD: 50,     // topu tutma süresi (tick)

  GOAL_PAUSE: 300,  // gol sonrası tick (5 sn: laf sokma zamanı)
  KICKOFF_FREEZE: 50,
};

// Yetenekler
TP.ABILITIES = {
  roket:  { name: 'Roket Şut',   icon: '🚀', cd: 9.5, desc: 'Sonraki şutun füze olur: en sert şutun 1.6 katı hızla gider, yavaşlamaz, kaleye yönelir. Rakibi delip uçurur!' },
  falso:  { name: 'Falso',       icon: '🌀', cd: 7,   desc: 'Sonraki şutun güçlü kavis alır. Top havadayken sağa/sola basarak kavisi yönet! Basılı tutarken yolu görünür.' },
  sok:    { name: 'Şok Dalgası', icon: '💥', cd: 8,   desc: 'Etrafındaki top ve rakibi güçlü bir dalgayla dışarı fırlatır.' },
  buz:    { name: 'Buz',         icon: '🧊', cd: 10,  desc: 'Yakınındaki rakibi 2.5 saniye dondurur: yavaşlar, koşamaz, şut şarjı sıfırlanır. Uzaktaysa ıskalarsın.' },
  isinlan:{ name: 'Işınlanma',   icon: '✨', cd: 11,   desc: 'Anında topun arkasına, rakip kaleye bakacak şekilde ışınlanırsın.' },
  kalkan: { name: 'Kale Duvarı', icon: '🛡️', cd: 12,  desc: 'Kalenin önüne 4.5 saniyelik sağlam bir duvar dikersin.' },
  eldiven:{ name: 'Kaleci Eldiveni', icon: '🧤', cd: 11, desc: '3 saniye boyunca kendi yarı sahanda topa değersen onu kısa süre tutarsın, şutla bırakırsın. Roketleri de tutar.' },
  hayalet:{ name: 'Hayalet',     icon: '👻', cd: 9,   desc: '4 saniye boyunca RAKİP SENİ GÖREMEZ, içinden geçersin, mayınlara basmazsın.' },
  turbo:  { name: 'Turbo',       icon: '⚡', cd: 11,  desc: '4 saniye boyunca çok hızlısın ve koşu barın hiç azalmaz.' },
  ters:   { name: 'Ters Kontrol',icon: '🔄', cd: 12,  desc: 'Rakibin tuşları 2 saniye ters çalışır. Sola basan sağa gider!' },
  bomba:  { name: 'Bomba Top',   icon: '💣', cd: 10,  desc: 'Top 1.7 saniye sonra patlar: yakındakiler savrulur, rakip sersemler.' },
  mayin:  { name: 'Mayın',       icon: '🧨', cd: 7,   desc: 'Bulunduğun yere mayın bırakırsın (en fazla 2). Rakip basarsa havaya uçar.' },
  ruzgar: { name: 'Rüzgar',      icon: '🌪️', cd: 20,  desc: '3.5 saniye boyunca top ve rakip, rakip kaleye doğru rüzgarla itilir.' },
  cagir:  { name: 'Topu Çağır',  icon: '🪄', cd: 14,  desc: 'Top nerede olursa olsun anında ayağının önüne gelir.' },
  sis:    { name: 'Sis',         icon: '🌫️', cd: 9,   desc: 'Top 2.8 saniye boyunca neredeyse görünmez olur. Kafalar karışsın!' },
};
// Bekleme süreleri: tablodaki temel değerler x2.5 (yarım saniyeye yuvarlanır)
TP.CD_MULT = 2.5;
for (const k in TP.ABILITIES) TP.ABILITIES[k].cd = Math.round(TP.ABILITIES[k].cd * TP.CD_MULT * 2) / 2;
TP.ABILITY_KEYS = Object.keys(TP.ABILITIES);
TP.EMOTES = ['', '😂', '🔥', '😡', '👍'];
TP.TAUNTS = [
  'Siktir git, kaleci misin direk mi? 😂',
  'Ağla ağla, kimse duymaz!',
  'Oha amk, ne oynuyorsun sen?',
  'Bok gibi oynuyorsun kardeşim',
  'Top orada geri zekalı, orada!',
  'Hadi lan, git yatağında ağla',
];
TP.THEMES = [{ id: 'rastgele', name: 'Rastgele' }, { id: 'gunduz', name: 'Gündüz' }, { id: 'aksam', name: 'Akşam' }, { id: 'gece', name: 'Gece' }];
TP.DECK_SIZE = 3;
TP.randomDeck = function () { const k = TP.ABILITY_KEYS.slice().sort(() => Math.random() - 0.5); return k.slice(0, TP.DECK_SIZE); };

TP.PATTERNS = [
  { id: 'duz', name: 'Düz' },
  { id: 'dikey', name: 'Dikey Çizgi' },
  { id: 'yatay', name: 'Yatay Çizgi' },
  { id: 'yarim', name: 'Yarım' },
  { id: 'capraz', name: 'Çapraz Bant' },
  { id: 'halka', name: 'Halka' },
  { id: 'dama', name: 'Dama' },
  { id: 'sevron', name: 'Şevron' },
];

TP.EYES = [
  { id: 'normal', name: 'Normal' },
  { id: 'kizgin', name: 'Kızgın' },
  { id: 'sevimli', name: 'Sevimli' },
  { id: 'havali', name: 'Havalı' },
  { id: 'uykulu', name: 'Uykulu' },
];

TP.HAIRS = [
  { id: 'yok', name: 'Kel' },
  { id: 'kisa', name: 'Kısa' },
  { id: 'diken', name: 'Diken' },
  { id: 'ibik', name: 'İbik' },
  { id: 'afro', name: 'Afro' },
  { id: 'kase', name: 'Kâse' },
  { id: 'atkuyrugu', name: 'At Kuyruğu' },
  { id: 'uzun', name: 'Uzun' },
];
TP.HAIR_COLORS = ['#1b1b1b', '#4a2c17', '#8b5a2b', '#e8c14f', '#c0392b', '#d9d9d9', '#3a86ff', '#ff5d8f', '#06d6a0', '#7b2cbf'];
TP.ACCS = [
  { id: 'yok', name: 'Yok' },
  { id: 'sapka', name: 'Şapka' },
  { id: 'bandana', name: 'Bandana' },
  { id: 'tac', name: 'Taç' },
  { id: 'kulaklik', name: 'Kulaklık' },
  { id: 'biyik', name: 'Bıyık' },
  { id: 'yara', name: 'Yara Bandı' },
];

TP.SWATCHES = ['#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#06d6a0', '#118ab2', '#3a86ff', '#7b2cbf',
  '#ff5d8f', '#1d1d1d', '#f8f9fa', '#6c4f3d', '#8ac926', '#0b3d91', '#ff7b00', '#9aa5b1'];

TP.defaultChar = function (i) {
  const presets = [
    { name: 'Oyuncu 1', c1: '#e63946', c2: '#f8f9fa', pattern: 'dikey', number: 10, eyes: 'kizgin', ability: 'roket', hair: 'diken', hairColor: '#1b1b1b', acc: 'yok' },
    { name: 'Oyuncu 2', c1: '#3a86ff', c2: '#ffd23f', pattern: 'halka', number: 7, eyes: 'normal', ability: 'turbo', hair: 'kisa', hairColor: '#e8c14f', acc: 'bandana' },
  ];
  return Object.assign({}, presets[i % 2]);
};

TP.randomChar = function (name) {
  const r = (a) => a[Math.floor(Math.random() * a.length)];
  let c1 = r(TP.SWATCHES), c2 = r(TP.SWATCHES);
  while (c2 === c1) c2 = r(TP.SWATCHES);
  return {
    name: name || r(['Robo', 'Bilye', 'Topçu', 'Fırtına', 'Kartal', 'Yumurcak']),
    c1, c2, pattern: r(TP.PATTERNS).id, number: 1 + Math.floor(Math.random() * 99),
    eyes: r(TP.EYES).id, ability: r(TP.ABILITY_KEYS),
    hair: r(TP.HAIRS).id, hairColor: r(TP.HAIR_COLORS), acc: Math.random() < 0.5 ? 'yok' : r(TP.ACCS).id,
  };
};

TP.sanitizeChar = function (c, i) {
  const d = TP.defaultChar(i || 0);
  c = c || {};
  const hex = (v, f) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : f);
  return {
    name: String(c.name || d.name).slice(0, 14),
    c1: hex(c.c1, d.c1),
    c2: hex(c.c2, d.c2),
    pattern: TP.PATTERNS.some(p => p.id === c.pattern) ? c.pattern : d.pattern,
    number: Math.max(0, Math.min(99, parseInt(c.number, 10) || 0)),
    eyes: TP.EYES.some(p => p.id === c.eyes) ? c.eyes : d.eyes,
    ability: TP.ABILITIES[c.ability] ? c.ability : d.ability,
    hair: TP.HAIRS.some(p => p.id === c.hair) ? c.hair : d.hair,
    hairColor: hex(c.hairColor, d.hairColor),
    acc: TP.ACCS.some(p => p.id === c.acc) ? c.acc : d.acc,
  };
};

// Forma çakışması: renkler çok benzerse ikinci oyuncu deplasman formasını giyer
TP.resolveKits = function (cs) {
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const dist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  const a = cs[0], b = Object.assign({}, cs[1]);
  if (dist(a.c1, b.c1) < 90) {
    if (dist(a.c1, b.c2) >= 90) { const t = b.c1; b.c1 = b.c2; b.c2 = t; }
    else {
      let best = TP.SWATCHES[0], bd = -1;
      for (const s of TP.SWATCHES) { const d = Math.min(dist(s, a.c1), dist(s, a.c2)); if (d > bd) { bd = d; best = s; } }
      b.c1 = best;
    }
  }
  if (a.name === b.name) b.name = b.name.slice(0, 12) + ' 2';
  return [a, b];
};
