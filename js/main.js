// TOPARLAK — oyun akışı, menüler, kart seçimi, ağ senkronu
(function () {
  const $ = (id) => document.getElementById(id);
  const C = TP.C;
  const A = TP.Audio;
  const I = TP.Input;

  function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  let chars = load('tp_chars', null);
  if (!Array.isArray(chars) || chars.length < 2) chars = [TP.defaultChar(0), TP.defaultChar(1)];
  chars = chars.map((c, i) => TP.sanitizeChar(c, i));
  const settings = Object.assign({ time: 180, goals: 5, bot: 'orta', theme: 'rastgele', extra: 'yok' }, load('tp_settings', {}));
  if (settings.theme === 'kar') settings.theme = 'rastgele';
  if (!['yok', 'langirt', 'kaos', 'ikisi'].includes(settings.extra)) settings.extra = 'yok';
  delete settings.map; delete settings.chaos;
  const pickMap = () => (settings.extra === 'langirt' || settings.extra === 'ikisi') ? 'langirt' : 'klasik';
  const pickChaos = () => settings.extra === 'kaos' || settings.extra === 'ikisi';
  const pickTheme = () => settings.theme === 'rastgele' ? ['gunduz', 'aksam', 'gece'][(Math.random() * 3) | 0] : settings.theme;

  const canvas = $('game');
  const R = new TP.Renderer(canvas);
  window.addEventListener('resize', () => R.resize());

  // ---------- durum ----------
  let mode = 'attract';          // attract | bot | local | host | guest
  let sim = null, bots = [], net = null;
  let remotes = new Map(), stallShown = false; // oyuncu no → { inp, q, at, gid }
  let matchTeams = [0, 1], me = 0, hudIdx = [0, 1];
  let paused = false, slowT = 0, acc = 0;
  let recentEv = [], lastEvId = 0, lastSnapTk = -1, snapAt = 0;
  let matchChars = null, matchOpts = null, matchId = 0, matchMode = null, matchEx = {};
  let opponentChar = null, endShown = false, hintTimer = null;
  let guestSeq = 0;
  // Misafir tarafı tahmin: hostIn = oda sahibinin son girdisi, pred = henüz onaylanmamış kendi girdilerimiz,
  // off = düzeltme sıçramalarını yumuşatmak için çizime eklenen sönümlü kayma (top, oyuncu 0, oyuncu 1)
  let hostIns = [], pred = [], pendingSnap = null;
  let off = [];
  let onlineDecks = [];
  let netPaused = false;
  const mouse = { x: 0, y: 0 };
  window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });

  const SCREENS = ['menu', 'creator', 'online', 'lobbyScreen', 'help', 'pause', 'endScreen', 'draft', 'keys', 'taunts'];
  function show(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    if (id === 'menu') refreshMenu();
  }
  const visible = (id) => !$(id).classList.contains('hidden');

  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.add('hidden'), ms || 2200);
  }

  function showNetBanner(t) { const b = $('netBanner'); b.querySelector('span').textContent = t; b.classList.remove('hidden'); }
  function hideNetBanner() { $('netBanner').classList.add('hidden'); }

  // ---------- arka plan (menüde botlar oynar) ----------
  function startAttract() {
    mode = 'attract'; paused = false;
    // arkada bazen 1v1 bazen 2v2 oynanır
    const n = Math.random() < 0.5 ? 2 : 4, teams = n === 2 ? [0, 1] : [0, 0, 1, 1];
    const cs = teamKits(teams.map(() => TP.randomChar()), teams);
    sim = new TP.Sim({ chars: cs, teams, timeLimit: 0, scoreLimit: 0, decks: teams.map(() => TP.randomDeck()) });
    bots = teams.map((_, i) => new TP.Bot(i % 2 ? 'orta' : 'zor'));
    matchTeams = teams; me = -1;
    R.setTeams(cs, teams); R.reset(); R.setViewer('shared');
    $('hud').classList.add('hidden');
  }

  // ---------- maç ----------
  // Takım formaları: 1v1'de çakışma çözülür; takımlarda herkes kaptanın (ilk oyuncu) formasını giyer
  function teamKits(cs, teams) {
    if (cs.length === 2 && teams[0] !== teams[1]) { const a = teams[0] === 0 ? 0 : 1; const r = TP.resolveKits([cs[a], cs[1 - a]]); const o = []; o[a] = r[0]; o[1 - a] = r[1]; return o; }
    const capI = [teams.indexOf(0), teams.indexOf(1)];
    const caps = TP.resolveKits([cs[capI[0]], cs[capI[1]]]);
    const used = new Set();
    return cs.map((c, i) => {
      const cap = caps[teams[i]];
      const o = Object.assign({}, c, { c1: cap.c1, c2: cap.c2, pattern: cap.pattern });
      let nm = o.name, k = 2; while (used.has(nm)) nm = o.name.slice(0, 11) + ' ' + (k++); o.name = nm; used.add(nm);
      return o;
    });
  }
  const isTeamMatch = () => matchChars && matchChars.length > 2;
  function teamName(t) {
    if (!matchChars) return '';
    const i = matchTeams.indexOf(t); if (i < 0) return '';
    return isTeamMatch() ? matchChars[i].name + ' takımı' : matchChars[i].name;
  }
  const teamCol = (t) => { const i = matchTeams.indexOf(t); return matchChars && matchChars[i] ? matchChars[i].c1 : '#fff'; };

  // ex: { teams, me, botIdx }
  function startMatch(m, cs, opts, decks, ex) {
    ex = ex || {}; matchEx = ex;
    const teams = ex.teams || cs.map((_, i) => i % 2);
    mode = m; matchMode = m; paused = false; endShown = false; slowT = 0; acc = 0;
    remotes = new Map(); stallShown = false;
    if (m !== 'guest') cs = teamKits(cs, teams);
    matchChars = cs; matchOpts = opts; matchTeams = teams;
    me = ex.me != null ? ex.me : (m === 'local' ? -1 : 0);
    sim = new TP.Sim({ chars: cs, teams, timeLimit: opts.time, scoreLimit: opts.goals, decks, client: m === 'guest', map: opts.map || 'klasik', chaos: !!opts.chaos });
    if (!opts.theme) opts.theme = pickTheme();
    R.setTheme(opts.theme);
    bots = cs.map((_, i) => (ex.botIdx || []).includes(i) ? new TP.Bot(ex.botLevel || settings.bot) : null);
    lastSnapTk = -1; lastEvId = 0; recentEv = [];
    hostIns = []; pred = []; pendingSnap = null; snapAt = 0; off = new Array(2 + cs.length * 2).fill(0);
    R.setTeams(cs, teams); R.reset();
    R.setViewer(m === 'local' ? 'shared' : me >= 0 ? teams[me] : 'izle');
    R.setMe(m === 'local' ? -1 : me);
    for (const s of SCREENS) $(s).classList.add('hidden');
    $('hud').classList.remove('hidden');
    // yetenek kartları: 1v1'de iki taraf; takım maçında yalnız kendi kartın (kendi tarafında)
    hudIdx = cs.length === 2 ? [teams.indexOf(0), teams.indexOf(1)] : [-1, -1];
    if (cs.length > 2 && me >= 0) hudIdx[teams[me]] = me;
    for (let t = 0; t < 2; t++) {
      const ci = teams.indexOf(t);
      $('sbName' + t).textContent = teamName(t);
      $('sbBadge' + t).style.background = `linear-gradient(90deg, ${cs[ci].c1} 50%, ${cs[ci].c2} 50%)`;
      const card = $('ab' + t);
      card.style.setProperty('--tc', cs[ci].c1);
      card.classList.toggle('hidden', hudIdx[t] < 0);
    }
    hud.ab = [null, null]; hud.slot = [[], []];
    $('ping').classList.toggle('hidden', !(m === 'host' || m === 'guest'));
    hud.score = [-1, -1];
    const L = (s, a) => I.label(s, a, 1);
    const hint = m === 'local'
      ? `P1: WASD • ${L('p1', 'kick')} şut • ${L('p1', 'sp')} koş • 1-2-3 yetenek • 5-8 emoji   |   P2: Oklar • ${L('p2', 'kick')} şut • ${L('p2', 'sp')} koş • ${L('p2', 'ab1')}-${L('p2', 'ab2')}-${L('p2', 'ab3')} yetenek`
      : `${I.label('solo', 'kick')}: basılı tut → BIRAK = şut • ${I.label('solo', 'sp')} koş • 1-2-3 yetenek (aynı anda bas = KOMBO) • 5-8 emoji • Esc menü`;
    const h = $('controlsHint'); h.textContent = hint; h.classList.remove('fade', 'hidden');
    clearTimeout(hintTimer); hintTimer = setTimeout(() => h.classList.add('fade'), 7000);
    let ser0 = null; try { ser0 = JSON.parse(sessionStorage.getItem(seriesKey())); } catch (e) {}
    const mapName = opts.map === 'langirt' ? ' Langırt sahasında' : '';
    const tn0 = teamName(0), tn1 = teamName(1), fmtN = cs.length > 2 ? ` ${cs.length / 2 | 0}v${Math.ceil(cs.length / 2)}` : '';
    spiker(ser0 && ser0[0] + ser0[1] > 0 ? `Seri ${ser0[0]}-${ser0[1]}! ${tn0} ile ${tn1} yine karşı karşıya!` : `Hoş geldiniz!${mapName}${fmtN} ${tn0} ile ${tn1} karşı karşıya!`, 3500, true);
    A.init(); A.crowdLevel(0.3);
  }

  // i: oyuncu, k: yuva -> tuş adı (karşı taraf ise boş)
  function slotKey(i, k) {
    const act = 'ab' + (k + 1);
    if (mode === 'local') return I.label(i === 0 ? 'p1' : 'p2', act, 1);
    if (i === me) return I.label('solo', act, 1);
    return '';
  }

  function hostStep() {
    let inputs;
    if (mode === 'local') inputs = [I.read('p1', 0), I.read('p2', 1)];
    else inputs = sim.players.map((_, i) => {
      if (bots[i]) return bots[i].think(sim, i);
      if (i === me) return I.read('solo', 0);
      const r = remotes.get(i); return r ? r.inp : TP.NO_INPUT;
    });
    if (mode === 'host') hostIns = inputs;
    sim.step(inputs);
    const evs = sim.events; sim.events = [];
    for (const e of evs) { e.tk = sim.tick; handleEvent(e, mode === 'attract'); }
    if (mode === 'host' && net) {
      if (evs.length) recentEv.push(...evs);
      if (recentEv.length) recentEv = recentEv.filter(e => e.tk > sim.tick - 40);
    }
    if (mode === 'attract' && (sim.score[0] + sim.score[1] >= 7 || sim.tick > 60 * 150)) startAttract();
  }

  // ---------- spiker ----------
  const LINES = {
    goal: ['{n} ağları sarsıyor!', 'GOOOL! {n} affetmedi!', 'Ne vuruş! {n} kaleciyi çaresiz bıraktı!', '{n} topu ağlara gömdü!', 'Tribünler ayakta! Gol {n}\'den!'],
    goalFast: ['{n} füze gibi vurdu, {k} km/sa!', 'Top ışık hızında! {n}, {k} km/sa!'],
    own: ['Eyvah! {o} kendi kalesine attı!', 'Talihsiz an! {o} topu kendi ağlarına gönderdi!'],
    post: ['Direk! {n} çok şanssız!', 'Direkten döndü! Nefesler tutuldu!', 'Tahta çıktı! {n} az kalsın…'],
    power: ['{n} sert vurdu!', 'Bomba gibi şut {n}\'den!', '{n} topu patlattı!'],
    burn: ['{v} alevlerin içinde kaldı!', 'Roket {v}\'yi yerle bir etti!'],
    tired: ['{n} nefes nefese kaldı!', '{n} çok yoruldu, biraz dinlenmeli.'],
    ab: { sok: '{n} şok dalgasıyla ortalığı dağıttı!', roket: '{n} roket şutu hazırlıyor!', falso: '{n} falsolu bir şey deneyecek…',
      buz: '{n} rakibini dondurdu!', isinlan: '{n} topun arkasına ışınlandı!', kalkan: '{n} kalesinin önüne duvar ördü!', eldiven: '{n} eldivenlerini giydi!',
      hayalet: '{n} hayalete dönüştü!', turbo: '{n} turboyu açtı!', ters: '{n} rakibinin beynini ters çevirdi!', bomba: '{n} topa bomba bağladı!',
      mayin: '{n} mayın döşüyor…', ruzgar: '{n} fırtına çıkardı!', cagir: '{n} topu sihirle çağırdı!', sis: 'Top kayboldu! {n} sis bıraktı!' },
    overtime: ['Süre bitti, eşitlik! Altın gol zamanı!'],
    dizzy: ['{n} yıldızları sayıyor!', '{n} sersemledi, kafası dönüyor!', 'Üç darbe, {n} yere serildi!'],
    burn2: ['{v} füzeyle uzaya gönderildi!', 'Roket {v}\'yi tribünlere uçurdu!', '{v} havada takla atıyor!'],
    intogoal: ['{v} kaleye gömüldü!', 'Topu değil {v}\'yi kaleye soktular!', 'Ağlarda bir oyuncu var: {v}!'],
    boom: ['BOOOM! Ortalık toz duman!', 'Bomba patladı, saha savaş alanı!'],
    mine: ['{v} mayına bastı!', 'Mayın tarlası! {v} havada!'],
    pickup: ['{n} enerjiyi kaptı: {a} yeniden hazır!'],
    perfect: ['MÜKEMMEL zamanlama! {n} topu ışınladı!', '{n} saniyesi saniyesine vurdu!'],
    chaos: { buz: 'Zemin buz tuttu! Kimse duramıyor!', devtop: 'Top devleşti! Kaleler daraldı sanki!', meteor: 'Gökten meteor yağıyor! Kırmızı halkalardan kaçın!', turbo: 'Herkese turbo! Hız sınırı yok!' },
    end: ['Ve maç bitti! {n} kazanıyor!', 'Son düdük! Zafer {n}\'nin!'],
  };
  const CHAOS = { buz: '🧊 BUZLU ZEMİN!', devtop: '⚽ DEV TOP!', meteor: '☄️ METEOR YAĞMURU!', turbo: '⚡ HERKESE TURBO!' };
  const pick = (a) => a[(Math.random() * a.length) | 0];
  function spiker(text, ms, force) {
    const el = $('spiker');
    if (!force && spiker.lock > performance.now()) return;
    $('spikerText').textContent = text; el.classList.add('show');
    spiker.lock = performance.now() + Math.min(ms || 2500, 1600);
    clearTimeout(spiker.tm); spiker.tm = setTimeout(() => el.classList.remove('show'), ms || 2500);
  }
  function fmtLine(s, d) { return s.replace(/\{(\w)\}/g, (_, k) => d[k] != null ? d[k] : ''); }

  // ---------- olaylar ----------
  function handleEvent(e, silent) {
    R.onEvent(e);
    if (silent) return;
    const nm = (t) => teamName(t);
    const pn = (e) => e.pi != null && e.pi >= 0 && matchChars && matchChars[e.pi] ? matchChars[e.pi].name : nm(e.team);
    switch (e.k) {
      case 'kick': A.kick(e.s); break;
      case 'curve': A.curve(); break;
      case 'power': A.power(e.s); if (Math.random() < 0.35) spiker(fmtLine(pick(LINES.power), { n: pn(e) })); break;
      case 'rocket': A.rocket(); break;
      case 'post': A.post(e.s); spiker(fmtLine(pick(LINES.post), { n: sim.lastToucher >= 0 && matchChars[sim.lastToucher] ? matchChars[sim.lastToucher].name : nm(sim.lastTouch >= 0 ? sim.lastTouch : 0) }), 2500, true); break;
      case 'wall': A.wall(e.s); break;
      case 'net': A.net(e.s); break;
      case 'bump': A.bump(e.s); break;
      case 'burn': A.burn(); A.boom(false); spiker(fmtLine(pick(LINES.burn2), { v: pn(e) }), 2800, true); break;
      case 'tired': spiker(fmtLine(pick(LINES.tired), { n: pn(e) })); break;
      case 'hit': A.hit(e.n); break;
      case 'dizzy': A.dizzy(); spiker(fmtLine(pick(LINES.dizzy), { n: pn(e) }), 2500, true); break;
      case 'tackle': A.tackle(); break;
      case 'smack': A.smack(e.s); break;
      case 'slam': A.slam(e.s); break;
      case 'intogoal': A.boom(false); spiker(fmtLine(pick(LINES.intogoal), { v: pn(e) }), 3000, true); break;
      case 'mine': A.boom(false); spiker(fmtLine(pick(LINES.mine), { v: pn(e) }), 2500, true); break;
      case 'boom': A.boom(true); spiker(pick(LINES.boom), 2500, true); break;
      case 'pickup': A.pickup(); spiker(e.a ? fmtLine(pick(LINES.pickup), { n: pn(e), a: TP.ABILITIES[e.a].icon + ' ' + TP.ABILITIES[e.a].name }) : fmtLine('{n} enerjiyi kaptı, koşu barı doldu!', { n: pn(e) })); break;
      case 'emote': A.pop(); break;
      case 'perfect': A.perfect(); spiker(fmtLine(pick(LINES.perfect), { n: pn(e) }), 2200, true); break;
      case 'bumper': A.bumper(); break;
      case 'meteor': A.boom(false); break;
      case 'chaos': A.chaos(); centerText(CHAOS[e.c] || 'KAOS!', 1600, true); spiker(LINES.chaos[e.c] || 'Kaos başladı!', 3000, true); break;
      case 'chaosend': spiker('Kaos sona erdi, düzen geri geldi.', 2000); break;
      case 'shieldhit': A.wall(6); break;
      case 'catch': A.wall(4); if (Math.random() < 0.5) spiker(fmtLine('{n} topu kucakladı!', { n: pn(e) })); break;
      case 'ab': A.ability(e.a); if (e.a === 'buz' && e.hit === 0) spiker(fmtLine('{n} ıskaladı, buz boşa gitti!', { n: pn(e) }));
        else if (LINES.ab[e.a]) spiker(fmtLine(LINES.ab[e.a], { n: pn(e) })); break;
      case 'whistle': A.whistle(false); centerText('BAŞLA!', 650, true); break;
      case 'goal': {
        A.goal(); slowT = 0.6; goalBanner(e); R.replayGoal();
        const k = Math.round(e.s * 10.8);
        const line = e.own ? pick(LINES.own) : k > 115 ? pick(LINES.goalFast) : pick(LINES.goal);
        spiker(fmtLine(line, { n: e.own ? nm(e.team) : pn(e), o: pn(e), k }), 3500, true);
        break;
      }
      case 'overtime': A.whistle(false); centerText('ALTIN GOL!', 2000, true); spiker(LINES.overtime[0], 3000, true); break;
      case 'end': A.whistle(true); A.end(); if (e.winner >= 0) spiker(fmtLine(pick(LINES.end), { n: nm(e.winner) }), 4000, true); setTimeout(showEnd, 1700); break;
    }
  }

  function centerText(str, ms, pop) {
    const el = $('centerText');
    el.textContent = str; el.classList.add('show');
    if (pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    clearTimeout(centerText.tm);
    if (ms) centerText.tm = setTimeout(() => el.classList.remove('show'), ms);
  }

  function goalBanner(e) {
    const cs = matchChars;
    const gb = $('goalBanner');
    gb.style.setProperty('--gcol', teamCol(e.team));
    const kmh = Math.round(e.s * 10.8);
    gb.querySelector('.gb-word').textContent = kmh > 110 ? 'GOOOOL!' : kmh > 80 ? 'GOOOL!' : 'GOOL!';
    const fire = sim.lastGoal && sim.lastGoal.fire;
    const who = e.pi >= 0 && cs[e.pi] ? cs[e.pi].name : teamName(e.team);
    let sub = e.own ? `${who} kendi kalesine!` : `${who}${fire ? ' • 🔥 ROKET GOL' : ''}`;
    sub += `  •  ${kmh} km/sa`;
    gb.querySelector('.gb-sub').textContent = sub;
    gb.classList.remove('show'); void gb.offsetWidth; gb.classList.add('show');
    const sc = $('sbScore' + e.team);
    sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
  }

  // ---------- HUD ----------
  const hud = { score: [-1, -1], time: '', cls: ['', ''], ab: [null, null], next: [null, null], st: [-1, -1] };
  function fmt(t) { t = Math.max(0, Math.ceil(t / 60)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }
  function updateHUD() {
    if (!sim || mode === 'attract') return;
    for (let i = 0; i < 2; i++) if (hud.score[i] !== sim.score[i]) { hud.score[i] = sim.score[i]; $('sbScore' + i).textContent = sim.score[i]; }
    let t;
    if (sim.overtime) t = 'ALTIN GOL';
    else if (sim.timeLeft < 0) t = fmt(sim.tick);
    else t = fmt(sim.timeLeft);
    if (t !== hud.time) { hud.time = t; const el = $('sbTime'); el.textContent = t; el.classList.toggle('ot', sim.overtime || (sim.timeLeft >= 0 && sim.timeLeft < 600)); }
    for (let c = 0; c < 2; c++) {
      const i = hudIdx[c];
      if (i < 0 || !sim.players[i]) continue;
      const p = sim.players[i];
      const card = $('ab' + c);
      const deckKey = (p.deck || []).join(',');
      const slots = card.querySelectorAll('.slot');
      if (hud.ab[i] !== deckKey) {
        hud.ab[i] = deckKey; hud.slot[i] = [];
        slots.forEach((el, k) => {
          const a = p.deck && p.deck[k], A_ = a && TP.ABILITIES[a];
          el.classList.toggle('hidden', !A_);
          if (!A_) return;
          el.querySelector('.s-icon').textContent = A_.icon;
          el.querySelector('.s-key').textContent = slotKey(i, k);
          el.title = A_.name;
        });
      }
      const armed = { roket: p.rocket > 0, falso: p.curve > 0, hayalet: p.ghost > 0, turbo: p.turbo > 0, eldiven: p.glove > 0 };
      slots.forEach((el, k) => {
        const a = p.deck && p.deck[k];
        if (!a) return;
        const cd = p.cd[k] || 0, mx = p.cdMax[k] || 1;
        const st = armed[a] ? 'armed' : cd > 0 ? 'cool' : 'ready';
        const sec = cd > 0 ? Math.ceil(cd / 60) : '';
        const key = st + sec;
        if (hud.slot[i][k] !== key) {
          hud.slot[i][k] = key;
          el.classList.remove('armed', 'cool', 'ready'); el.classList.add(st);
          el.querySelector('.s-cd').textContent = sec;
        }
        el.style.setProperty('--p', cd > 0 ? (1 - cd / mx) : 1);
      });
      const stv = Math.round(p.stamina * 100) + (p.exhausted ? 1000 : 0);
      if (hud.st[i] !== stv) {
        hud.st[i] = stv;
        const bar = card.querySelector('.ab-stam i');
        bar.style.width = (p.stamina * 100) + '%';
        bar.style.background = p.exhausted ? 'var(--red)' : p.stamina < 0.35 ? 'var(--yellow)' : 'var(--green)';
      }
    }
    if (sim.freeze > 0 && sim.phase === 'kickoff') {
      const el = $('centerText');
      if (!el.classList.contains('show') || el.textContent !== 'HAZIR') { el.textContent = 'HAZIR'; el.classList.add('show'); el.classList.remove('pop'); clearTimeout(centerText.tm); }
    }
    if (net && mode === 'guest') $('ping').textContent = `ping ${Math.round(net.rtt)} ms${net.via === 'relay' ? ' • sunucu' : net.via === 'lan' ? ' • yerel ağ' : ''}`;
    else if (net && mode === 'host') { const n = remotes.size; $('ping').textContent = n ? `oda sahibi • ${n} misafir` : 'oda sahibi'; }
  }

  // ---------- maç sonu ----------
  let endWinnerChar = null;
  // aynı iki oyuncu arasında seri skoru (sekme açık kaldıkça)
  function seriesKey() { return 'tp_series_' + (matchMode || mode) + '_' + matchChars.map(c => c.name).join('|'); }
  function bumpSeries(w) {
    let ser = [0, 0]; try { ser = JSON.parse(sessionStorage.getItem(seriesKey())) || [0, 0]; } catch (e) {}
    if (w >= 0) ser[w]++;
    try { sessionStorage.setItem(seriesKey(), JSON.stringify(ser)); } catch (e) {}
    return ser;
  }
  function showEnd() {
    if (endShown || !sim || sim.phase !== 'over') return;
    endShown = true;
    const cs = matchChars, w = sim.winner;
    let title;
    const myT = me >= 0 && mode !== 'local' ? matchTeams[me] : -1;
    if (w < 0) title = 'BERABERE';
    else if (myT >= 0) title = w === myT ? 'KAZANDIN! 🏆' : 'KAYBETTİN';
    else title = `${teamName(w).toLocaleUpperCase('tr')} KAZANDI! 🏆`;
    $('endTitle').textContent = title;
    $('endScore').innerHTML = `<span style="color:${teamCol(0)}">${sim.score[0]}</span> - <span style="color:${teamCol(1)}">${sim.score[1]}</span>`;
    const st = sim.stats;
    const pt = st.poss[0] + st.poss[1] || 1;
    const rows = [
      ['Şut', st.kicks[0], st.kicks[1]],
      ['Sert şut', st.power[0], st.power[1]],
      ['Top hakimiyeti', Math.round(st.poss[0] / pt * 100) + '%', Math.round(st.poss[1] / pt * 100) + '%'],
      ['Yetenek', st.abil[0], st.abil[1]],
      ['En sert şut', (st.fast ? st.fast[0] : 0) + ' km/sa', (st.fast ? st.fast[1] : 0) + ' km/sa'],
      ['Sersemletme', st.dizzy ? st.dizzy[0] : 0, st.dizzy ? st.dizzy[1] : 0],
    ];
    $('endStats').innerHTML = `<tr><td style="color:${teamCol(0)}">${esc(teamName(0))}</td><td></td><td style="color:${teamCol(1)}">${esc(teamName(1))}</td></tr>` +
      rows.map(r => `<tr><td>${r[1]}</td><td>${r[0]}</td><td>${r[2]}</td></tr>`).join('');
    endWinnerChar = cs[Math.max(0, matchTeams.indexOf(w >= 0 ? w : 0))];
    const ser = bumpSeries(w);
    $('endNote').innerHTML = `<div class="series">SERİ <span style="color:${teamCol(0)}">${ser[0]}</span> – <span style="color:${teamCol(1)}">${ser[1]}</span></div>` + (mode === 'guest' ? '<br>Oda sahibi yeni maçı başlatınca devam edersin.' : '');
    $('lobbyBtn').classList.toggle('hidden', mode !== 'host');
    $('rematchBtn').textContent = mode === 'guest' ? '🔁 Rövanş iste' : '🔁 Rövanş';
    $('endMenuBtn').textContent = mode === 'host' ? 'Odayı Kapat' : mode === 'guest' ? 'Odadan Çık' : 'Menü';
    show('endScreen');
  }

  function rematch() {
    A.uiOk();
    if (mode === 'bot' || mode === 'local') beginOffline(mode);
    else if (mode === 'host') hostBeginDraft();
    else if (mode === 'guest' && net) { net.send({ t: 'rematch' }); toast('Rövanş isteği oda sahibine gönderildi'); }
  }

  function quitToMenu() {
    netPaused = false; hideNetBanner();
    if (net) { net.close(); net = null; }
    draft = null; lobby = null; guestLobby = null; playing = null; joining = false;
    startAttract();
    show('menu');
  }

  // ---------- duraklatma ----------
  function openPause() {
    if (mode === 'attract' || endShown) return;
    const online = mode === 'host' || mode === 'guest';
    if (!online) paused = true;
    $('pauseTitle').textContent = online ? 'Menü (maç devam ediyor)' : 'Duraklatıldı';
    $('restartBtn').classList.toggle('hidden', mode === 'guest');
    $('quitBtn').textContent = mode === 'host' ? 'Odayı Kapat' : online ? 'Odadan Çık' : 'Menüye Dön';
    show('pause');
  }
  function closePause() { paused = false; $('pause').classList.add('hidden'); }
  window.addEventListener('keydown', (e) => {
    A.init();
    if (e.code === 'Escape') {
      if (visible('pause')) closePause();
      else if (mode !== 'attract' && !visible('endScreen') && !visible('draft')) openPause();
    }
  });
  window.addEventListener('pointerdown', () => A.init());
  $('resumeBtn').onclick = () => { A.ui(); closePause(); };
  $('restartBtn').onclick = () => { A.ui(); if (mode === 'host') hostBeginDraft(); else startMatch(mode, matchChars, matchOpts, sim.players.map(p => p.deck), matchEx); };
  $('quitBtn').onclick = () => { A.ui(); quitToMenu(); };
  $('rematchBtn').onclick = rematch;
  $('endMenuBtn').onclick = () => { A.ui(); quitToMenu(); };
  $('lobbyBtn').onclick = () => { A.ui(); hostBackToLobby(); };

  // ---------- menü ----------
  function refreshMenu() {
    $('menuCharName').textContent = chars[0].name;
    for (const b of $('botLevel').children) b.classList.toggle('on', b.dataset.v === settings.bot);
    for (const b of $('botSize').children) b.classList.toggle('on', +b.dataset.n === (settings.botSize || 1));
    $('botSub').textContent = (settings.botSize || 1) > 1 ? `${settings.botSize}v${settings.botSize} · bot takım arkadaşlarınla` : 'Isın, şutunu çalış';
    $('setTime').value = String(settings.time);
    $('setGoals').value = String(settings.goals);
    $('setTheme').value = settings.theme;
    $('setExtra').value = settings.extra;
    $('muteBtn').textContent = A.muted ? '🔇 Ses kapalı' : '🔊 Ses açık';
  }
  $('botSize').onclick = (e) => { const n = +e.target.dataset.n; if (!n) return; settings.botSize = n; save('tp_settings', settings); A.ui(); refreshMenu(); };
  $('botLevel').onclick = (e) => { const v = e.target.dataset.v; if (!v) return; settings.bot = v; save('tp_settings', settings); A.ui(); refreshMenu(); };
  $('setTime').onchange = (e) => { settings.time = +e.target.value; save('tp_settings', settings); };
  $('setGoals').onchange = (e) => { settings.goals = +e.target.value; save('tp_settings', settings); };
  $('setTheme').onchange = (e) => { settings.theme = e.target.value; save('tp_settings', settings); };
  $('setExtra').onchange = (e) => { settings.extra = e.target.value; save('tp_settings', settings); };
  $('muteBtn').onclick = () => { A.init(); A.toggleMute(); refreshMenu(); };

  function beginOffline(m) {
    const opts = { time: settings.time, goals: settings.goals, theme: pickTheme(), map: pickMap(), chaos: pickChaos() };
    if (m === 'bot') {
      const n = settings.botSize || 1;
      const cs = [chars[0]], teams = [0], botIdx = [];
      for (let k = 1; k < n * 2; k++) { cs.push(botChar(k)); teams.push(k < n ? 0 : 1); botIdx.push(k); }
      openDraft([{ idx: 0, ch: chars[0], slot: 0 }], (decks) => startMatch('bot', cs, opts, cs.map((_, i) => i === 0 ? decks[0] : TP.randomDeck()), { teams, me: 0, botIdx }));
    } else {
      const cs = [chars[0], chars[1]];
      openDraft([{ idx: 0, ch: chars[0], slot: 0 }, { idx: 1, ch: chars[1], slot: 1 }], (decks) => startMatch('local', cs, opts, decks));
    }
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    A.init(); A.ui();
    const g = go.dataset.go;
    if (g === 'bot') { mode = 'attract'; beginOffline('bot'); }
    else if (g === 'local') { mode = 'attract'; beginOffline('local'); }
    else if (g === 'online') openOnline();
    else if (g === 'creator') openCreator(0);
    else if (g === 'help') { fillHelp(); show('help'); }
    else if (g === 'keys') { buildKeys(); show('keys'); }
    else if (g === 'taunts') { buildTauntEdit(); show('taunts'); }
    else if (g === 'menu') { I.cancelCapture(); show('menu'); }
  });

  function fillHelp() {
    $('helpAbs').innerHTML = TP.ABILITY_KEYS.map(k => { const a = TP.ABILITIES[k]; return `<div><b>${a.icon} ${a.name} <span class="muted">(${a.cd} sn)</span></b>${a.desc}</div>`; }).join('');
    const row = (lbl, s) => `<tr><td>${lbl}</td><td>${I.label(s, 'up', 1)}${I.label(s, 'left', 1)}${I.label(s, 'down', 1)}${I.label(s, 'right', 1)}</td><td>${I.label(s, 'kick')}</td><td>${I.label(s, 'sp')}</td><td>${I.label(s, 'ab1', 1)} ${I.label(s, 'ab2', 1)} ${I.label(s, 'ab3', 1)}</td></tr>`;
    $('helpKeys').innerHTML = '<tr><th></th><th>Hareket</th><th>Şut</th><th>Koş</th><th>Yetenek</th></tr>' +
      row('Tek / Online', 'solo') + row('Aynı klavye P1', 'p1') + row('Aynı klavye P2', 'p2') +
      '<tr><td>Gamepad</td><td>Sol çubuk</td><td>A / RT</td><td>RB / LT</td><td>B X Y</td></tr>';
  }

  // ---------- tuş ayarları ----------
  let keyScheme = 'solo';
  function buildKeys() {
    for (const b of $('keyTabs').children) b.classList.toggle('on', b.dataset.s === keyScheme);
    $('keyList').innerHTML = I.ACTIONS.map(a => `<div class="krow"><span>${a.name}</span><button class="kbtn" data-a="${a.id}">${esc(I.label(keyScheme, a.id, 3))}</button></div>`).join('');
  }
  $('keyTabs').onclick = (e) => { const s = e.target.dataset.s; if (!s) return; I.cancelCapture(); keyScheme = s; A.ui(); buildKeys(); };
  $('keyList').onclick = (e) => {
    const b = e.target.closest('.kbtn'); if (!b) return;
    buildKeys();
    const btn = $('keyList').querySelector(`[data-a="${b.dataset.a}"]`);
    btn.classList.add('wait'); btn.textContent = 'Bir tuşa bas…';
    I.capture((code) => { if (code !== 'Escape') { I.setBind(keyScheme, b.dataset.a, code); A.uiOk(); } buildKeys(); });
  };
  $('keyReset').onclick = () => { I.resetBinds(keyScheme); A.ui(); buildKeys(); };

  // ---------- karakter çizimi (önizlemeler) ----------
  function fitCanvas(cv) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (w > 0 && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
  }
  const blinkState = new Map();
  function drawChar(cv, ch, opt) {
    opt = opt || {};
    fitCanvas(cv);
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const r = cv.width * (opt.scale || 0.3);
    const t = performance.now() / 16.67;
    let look = opt.look;
    if (look == null) {
      const rect = cv.getBoundingClientRect();
      look = Math.atan2(mouse.y - (rect.top + rect.height / 2), mouse.x - (rect.left + rect.width / 2));
    }
    let bs = blinkState.get(cv); if (!bs) { bs = { t: 60 + Math.random() * 200 }; blinkState.set(cv, bs); }
    bs.t -= 1; if (bs.t < -7) bs.t = 120 + Math.random() * 220;
    const bob = opt.still ? 0 : Math.abs(Math.sin(t * 0.06)) * r * 0.06;
    ctx.translate(cv.width / 2, cv.height / 2 + r * 0.12);
    if (!opt.noShadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(r * 0.1, r * 0.95, r * 0.9 * (1 - bob / r), r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.translate(0, -bob);
    TP.drawPlayerBody(ctx, { r }, ch, { look, blink: !opt.still && bs.t < 0, kickReady: !!opt.ring, t, mood: opt.mood, feet: opt.noFeet ? false : null });
  }

  // ---------- karakter oluşturucu ----------
  let editIdx = 0;
  function openCreator(i) { editIdx = i; show('creator'); buildCreator(); }
  function chipsHTML(list, cur, attr) { return list.map(p => `<button class="chip ${cur === p.id ? 'on' : ''}" data-${attr}="${p.id}"><canvas width="92" height="92"></canvas>${p.name}</button>`).join(''); }
  function buildCreator() {
    const ch = chars[editIdx];
    for (const b of $('creatorTabs').children) b.classList.toggle('on', +b.dataset.i === editIdx);
    $('cName').value = ch.name; $('cNum').value = ch.number;
    buildSwatches('sw1', 'c1', TP.SWATCHES); buildSwatches('sw2', 'c2', TP.SWATCHES); buildSwatches('swH', 'hairColor', TP.HAIR_COLORS);
    $('patterns').innerHTML = chipsHTML(TP.PATTERNS, ch.pattern, 'p');
    $('eyes').innerHTML = chipsHTML(TP.EYES, ch.eyes, 'e');
    $('hairs').innerHTML = chipsHTML(TP.HAIRS, ch.hair, 'h');
    $('accs').innerHTML = chipsHTML(TP.ACCS, ch.acc, 'c');
    drawChips();
  }
  function drawChips() {
    const ch = chars[editIdx];
    const o = { look: 0.6, still: true, noShadow: true, scale: 0.34, noFeet: true };
    $('patterns').querySelectorAll('.chip').forEach(el => drawChar(el.querySelector('canvas'), Object.assign({}, ch, { pattern: el.dataset.p }), o));
    $('eyes').querySelectorAll('.chip').forEach(el => drawChar(el.querySelector('canvas'), Object.assign({}, ch, { eyes: el.dataset.e }), o));
    $('hairs').querySelectorAll('.chip').forEach(el => drawChar(el.querySelector('canvas'), Object.assign({}, ch, { hair: el.dataset.h }), o));
    $('accs').querySelectorAll('.chip').forEach(el => drawChar(el.querySelector('canvas'), Object.assign({}, ch, { acc: el.dataset.c }), o));
  }
  function buildSwatches(id, key, list) {
    const ch = chars[editIdx];
    const el = $(id);
    el.innerHTML = list.map(c => `<button class="swatch ${ch[key] === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('') +
      `<label class="swatch custom ${list.includes(ch[key]) ? '' : 'on'}" title="Özel renk"><input type="color" value="${ch[key]}"></label>`;
    el.onclick = (e) => { const c = e.target.dataset && e.target.dataset.c; if (!c) return; ch[key] = c; A.ui(); buildSwatches(id, key, list); drawChips(); };
    el.querySelector('input').oninput = (e) => { ch[key] = e.target.value; drawChips(); el.querySelectorAll('.swatch').forEach(s => s.classList.remove('on')); el.querySelector('.custom').classList.add('on'); };
  }
  $('creatorTabs').onclick = (e) => { const i = e.target.dataset.i; if (i == null) return; A.ui(); editIdx = +i; buildCreator(); };
  $('cName').oninput = (e) => { chars[editIdx].name = e.target.value.slice(0, 14) || 'Oyuncu'; };
  $('cNum').oninput = (e) => { chars[editIdx].number = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0)); drawChips(); };
  const chipHandler = (id, key, attr) => { $(id).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; chars[editIdx][key] = b.dataset[attr]; A.ui(); buildCreator(); }; };
  chipHandler('patterns', 'pattern', 'p'); chipHandler('eyes', 'eyes', 'e'); chipHandler('hairs', 'hair', 'h'); chipHandler('accs', 'acc', 'c');
  $('randomBtn').onclick = () => { const r = TP.randomChar(chars[editIdx].name); r.number = chars[editIdx].number; chars[editIdx] = r; A.uiOk(); buildCreator(); };
  $('creatorDone').onclick = () => {
    chars = chars.map((c, i) => TP.sanitizeChar(c, i));
    save('tp_chars', chars); A.uiOk();
    if (net && lobby) { const h = lobby.members.find(m => m.id === 'host'); if (h) h.ch = chars[0]; show('lobbyScreen'); pushLobby(); }
    else if (net && net.role === 'guest') { net.send({ t: 'hello', ch: chars[0] }); show('lobbyScreen'); }
    else show('menu');
  };

  // ---------- KART SEÇİMİ ----------
  const CARD_COLORS = { roket: ['#ff7b00', '#7a1e00'], falso: ['#9b5de5', '#3c1a6e'], sok: ['#f8f9fa', '#5c677d'],
    buz: ['#a2d2ff', '#1d4e89'], isinlan: ['#e0c3ff', '#5a189a'], kalkan: ['#ffd23f', '#7a5c00'], eldiven: ['#ffe08a', '#8a5a00'],
    hayalet: ['#dfe7fd', '#4a4e69'], turbo: ['#ffd23f', '#b5179e'], ters: ['#ff5d8f', '#590d22'], bomba: ['#555', '#111'],
    mayin: ['#e85d04', '#370617'], ruzgar: ['#cfe8ff', '#277da1'], cagir: ['#c77dff', '#240046'], sis: ['#adb5bd', '#343a40'] };
  let draft = null;
  // players: [{idx, ch, slot}], online: true ise süre sınırı ve bekleme
  function openDraft(players, onDone, online) {
    draft = { players, k: 0, decks: [null, null], onDone, online, sel: [] };
    draftFor(0);
  }
  function draftFor(k) {
    const pl = draft.players[k];
    draft.k = k;
    const prev = load('tp_deck' + pl.slot, []);
    draft.sel = Array.isArray(prev) ? prev.filter(a => TP.ABILITIES[a]).slice(0, TP.DECK_SIZE) : [];
    draft.ch = pl.ch;
    $('draftWho').textContent = draft.players.length > 1 ? `${pl.ch.name} seçiyor (${k + 1}/${draft.players.length})` : pl.ch.name;
    $('draftCards').innerHTML = TP.ABILITY_KEYS.map((a, i) => {
      const A_ = TP.ABILITIES[a], c = CARD_COLORS[a] || ['#2b3748', '#18202b'];
      return `<button class="acard" data-a="${a}" style="--ca:${c[0]};--cb:${c[1]};animation-delay:${i * 45}ms"><div class="badge"></div><div class="art">${A_.icon}</div>
        <div class="body"><div class="nm">${A_.name}</div><div class="cdv">⏱ ${A_.cd} sn bekleme</div><div class="ds">${A_.desc}</div></div></button>`;
    }).join('');
    $('draftWait').classList.add('hidden');
    $('draftCards').classList.remove('hidden'); $('draftRandom').disabled = false;
    refreshDraft();
    show('draft');
    clearInterval(draft.timer);
    $('draftTimer').classList.toggle('hidden', !draft.online);
    if (draft.online) {
      let left = 30; $('draftTimer').textContent = left;
      draft.timer = setInterval(() => {
        left--; $('draftTimer').textContent = left;
        if (left <= 5 && left > 0) A.tick();
        if (left <= 0) { clearInterval(draft.timer); fillRandom(); confirmDraft(); }
      }, 1000);
    }
  }
  function refreshDraft() {
    const sel = draft.sel;
    $('draftCards').querySelectorAll('.acard').forEach(el => {
      const i = sel.indexOf(el.dataset.a);
      el.classList.toggle('on', i >= 0);
      el.classList.toggle('dim', i < 0 && sel.length >= TP.DECK_SIZE);
      el.querySelector('.badge').textContent = i >= 0 ? i + 1 : '';
      el.title = i >= 0 ? `Maçta ${i + 1} tuşu` : '';
    });
    let h = '';
    for (let i = 0; i < TP.DECK_SIZE; i++) h += sel[i] ? `<span class="f">${TP.ABILITIES[sel[i]].icon}</span>` : '<span>?</span>';
    $('draftPicked').innerHTML = h;
    $('draftOk').disabled = sel.length !== TP.DECK_SIZE;
  }
  function fillRandom() {
    const pool = TP.ABILITY_KEYS.filter(a => !draft.sel.includes(a)).sort(() => Math.random() - 0.5);
    while (draft.sel.length < TP.DECK_SIZE) draft.sel.push(pool.shift());
  }
  $('draftCards').onclick = (e) => {
    const c = e.target.closest('.acard'); if (!c || !draft) return;
    const a = c.dataset.a, i = draft.sel.indexOf(a);
    if (i >= 0) { draft.sel.splice(i, 1); A.ui(); }
    else if (draft.sel.length < TP.DECK_SIZE) { draft.sel.push(a); A.ability(a); }
    else { draft.sel[TP.DECK_SIZE - 1] = a; A.ability(a); }
    refreshDraft();
  };
  $('draftRandom').onclick = () => { if (!draft) return; draft.sel = []; fillRandom(); A.uiOk(); refreshDraft(); };
  $('draftOk').onclick = () => confirmDraft();
  function confirmDraft() {
    if (!draft || draft.sel.length !== TP.DECK_SIZE) return;
    clearInterval(draft.timer);
    const pl = draft.players[draft.k];
    draft.decks[pl.idx] = draft.sel.slice();
    save('tp_deck' + pl.slot, draft.sel);
    A.uiOk();
    if (draft.k + 1 < draft.players.length) { draftFor(draft.k + 1); return; }
    const d = draft; draft = d.online ? d : null;
    if (d.online) {
      $('draftCards').classList.add('hidden'); $('draftWait').classList.remove('hidden');
      $('draftOk').disabled = true; $('draftRandom').disabled = true; $('draftTimer').classList.add('hidden');
    }
    d.onDone(d.decks);
  }

  // =====================================================================
  //  ONLINE — oda sahibinin tarayıcısı sunucudur, herkes ona bağlanır
  // =====================================================================
  // lobby: { code, size, gen, members: [{ id, kind:'host'|'guest'|'bot', ch, team }] }
  let lobby = null, guestLobby = null, idxOf = new Map(), playing = null, myGen = 0, syncAsk = 0, joining = false;
  const inviteURL = (code) => location.origin + location.pathname + '?oda=' + code;
  const teamCount = (t) => lobby.members.filter(m => m.team === t).length;
  function freeTeam(prefer) {
    if (prefer != null && prefer >= 0 && teamCount(prefer) < lobby.size) return prefer;
    const a = teamCount(0), b = teamCount(1);
    if (a < lobby.size && (a <= b || b >= lobby.size)) return 0;
    if (b < lobby.size) return 1;
    return -1;
  }
  function fitSize() {
    for (const t of [0, 1]) while (teamCount(t) > lobby.size) {
      const list = lobby.members.filter(m => m.team === t);
      const b = list.slice().reverse().find(m => m.kind === 'bot');
      if (b) { lobby.members.splice(lobby.members.indexOf(b), 1); continue; }
      const g = list.slice().reverse().find(m => m.kind === 'guest') || list[list.length - 1];
      const ft = freeTeam(1 - t); g.team = ft === 1 - t ? ft : -1;
    }
  }
  function lobbyState() {
    return {
      code: lobby.code, size: lobby.size, playing: !!playing, gen: lobby.gen,
      time: settings.time, goals: settings.goals, extra: settings.extra,
      members: lobby.members.map(m => ({ id: m.id, kind: m.kind, team: m.team, ch: m.ch, ping: m.kind === 'guest' && net && net.rtt ? (typeof net.rtt === 'function' ? net.rtt(m.id) : 0) : 0, via: m.kind === 'guest' && net && typeof net.via === 'function' ? net.via(m.id) : '' })),
    };
  }
  function pushLobby() {
    if (!lobby || !net) return;
    const st = lobbyState();
    for (const m of lobby.members) if (m.kind === 'guest') net.send(m.id, { t: 'lobby', st, you: m.id });
    if (!playing && mode !== 'host') renderLobby(st, 'host', true);
  }
  function lobbyErr(msg) { const el = $('lbError'); el.textContent = msg; el.classList.toggle('hidden', !msg); }

  function openOnline(code) {
    if (!TP.Net.available()) { toast('Online kütüphanesi yüklenemedi — internet bağlantını kontrol et.', 3500); return; }
    show('online');
    $('onlineError').classList.add('hidden'); $('onlineStatusBox').classList.add('hidden');
    for (const b of $('hostSize').children) b.classList.toggle('on', +b.dataset.n === (settings.size || 1));
    if (code) { $('joinCode').value = code; doJoin(); }
    else if (TP.Net.LAN) startRoomPoll();
  }
  // yerel ağdaki açık odalar
  let roomPoll = null;
  function startRoomPoll() {
    stopRoomPoll();
    const tick = () => TP.Net.lanRooms((list) => {
      const el = $('lanRooms');
      if (!list) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      el.innerHTML = list.length
        ? '<div class="rooms-h">Açık odalar</div>' + list.map(r => `<button class="btn small room" data-code="${r.code}">⚽ ${esc(r.name)} <span class="muted">${r.n || 1} kişi</span> <b>${r.code}</b></button>`).join('')
        : '<div class="rooms-h">Henüz açık oda yok…</div>';
    });
    tick(); roomPoll = setInterval(() => { if (visible('online')) tick(); }, 2000);
  }
  function stopRoomPoll() { clearInterval(roomPoll); roomPoll = null; }
  $('lanRooms').onclick = (e) => { const b = e.target.closest('.room'); if (!b) return; $('joinCode').value = b.dataset.code; doJoin(); };
  function onlineErr(msg) { const el = $('onlineError'); el.textContent = msg; el.classList.remove('hidden'); $('onlineStatusBox').classList.add('hidden'); }
  function onlineStatus(msg) { $('onlineStatusBox').classList.remove('hidden'); $('onlineStatus').textContent = msg; }
  $('hostSize').onclick = (e) => { const n = +e.target.dataset.n; if (!n) return; settings.size = n; save('tp_settings', settings); A.ui(); for (const b of $('hostSize').children) b.classList.toggle('on', +b.dataset.n === n); };

  // ---------- ODA SAHİBİ ----------
  function doHost() {
    A.init(); stopRoomPoll();
    if (net) net.close();
    lobby = { code: '…', size: settings.size || 1, gen: 0, members: [{ id: 'host', kind: 'host', ch: chars[0], team: 0 }] };
    playing = null; guestLobby = null;
    renderLobby(lobbyState(), 'host', true);
    show('lobbyScreen'); lobbyErr('');
    $('lbInfo').textContent = 'Oda kuruluyor…';
    const n = net = TP.Net.host(chars[0].name);
    n.on('code', (code) => { if (net !== n) return; lobby.code = code; $('lbInfo').textContent = 'Linki gönder, arkadaşların gelsin.'; pushLobby(); });
    n.on('error', (msg) => { if (net === n) { lobbyErr(msg); toast(msg, 4000); } });
    n.on('join', () => {});
    n.on('leave', (gid) => hostGuestLeft(gid));
    n.on('msg', (gid, m) => hostMsg(gid, m));
    n.on('paused', () => showNetBanner('Bağlantı koptu, yeniden bağlanılıyor…'));
    n.on('resumed', () => { hideNetBanner(); });
    n.on('lost', () => { if (net !== n) return; net = null; toast('Oda sunucusuyla bağlantı kurtarılamadı 😕', 4000); quitToMenu(); });
    clearInterval(doHost.t); doHost.t = setInterval(() => { if (net === n && lobby) pushLobby(); else clearInterval(doHost.t); }, 2000);
  }
  function hostGuestLeft(gid) {
    if (!lobby) return;
    const m = lobby.members.find(x => x.id === gid);
    if (!m) return;
    toast(`${m.ch.name} ayrıldı.`, 3000);
    lobby.members.splice(lobby.members.indexOf(m), 1);
    if (idxOf.has(gid)) {
      const i = idxOf.get(gid); idxOf.delete(gid); remotes.delete(i);
      if (mode === 'host' && sim && sim.players[i]) bots[i] = new TP.Bot('orta'); // yerine bot geçer
      if (draft && draft.online && onlineDecks[i] == null) { onlineDecks[i] = TP.randomDeck(); tryHostStart(); }
    }
    pushLobby();
  }
  function hostMsg(gid, m) {
    if (!lobby || !m || typeof m !== 'object') return;
    const mem = lobby.members.find(x => x.id === gid);
    switch (m.t) {
      case 'hello': {
        const ch = TP.sanitizeChar(m.ch, 1);
        if (mem) { mem.ch = ch; pushLobby(); return; }
        let team = playing ? -1 : freeTeam();
        if (team < 0 && !playing) { const b = lobby.members.find(x => x.kind === 'bot'); if (b) { team = b.team; lobby.members.splice(lobby.members.indexOf(b), 1); } }
        lobby.members.push({ id: gid, kind: 'guest', ch, team });
        toast(`${ch.name} odaya katıldı!`, 2500); A.uiOk();
        pushLobby();
        if (playing && playing.msg && (mode === 'host')) net.send(gid, Object.assign({ t: 'start', you: -1 }, playing.msg));
        return;
      }
      case 'team':
        if (!mem || playing) return;
        if (m.team === -1) mem.team = -1; else if (m.team !== mem.team && teamCount(m.team) < lobby.size) mem.team = m.team;
        pushLobby(); return;
      case 'sync':
        if (!mem) return;
        if (playing && playing.msg && mode === 'host') net.send(gid, Object.assign({ t: 'start', you: idxOf.has(gid) ? idxOf.get(gid) : -1 }, playing.msg));
        else if (playing && draft && idxOf.has(gid) && onlineDecks[idxOf.get(gid)] == null) net.send(gid, { t: 'draft', gen: lobby.gen });
        else if (!playing) net.send(gid, { t: 'tolobby', gen: lobby.gen });
        return;
      case 'deck': {
        if (!idxOf.has(gid) || !Array.isArray(m.deck)) return;
        const i = idxOf.get(gid);
        let d = m.deck.filter(a => TP.ABILITIES[a]).slice(0, TP.DECK_SIZE);
        if (d.length < 1) d = TP.randomDeck();
        onlineDecks[i] = d; tryHostStart(); return;
      }
      case 'say':
        if (!idxOf.has(gid) || typeof m.text !== 'string') return;
        { const pi = idxOf.get(gid), text = m.text.slice(0, 48); if (mode === 'host') { R.say(pi, text); A.pop(); } net.broadcast({ t: 'say', pi, text }); }
        return;
      case 'rematch':
        if (sim && (sim.phase === 'over' || endShown) && mode === 'host') toast(`${mem ? mem.ch.name : 'Biri'} rövanş istiyor!`, 3000);
        return;
      case 'i': {
        if (!idxOf.has(gid)) return;
        const i = idxOf.get(gid);
        let r = remotes.get(i); if (!r) { r = { inp: TP.NO_INPUT, q: 0, at: 0, gid }; remotes.set(i, r); }
        r.at = performance.now();
        const lan = typeof net.via === 'function' ? net.via(gid) === 'lan' : net.via === 'lan';
        // yerel ağda (TCP) mesajlar sıralı gelir; doğrudan/aktarmada eskileri ele
        if (lan || m.q > r.q || m.q < r.q - 30) { r.q = m.q; r.inp = { x: +m.x || 0, y: +m.y || 0, kick: !!m.k, ab: (+m.a | 0) & 7, sp: !!m.p, emo: (+m.e | 0) % 5 }; }
        return;
      }
    }
  }
  // maç kadrosu: takım 0 sonra takım 1; boş yerleri bot doldurur
  function buildLineup() {
    const cs = [], teams = [], ids = [], botIdx = [];
    let bk = 0;
    for (const t of [0, 1]) {
      const list = lobby.members.filter(m => m.team === t);
      for (const m of list) { ids.push(m.id); cs.push(m.ch); teams.push(t); if (m.kind === 'bot') botIdx.push(cs.length - 1); }
      for (let k = list.length; k < lobby.size; k++) { const b = botChar(bk++); ids.push('fill' + bk); cs.push(b); teams.push(t); botIdx.push(cs.length - 1); }
    }
    return { cs, teams, ids, botIdx };
  }
  function botChar(k) {
    const names = ['Robo', 'Çelik', 'Vınn', 'Tornado', 'Pervane', 'Pistonlu', 'Zıpzıp'];
    const c = TP.randomChar(names[(k + ((Math.random() * 7) | 0)) % names.length]); c.name = 'BOT ' + c.name; return c;
  }
  function hostBeginDraft() {
    if (!net || !lobby) return;
    const L = buildLineup();
    idxOf = new Map(); L.ids.forEach((id, i) => idxOf.set(id, i));
    lobby.gen++;
    playing = { lineup: L, msg: null };
    onlineDecks = L.cs.map((_, i) => L.botIdx.includes(i) ? TP.randomDeck() : null);
    remotes = new Map();
    mode = 'attract'; startAttract();
    for (const m of lobby.members) if (m.kind === 'guest') net.send(m.id, idxOf.has(m.id) ? { t: 'draft', gen: lobby.gen } : { t: 'wait', gen: lobby.gen });
    pushLobby();
    openDraft([{ idx: idxOf.get('host'), ch: chars[0], slot: 0 }], (decks) => { onlineDecks[idxOf.get('host')] = decks[idxOf.get('host')]; tryHostStart(); }, true);
    // bir misafir kartını hiç yollamazsa 40 sn sonra rastgele kart verilir
    clearTimeout(hostBeginDraft.t);
    const gen = lobby.gen;
    hostBeginDraft.t = setTimeout(() => { if (lobby && lobby.gen === gen && playing && !playing.msg) { onlineDecks = onlineDecks.map(d => d || TP.randomDeck()); tryHostStart(); } }, 40000);
  }
  function tryHostStart() {
    if (!net || !playing || playing.msg || onlineDecks.some(d => !d)) return;
    clearTimeout(hostBeginDraft.t);
    matchId++;
    draft = null;
    const L = playing.lineup;
    const cs = teamKits(L.cs, L.teams);
    const opts = { time: settings.time, goals: settings.goals, theme: pickTheme(), map: pickMap(), chaos: pickChaos() };
    const decks = onlineDecks.slice();
    playing.msg = { id: matchId, chars: cs, opts, decks, teams: L.teams, gen: lobby.gen };
    for (const m of lobby.members) if (m.kind === 'guest') net.send(m.id, Object.assign({ t: 'start', you: idxOf.has(m.id) ? idxOf.get(m.id) : -1 }, playing.msg));
    startMatch('host', cs, opts, decks, { teams: L.teams, me: idxOf.get('host'), botIdx: L.botIdx, botLevel: 'orta' });
    pushLobby();
  }
  function hostBackToLobby() {
    playing = null; draft = null;
    for (const m of lobby.members) if (m.team < 0 && m.kind === 'guest') { const t = freeTeam(); if (t >= 0) m.team = t; }
    mode = 'attract'; startAttract();
    net && net.broadcast({ t: 'tolobby', gen: lobby.gen });
    show('lobbyScreen');
    pushLobby();
  }

  // ---------- MİSAFİR ----------
  function doJoin() {
    A.init();
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length < 5) { onlineErr('Kod 5 karakter olmalı.'); return; }
    if (net) net.close();
    lobby = null; guestLobby = null; myGen = 0; joining = true;
    $('onlineError').classList.add('hidden');
    onlineStatus(`${code} odasına bağlanılıyor…`);
    const n = net = TP.Net.join(code);
    n.on('error', (m) => { if (net === n) { onlineErr(m); joining = false; } });
    n.on('status', (m) => { if (net === n) onlineStatus(m); });
    n.on('connected', (via) => { if (net !== n) return; stopRoomPoll(); onlineStatus(via === 'relay' ? 'Bağlandı (sunucu üzerinden)! Lobiye giriliyor…' : 'Bağlandı! Lobiye giriliyor…'); n.send({ t: 'hello', ch: chars[0] }); A.uiOk(); });
    n.on('lost', () => {
      if (net !== n) return;
      netPaused = false; hideNetBanner();
      toast('Oda kapandı ya da bağlantı koptu 😕', 4000);
      net = null; draft = null; guestLobby = null;
      startAttract(); show('menu');
    });
    n.on('paused', (who) => { netPaused = true; showNetBanner(who === 'self' ? 'Bağlantı koptu, yeniden bağlanılıyor…' : 'Oda sahibinin bağlantısı koptu, bekleniyor…'); });
    n.on('resumed', () => { netPaused = false; hideNetBanner(); });
    n.on('msg', (m) => { if (net === n) guestMsg(m); });
  }
  function guestMsg(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'lobby': {
        guestLobby = { st: m.st, you: m.you };
        const g = m.st.gen || 0;
        // kendini onarma: kaçan 'draft/start' ya da 'tolobby' mesajı
        const mine = m.st.members.find(x => x.id === m.you);
        if (m.st.playing && g > myGen && mine && mine.team >= 0 && !visible('draft') && performance.now() - syncAsk > 2000) { syncAsk = performance.now(); net.send({ t: 'sync' }); }
        if (!m.st.playing && myGen > 0 && g >= myGen && (mode === 'guest' || visible('draft'))) { guestToLobby(); break; }
        if (joining || (mode !== 'guest' && !visible('draft') && !visible('creator'))) { joining = false; renderLobby(m.st, m.you, false); if (!visible('lobbyScreen') && !visible('help') && !visible('keys')) show('lobbyScreen'); }
        break;
      }
      case 'draft':
        if (m.gen && m.gen < myGen) return;
        myGen = m.gen || myGen;
        mode = 'attract'; startAttract();
        openDraft([{ idx: 0, ch: chars[0], slot: 0 }], (decks) => net && net.send({ t: 'deck', deck: decks[0] }), true);
        break;
      case 'wait':
        myGen = m.gen || myGen;
        if (guestLobby) renderLobby(Object.assign({}, guestLobby.st, { playing: true }), guestLobby.you, false);
        break;
      case 'start':
        if (m.gen && m.gen < myGen) return;
        if (mode === 'guest' && m.id === matchId) return; // zaten bu maçtayız
        myGen = m.gen || myGen;
        matchId = m.id; draft = null;
        startMatch('guest', m.chars.map((c, i) => TP.sanitizeChar(c, i)), m.opts, m.decks, { teams: m.teams, me: m.you });
        if (m.you < 0) toast('Maç sürüyor — izliyorsun, sonraki maçta oyuna gireceksin.', 3500);
        break;
      case 'tolobby':
        if (m.gen && m.gen < myGen) return;
        guestToLobby();
        break;
      case 'kick': toast('Oda sahibi seni çıkardı.', 3500); quitToMenu(); break;
      case 'say':
        if ((mode === 'host' || mode === 'guest') && typeof m.text === 'string' && m.pi !== me) { R.say(m.pi, m.text.slice(0, 48)); A.pop(); }
        break;
      case 's':
        if (mode !== 'guest' || m.m !== matchId) return;
        if (m.s.tk <= lastSnapTk) return;
        lastSnapTk = m.s.tk; snapAt = performance.now();
        pendingSnap = m; // bir karede birden fazla gelirse yalnız sonuncusu uygulanır
        for (const e of m.ev) if (e.id > lastEvId) { lastEvId = e.id; handleEvent(e, false); }
        break;
    }
  }
  function guestToLobby() {
    draft = null; netPaused = false; hideNetBanner();
    mode = 'attract'; startAttract();
    if (guestLobby) renderLobby(guestLobby.st, guestLobby.you, false);
    show('lobbyScreen');
  }

  // ---------- LOBİ ARAYÜZÜ ----------
  function renderLobby(st, you, isHost) {
    $('lbCode').textContent = st.code;
    const ok = st.code && st.code.length === 5;
    $('inviteUrl').value = ok ? inviteURL(st.code) : '…';
    for (const b of $('lbSize').children) b.classList.toggle('on', +b.dataset.n === st.size);
    $('lbSize').classList.toggle('locked', !isHost);
    $('lbTime').value = String(st.time); $('lbGoals').value = String(st.goals); $('lbExtra').value = st.extra;
    for (const id of ['lbTime', 'lbGoals', 'lbExtra']) $(id).disabled = !isHost;
    const mine = st.members.find(m => m.id === you);
    lobbyCanvases = [];
    for (const t of [0, 1]) {
      const box = $('slots' + t); box.innerHTML = '';
      const list = st.members.filter(m => m.team === t);
      for (const m of list) {
        const el = document.createElement('div'); el.className = 'lslot';
        const sub = m.kind === 'bot' ? 'Bot' : m.kind === 'host' ? 'Oda sahibi' : (m.via === 'lan' ? 'yerel ağ' : m.ping ? `${m.ping} ms` : 'bağlı') + (m.via === 'relay' ? ' · aktarma' : '');
        el.innerHTML = `<canvas width="96" height="96"></canvas><div class="nm"><b>${esc(m.ch.name)}${m.id === you ? '<span class="lbadge you">SEN</span>' : ''}${m.kind === 'host' ? '<span class="lbadge host">HOST</span>' : ''}</b><small>${esc(sub)}</small></div>`;
        if (isHost && m.kind !== 'host') {
          const b = document.createElement('button'); b.className = 'btn small ghost xs'; b.textContent = m.kind === 'bot' ? '✕' : 'At';
          b.title = m.kind === 'bot' ? 'Botu çıkar' : 'Odadan at';
          b.onclick = () => { if (m.kind === 'bot') lobby.members = lobby.members.filter(x => x.id !== m.id); else net.kick(m.id); A.ui(); pushLobby(); };
          el.appendChild(b);
        }
        box.appendChild(el);
        lobbyCanvases.push([el.querySelector('canvas'), m.ch, t]);
      }
      for (let k = list.length; k < st.size; k++) {
        const el = document.createElement('div'); el.className = 'lslot empty';
        el.innerHTML = '<span>🤖 Boş — bot oynar</span>';
        if (isHost) { const b = document.createElement('button'); b.className = 'btn small xs'; b.textContent = '+ Bot'; b.onclick = () => addBot(t); el.appendChild(b); }
        box.appendChild(el);
      }
      const jb = document.querySelector(`[data-join="${t}"]`);
      jb.classList.toggle('hidden', !mine || mine.team === t || list.length >= st.size || st.playing);
    }
    const spec = st.members.filter(m => m.team < 0);
    $('lbSpecBox').classList.toggle('hidden', !spec.length);
    $('lbSpec').textContent = spec.map(m => m.ch.name).join(', ');
    $('lbStart').classList.toggle('hidden', !isHost);
    const humans = st.members.filter(m => m.kind !== 'bot').length;
    if (!isHost) $('lbInfo').textContent = st.playing ? 'Maç sürüyor — bitince katılacaksın.' : 'Oda sahibinin maçı başlatması bekleniyor…';
    else if (ok) $('lbInfo').textContent = humans > 1 ? `${humans} oyuncu odada.` : 'Linki gönder, arkadaşların gelsin.';
  }
  let lobbyCanvases = [];
  function addBot(t) {
    if (!lobby || teamCount(t) >= lobby.size) return;
    lobby.members.push({ id: 'bot' + Math.random().toString(36).slice(2, 7), kind: 'bot', team: t, ch: botChar(lobby.members.length) });
    A.ui(); pushLobby();
  }
  $('lbSize').onclick = (e) => { const n = +e.target.dataset.n; if (!n || !lobby) return; lobby.size = n; settings.size = n; save('tp_settings', settings); fitSize(); A.ui(); pushLobby(); };
  $('lbTime').onchange = (e) => { settings.time = +e.target.value; save('tp_settings', settings); pushLobby(); };
  $('lbGoals').onchange = (e) => { settings.goals = +e.target.value; save('tp_settings', settings); pushLobby(); };
  $('lbExtra').onchange = (e) => { settings.extra = e.target.value; save('tp_settings', settings); pushLobby(); };
  document.querySelectorAll('[data-join]').forEach(b => b.onclick = () => {
    const t = +b.dataset.join; A.ui();
    if (lobby) { const h = lobby.members.find(m => m.id === 'host'); if (teamCount(t) < lobby.size) h.team = t; pushLobby(); }
    else if (net) net.send({ t: 'team', team: t });
  });
  $('lbCopy').onclick = () => { const u = $('inviteUrl').value; if (/oda=/.test(u)) copy(u); };
  $('lbEdit').onclick = () => openCreator(0);
  $('lbStart').onclick = () => { A.uiOk(); hostBeginDraft(); };
  $('lbLeave').onclick = () => { A.ui(); quitToMenu(); };
  $('hostBtn').onclick = doHost;
  $('joinBtn').onclick = doJoin;
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  $('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  function copy(s) { (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(() => toast('Kopyalandı: ' + s)).catch(() => toast(s, 5000)); }
  $('onlineBack').onclick = () => { A.ui(); stopRoomPoll(); if (net) { net.close(); net = null; } show('menu'); };

  // ---------- misafir: tahmin + düzeltme ----------
  // Misafir simülasyonu kendi tarafında da 60 Hz çalıştırır; kendi oyuncusu tuşa anında tepki verir.
  // Oda sahibinin görüntüsü gelince o duruma dönülür, henüz işlenmemiş kendi girdilerimiz yeniden oynatılır.
  const inputsFor = (own) => sim.players.map((_, i) => i === me && own ? own : (hostIns[i] || TP.NO_INPUT));
  function guestStep(live) {
    let inp = null;
    if (me >= 0) {
      inp = I.read('solo', 0);
      const q = ++guestSeq;
      net.send({ t: 'i', q, x: inp.x, y: inp.y, k: inp.kick ? 1 : 0, a: inp.ab | 0, p: inp.sp ? 1 : 0, e: inp.emo || 0 }, true);
      pred.push({ q, inp });
      if (pred.length > 120) pred.shift();
    }
    if (live) { sim.step(inputsFor(inp)); sim.events = []; }
  }
  const posList = () => { const o = [sim.ball.x, sim.ball.y]; for (const p of sim.players) o.push(p.x, p.y); return o; };
  function reconcile(m) {
    const before = posList();
    sim.applySnapshot(m.s);
    if (Array.isArray(m.ins)) hostIns = m.ins.map(a => a ? { x: +a[0] || 0, y: +a[1] || 0, kick: !!a[2], ab: a[3] | 0, sp: !!a[4] } : TP.NO_INPUT);
    const ack = m.a && me >= 0 ? m.a[me] : null;
    if (ack != null) while (pred.length && pred[0].q <= ack) pred.shift();
    if (me >= 0) {
      const lead = Math.min(pred.length, Math.ceil(net.rtt / (C.TICK * 1000)) + 6);
      for (let i = pred.length - lead; i < pred.length; i++) sim.step(inputsFor(pred[i].inp));
    }
    sim.events = [];
    const after = posList();
    if (off.length !== after.length) off = new Array(after.length).fill(0);
    for (let i = 0; i < after.length; i += 2) {
      const dx = before[i] - after[i] + off[i], dy = before[i + 1] - after[i + 1] + off[i + 1];
      // büyük fark (gol sonrası santra, ışınlanma) yumuşatılmaz
      if (Math.hypot(dx, dy) > 80) { off[i] = 0; off[i + 1] = 0; } else { off[i] = dx; off[i + 1] = dy; }
    }
  }
  function nudge(s) {
    const b = sim.ball, P = sim.players;
    if (off.length < 2) return;
    b.x += off[0] * s; b.y += off[1] * s;
    for (let i = 0; i < P.length; i++) { P[i].x += (off[2 + i * 2] || 0) * s; P[i].y += (off[3 + i * 2] || 0) * s; }
  }
  function sendSnap() {
    const a = {};
    for (const [i, r] of remotes) a[i] = r.q;
    const ins = hostIns.map(h => h ? [Math.round((h.x || 0) * 100) / 100, Math.round((h.y || 0) * 100) / 100, h.kick ? 1 : 0, h.ab | 0, h.sp ? 1 : 0] : 0);
    net.broadcast({ t: 's', m: matchId, s: sim.snapshot(), ev: recentEv, a, ins }, true);
  }

  // ---------- GOL TEKRARI (yalnızca çizim: kaydı ve oynatmayı R yapar) ----------
  window.addEventListener('keydown', (e) => { if (!e.repeat && (e.code === 'Space' || e.code === 'Enter')) R.skipReplay(); });
  canvas.addEventListener('pointerdown', () => R.skipReplay());

  // ---------- LAF SOKMA (gol sonrası 5 sn) ----------
  let taunts = load('tp_taunts', null);
  if (!Array.isArray(taunts) || taunts.length !== 6) taunts = TP.TAUNTS.slice();
  const TAUNT_KEYS = { solo: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'], p2: ['KeyU', 'KeyI', 'KeyO', 'KeyJ', 'KeyK', 'KeyL'] };
  const tauntCd = {};
  // laf atabilen oyuncular (oyuncu no); panel, oyuncunun takım tarafında açılır
  function myTeams() {
    if (mode === 'local') return [0, 1];
    if (mode === 'attract' || me < 0) return [];
    return [me];
  }
  function keyNameT(pi) { return mode === 'local' && pi === 1 ? ['U', 'I', 'O', 'J', 'K', 'L'] : ['1', '2', '3', '4', '5', '6']; }
  let tauntOpen = false;
  function updateTauntPanels() {
    const open = !!sim && sim.phase === 'goal' && mode !== 'attract' && !endShown;
    if (open === tauntOpen) return;
    tauntOpen = open;
    const mine = myTeams();
    for (let t = 0; t < 2; t++) {
      const el = $('taunt' + t);
      const pi = mine.find(i => matchTeams[i] === t);
      if (!open || pi == null) { el.classList.add('hidden'); continue; }
      const kn = keyNameT(pi);
      el.innerHTML = '<div class="tp-h">💬 Laf sok</div>' + taunts.map((x, i) => `<button class="tp-b" data-t="${pi}" data-i="${i}"><b>${kn[i]}</b>${esc(x)}</button>`).join('');
      el.classList.remove('hidden');
    }
  }
  function sayTaunt(pi, i) {
    const now = performance.now();
    if (now < (tauntCd[pi] || 0)) return;
    tauntCd[pi] = now + 900;
    const text = String(taunts[i] || '').slice(0, 48);
    if (!text) return;
    R.say(pi, text); A.pop();
    if (net && mode === 'host') net.broadcast({ t: 'say', pi, text });
    else if (net && mode === 'guest') net.send({ t: 'say', text });
    const btn = $('taunt' + matchTeams[pi]).querySelector(`[data-i="${i}"]`);
    if (btn) { btn.classList.remove('sent'); void btn.offsetWidth; btn.classList.add('sent'); }
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('.tp-b'); if (b) sayTaunt(+b.dataset.t, +b.dataset.i); });
  window.addEventListener('keydown', (e) => {
    if (!tauntOpen || e.repeat) return;
    const mine = myTeams();
    for (const t of mine) {
      const keys = mode === 'local' && t === 1 ? TAUNT_KEYS.p2 : TAUNT_KEYS.solo;
      const i = keys.indexOf(e.code);
      if (i >= 0) { sayTaunt(t, i); return; }
    }
  });
  function buildTauntEdit() {
    $('tauntList').innerHTML = taunts.map((x, i) => `<div class="krow"><span>${i + 1}</span><input class="tinp" data-i="${i}" maxlength="48" value="${esc(x)}"></div>`).join('');
  }
  $('tauntSave').onclick = () => {
    taunts = [...document.querySelectorAll('.tinp')].map((el, i) => el.value.trim().slice(0, 48) || TP.TAUNTS[i]);
    save('tp_taunts', taunts); A.uiOk(); toast('Laflar kaydedildi'); show('menu');
  };
  $('tauntReset').onclick = () => { taunts = TP.TAUNTS.slice(); save('tp_taunts', taunts); buildTauntEdit(); A.ui(); };

  // ---------- döngü ----------
  let last = performance.now();
  function pump(now, maxSteps) {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    let ts = 1;
    if (slowT > 0) { slowT -= dt; ts = 0.3; }
    if (mode === 'guest') {
      if (!sim || !net) return { dt, ts, ext: 0 };
      if (pendingSnap) { reconcile(pendingSnap); pendingSnap = null; }
      // görüntü gelmiyorsa tahmini durdur (oda sahibi beklemede), girdi yollamaya devam et
      const live = now - snapAt < 250;
      acc += dt * ts;
      let n = 0;
      while (acc >= C.TICK && n < maxSteps) { acc -= C.TICK; guestStep(live); n++; }
      if (n >= maxSteps) acc = 0;
      const k = Math.pow(0.85, dt * 60);
      for (let i = 0; i < 6; i++) off[i] *= k;
      return { dt, ts, ext: live ? acc / C.TICK : 0 };
    }
    // Rakibin girdisi 0.3 sn gelmezse dünyayı dondur (boş kaleye gol olmasın)
    let stalled = false;
    if (mode === 'host' && net && sim && sim.phase !== 'over' && remotes.size) {
      let gap = 0;
      for (const r of remotes.values()) {
        const g = now - r.at, relay = net.via && typeof net.via === 'function' && net.via(r.gid) === 'relay';
        if (g < 3000) gap = Math.max(gap, relay ? g - 300 : g); // aktarma paketleri daha düzensiz gelir
      }
      stalled = gap > 300;
      if (gap > 1200 && !stallShown && !netPaused) { stallShown = true; showNetBanner('Rakibin bağlantısı takıldı, bekleniyor…'); }
      if (!stalled && stallShown) { stallShown = false; if (!netPaused) hideNetBanner(); }
    }
    if (stalled) acc = 0;
    if (sim && !paused && !stalled && !(netPaused && mode === 'host')) {
      acc += dt * ts;
      let n = 0;
      while (acc >= C.TICK && n < maxSteps) { acc -= C.TICK; hostStep(); n++; }
      if (n >= maxSteps) acc = 0;
      // her tick yerine karede bir görüntü: aynı karede art arda paket yollanmaz
      if (n && mode === 'host' && net) sendSnap();
    }
    // tick'ler arasında kalan süre kadar ileri çiz (ekran yenilemesi tick'le hizalı olmasa da akar)
    return { dt, ts, ext: sim ? acc / C.TICK : 0 };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const { dt, ts, ext } = pump(now, 8);
    const smooth = mode === 'guest' && sim;
    if (smooth) nudge(1);
    if (sim) R.draw(sim, paused ? 0 : dt * 60 * ts, ext);
    if (smooth) nudge(-1);
    document.body.classList.toggle('replay', R.replaying);
    updateHUD();
    updateTauntPanels();
    if (visible('menu')) drawChar($('menuPreview'), chars[0]);
    if (visible('creator')) drawChar($('bigPreview'), chars[editIdx], { ring: (performance.now() % 2000) < 400 });
    if (visible('draft') && draft && draft.ch) drawChar($('draftChar'), draft.ch, { scale: 0.28 });
    if (visible('lobbyScreen')) for (const [cv, ch, t] of lobbyCanvases) drawChar(cv, ch, { look: t === 0 ? 0 : Math.PI, scale: 0.3 });
    if (visible('endScreen') && endWinnerChar) drawChar($('endWinner'), endWinnerChar, { mood: 'happy' });
  }
  setInterval(() => { if (document.hidden && mode === 'host') pump(performance.now(), 120); }, 50);
  window.addEventListener('pagehide', () => { if (net) try { net.close(); } catch (e) {} });

  // ---------- başlat ----------
  $('version').textContent = TP.VERSION + (TP.Net.LAN ? ' • yerel ağ' : '');
  if (TP.Net.LAN) {
    $('onlineBtnTitle').textContent = 'Yerel Ağda Oyna';
    $('onlineBtnSub').textContent = 'Aynı ağdaki arkadaşlarınla — 1v1, 2v2, 3v3';
    $('onlineTitle').textContent = 'Yerel Ağ';
  }
  startAttract();
  show('menu');
  // davet linki: ?oda=KOD (eski biçim #KOD da çalışır)
  const qm = /[?&]oda=([A-Za-z0-9]{5})/.exec(location.search);
  const hash = qm ? qm[1].toUpperCase() : location.hash.replace('#', '').toUpperCase();
  if (/^[A-Z0-9]{5}$/.test(hash)) { history.replaceState(null, '', location.pathname); setTimeout(() => openOnline(hash), 200); }
  requestAnimationFrame(frame);

  window.__tp = { get sim() { return sim; }, get mode() { return mode; }, get me() { return me; }, get lobby() { return lobby; }, get guestLobby() { return guestLobby; }, get net() { return net; }, get draft() { return draft; }, startMatch, chars, settings, R, beginOffline };
})();
