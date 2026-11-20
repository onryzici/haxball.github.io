// TOPARLAK — deterministik fizik / maç simülasyonu (host tarafında çalışır)
(function () {
  const C = TP.C;
  const NONE = { x: 0, y: 0, kick: false, ab: false };

  function seg(x1, y1, x2, y2, mask) { return { x1, y1, x2, y2, mask }; }
  const BALL = 1, PLAYER = 2;

  function buildWalls() {
    const { FW, FH, GH, GD, OW, OH } = C;
    const s = [];
    // Topun saha sınırları
    s.push(seg(-FW, -FH, FW, -FH, BALL));
    s.push(seg(-FW, FH, FW, FH, BALL));
    for (const sx of [-1, 1]) {
      s.push(seg(sx * FW, -FH, sx * FW, -GH, BALL));
      s.push(seg(sx * FW, GH, sx * FW, FH, BALL));
      // Kale filesi (top + oyuncu)
      const bx = sx * (FW + GD);
      s.push(seg(sx * FW, -GH, bx, -GH, BALL | PLAYER));
      s.push(seg(bx, -GH, bx, GH, BALL | PLAYER));
      s.push(seg(bx, GH, sx * FW, GH, BALL | PLAYER));
    }
    // Oyuncu dış sınırı
    s.push(seg(-OW, -OH, OW, -OH, PLAYER));
    s.push(seg(-OW, OH, OW, OH, PLAYER));
    s.push(seg(-OW, -OH, -OW, OH, PLAYER));
    s.push(seg(OW, -OH, OW, OH, PLAYER));
    return s;
  }

  function buildPosts() {
    const p = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1])
      p.push({ x: sx * C.FW, y: sy * C.GH, r: C.POST_R, vx: 0, vy: 0, invMass: 0 });
    return p;
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function makePlayer(team, ch, deck) {
    deck = (deck && deck.length ? deck : [ch.ability || 'roket']).filter(k => TP.ABILITIES[k]);
    if (!deck.length) deck = ['roket'];
    const p = {
      team, ch, deck, queue: [], ability: null, next: null, slow: 0,
      x: 0, y: 0, vx: 0, vy: 0, r: C.PLAYER_R, invMass: C.PLAYER_INVMASS,
      kickReady: false, kickHeld: false, charge: 0, abHeld: false, abMask: 0,
      cd: [0, 0, 0], cdMax: [1, 1, 1], rocket: 0, curve: 0, magnet: 0, giant: 0, dash: 0, stun: 0,
      ix: 0, iy: 0, stamina: 1, stDelay: 0, exhausted: false, sprinting: false, kickBuf: 0, kickRel: 0,
      ghost: 0, turbo: 0, mini: 0, inv: 0, hits: 0, hitT: 0, hitImm: 0, tackleCd: 0, lastEmo: 0, emoCd: 0, fly: 0, flyGoal: false, fullT: 0, perfect: false,
      glove: 0, hold: 0,
    };
    p.ability = deck[0];
    return p;
  }

  // Kart destesinden rastgele sırayla yetenek çek
  function drawCard(p) {
    if (!p.queue.length) {
      p.queue = shuffle(p.deck.slice());
      if (p.deck.length > 1 && p.queue[0] === p.ability) p.queue.push(p.queue.shift());
    }
    p.ability = p.queue.shift();
    if (!p.queue.length) {
      p.queue = shuffle(p.deck.slice());
      if (p.deck.length > 1 && p.queue[0] === p.ability) p.queue.push(p.queue.shift());
    }
    p.next = p.queue[0];
  }

  function collideCircles(a, b, bounce) {
    const dx = a.x - b.x, dy = a.y - b.y;
    const rr = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 === 0) return null;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    const im = a.invMass + b.invMass;
    if (im === 0) return null;
    const pen = rr - d;
    a.x += nx * pen * a.invMass / im; a.y += ny * pen * a.invMass / im;
    b.x -= nx * pen * b.invMass / im; b.y -= ny * pen * b.invMass / im;
    const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rv < 0) {
      const j = -(1 + bounce) * rv / im;
      a.vx += nx * j * a.invMass; a.vy += ny * j * a.invMass;
      b.vx -= nx * j * b.invMass; b.vy -= ny * j * b.invMass;
    }
    return { nx, ny, rv };
  }

  function collideSeg(o, s, bounce) {
    const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
    const l2 = ex * ex + ey * ey;
    let t = ((o.x - s.x1) * ex + (o.y - s.y1) * ey) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = s.x1 + ex * t, cy = s.y1 + ey * t;
    const dx = o.x - cx, dy = o.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= o.r * o.r || d2 === 0) return 0;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    o.x += nx * (o.r - d); o.y += ny * (o.r - d);
    const vn = o.vx * nx + o.vy * ny;
    if (vn < 0) { o.vx -= (1 + bounce) * vn * nx; o.vy -= (1 + bounce) * vn * ny; }
    return -vn;
  }

  class Sim {
    constructor(opts) {
      this.opts = Object.assign({ timeLimit: 180, scoreLimit: 5 }, opts);
      this.walls = buildWalls();
      this.posts = buildPosts();
      const decks = opts.decks || [];
      // takımlar: opts.teams = [0,1,0,1…] (oyuncu başına). Varsayılan 1v1.
      const teams = opts.teams && opts.teams.length === opts.chars.length ? opts.teams : opts.chars.map((_, i) => i % 2);
      const cnt = [0, 0];
      this.players = opts.chars.map((ch, i) => { const p = makePlayer(teams[i], ch, decks[i]); p.i = i; p.slot = cnt[p.team]++; return p; });
      this.teamSize = cnt;
      this.shields = []; this.mines = []; this.pickups = []; this.wind = null; this.fog = 0; this.bouncy = 0; this.pickTimer = 0; this.client = !!opts.client; this.hitstop = 0;
      this.map = opts.map || 'klasik';
      this.bumpers = this.map === 'langirt'
        ? [{ x: 0, y: -125, r: 20 }, { x: 0, y: 125, r: 20 }, { x: -265, y: 0, r: 16 }, { x: 265, y: 0, r: 16 }].map(b => Object.assign(b, { invMass: 0, vx: 0, vy: 0 }))
        : [];
      this.chaosOn = !!opts.chaos; this.chaos = null; this.chaosTimer = 0; this.meteors = [];
      this.ball = { x: 0, y: 0, vx: 0, vy: 0, r: C.BALL_R, invMass: C.BALL_INVMASS, fire: 0, fireTeam: -1, spin: 0, bomb: 0, bombTeam: -1, curveT: 0, curveTeam: -1, curveBy: -1, rocketT: 0 };
      this.score = [0, 0];
      this.tick = 0;
      this.timeLeft = this.opts.timeLimit > 0 ? this.opts.timeLimit * 60 : -1;
      this.overtime = false;
      this.phase = 'kickoff';
      this.kickoffTeam = Math.random() < 0.5 ? 0 : 1;
      this.freeze = 0;
      this.goalTimer = 0;
      this.lastTouch = -1;
      this.lastGoal = null;
      this.winner = -1;
      this.events = [];
      this.evId = 0;
      this.stats = { kicks: [0, 0], power: [0, 0], poss: [0, 0], abil: [0, 0], fast: [0, 0], dizzy: [0, 0] };
      this.resetKickoff(true);
    }

    emit(k, data) { this.events.push(Object.assign({ id: ++this.evId, k }, data)); }
    foes(p) { return this.players.filter(o => o.team !== p.team); }
    // p'ye (ya da x,y noktasına) en yakın rakip
    nearestFoe(p, x, y) {
      x = x == null ? p.x : x; y = y == null ? p.y : y;
      let best = null, bd = 1e9;
      for (const o of this.players) { if (o.team === p.team) continue; const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } }
      return best || this.players[0];
    }

    resetKickoff(first) {
      const b = this.ball;
      b.x = 0; b.y = 0; b.vx = 0; b.vy = 0; b.fire = 0; b.spin = 0; b.curveT = 0; b.rocketT = 0;
      this.shields = []; this.mines = []; this.wind = null; this.fog = 0; this.bouncy = 0; b.bomb = 0; this.meteors = [];
      this.players.forEach((p, i) => {
        const side = p.team === 0 ? -1 : 1;
        const n = this.teamSize[p.team], k = p.slot;
        // 1: ortada; 2: üst-alt; 3: biri önde, ikisi arkada kanatlarda
        const F = n === 1 ? [[200, 0]] : n === 2 ? [[200, -85], [200, 85]] : [[170, 0], [300, -125], [300, 125]];
        const f = F[k] || [200 + 60 * k, 0];
        p.x = side * f[0]; p.y = f[1]; p.vx = 0; p.vy = 0;
        p.kickReady = false; p.charge = 0; p.dash = 0; p.stun = 0; p.magnet = 0; p.giant = 0; p.kickBuf = 0; p.slow = 0;
        p.kickRel = 0; p.ghost = 0; p.turbo = 0; p.mini = 0; p.inv = 0; p.hits = 0; p.hitT = 0; p.fly = 0;
        p.glove = 0; p.hold = 0;
        p.stamina = Math.max(p.stamina, 0.6); p.exhausted = false;
        p.r = C.PLAYER_R; p.invMass = C.PLAYER_INVMASS;
      });
      this.phase = 'kickoff';
      this.freeze = first ? 90 : C.KICKOFF_FREEZE;
      this.emit('kickoff', { team: this.kickoffTeam, first: !!first });
    }

    useAbility(p, ax, ay, k) {
      const used = p.deck[k];
      const A = TP.ABILITIES[used];
      const opp = this.nearestFoe(p);
      const b = this.ball;
      p.cd[k] = p.cdMax[k] = Math.round(A.cd * 60);
      this.stats.abil[p.team]++;
      const extra = {};
      switch (used) {
        case 'buz': {
          // yalnız menzildeki rakip donar; ıskalarsan kart boşa gider
          const dx = opp.x - p.x, dy = opp.y - p.y, d = Math.hypot(dx, dy) || 1;
          if (d <= C.BUZ_RANGE + opp.r) {
            opp.slow = 150; opp.kickReady = false; opp.charge = 0;
            extra.tx = opp.x; extra.ty = opp.y; extra.hit = 1;
          } else {
            extra.tx = p.x + dx / d * C.BUZ_RANGE; extra.ty = p.y + dy / d * C.BUZ_RANGE; extra.hit = 0;
          }
          break;
        }
        case 'isinlan': {
          const side = p.team === 0 ? 1 : -1; // hücum yönü
          let gx = side * (C.FW + 10) - b.x, gy = -b.y;
          const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
          const dd = p.r + b.r + 8;
          extra.fx = p.x; extra.fy = p.y;
          let tx = b.x - gx * dd, ty = b.y - gy * dd;
          // hedef başka bir oyuncunun üstüne denk gelirse yanına kay (iç içe doğup savrulmasınlar)
          for (const q of this.players) {
            if (q === p) continue;
            const need = p.r + q.r + 2, ox = tx - q.x, oy = ty - q.y, od = Math.hypot(ox, oy);
            if (od < need) {
              const ux = od > 0.01 ? ox / od : -gx, uy = od > 0.01 ? oy / od : -gy;
              tx = q.x + ux * need; ty = q.y + uy * need;
            }
          }
          p.x = Math.max(-C.OW + p.r, Math.min(C.OW - p.r, tx));
          p.y = Math.max(-C.OH + p.r, Math.min(C.OH - p.r, ty));
          p.vx = gx * 1.5; p.vy = gy * 1.5;
          break;
        }
        case 'kalkan': {
          const sx = p.team === 0 ? -1 : 1;
          this.shields = this.shields.filter(s => s.team !== p.team);
          const y = Math.max(-C.GH + 30, Math.min(C.GH - 30, b.y * 0.4));
          this.shields.push({ team: p.team, x: sx * (C.FW - 30), y, r: 30, t: 270, invMass: 0, vx: 0, vy: 0 });
          break;
        }
        case 'roket': p.rocket = 360; break;
        case 'hayalet': p.ghost = 240; break;
        case 'turbo': p.turbo = 260; p.stamina = 1; p.exhausted = false; break;
        case 'ters': opp.inv = 120; extra.tx = opp.x; extra.ty = opp.y; break;
        case 'bomba': b.bomb = 100; b.bombTeam = p.team; break;
        case 'mayin': {
          const mine = this.mines.filter(m => m.team === p.team);
          if (mine.length >= 2) this.mines.splice(this.mines.indexOf(mine[0]), 1);
          this.mines.push({ team: p.team, x: p.x, y: p.y, t: 900, arm: 45 });
          break;
        }
        case 'ruzgar': this.wind = { team: p.team, t: 210 }; break;
        case 'sis': this.fog = 170; break;
        case 'cagir': {
          const side = p.team === 0 ? 1 : -1;
          extra.fx = b.x; extra.fy = b.y;
          let gx = side * (C.FW + 10) - p.x, gy = -p.y * 0.5;
          const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
          const d = p.r + b.r + 3;
          b.x = Math.max(-C.FW + b.r + 2, Math.min(C.FW - b.r - 2, p.x + gx * d));
          b.y = Math.max(-C.FH + b.r + 2, Math.min(C.FH - b.r - 2, p.y + gy * d));
          b.vx = p.vx; b.vy = p.vy; b.spin = 0; b.fire = 0; b.bomb = 0; b.curveT = 0; b.rocketT = 0;
          this.lastTouch = p.team; this.lastToucher = p.i;
          break;
        }
        case 'falso': p.curve = 300; break;
        case 'eldiven': p.glove = C.GLOVE_TIME; break;
        case 'sok': {
          const R = 135;
          for (const o of [b, ...this.foes(p)]) {
            const dx = o.x - p.x, dy = o.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d < R + o.r) {
              const f = 3.5 + 6.5 * Math.max(0, 1 - d / R);
              const k = o === b ? 1.15 : 1;
              o.vx += dx / d * f * k; o.vy += dy / d * f * k;
              if (o === b) { b.spin = 0; this.lastTouch = p.team; }
              else { o.stun = Math.max(o.stun, 20); o.kickReady = false; o.fly = Math.max(o.fly, 25); o.vx *= 1.3; o.vy *= 1.3; }
            }
          }
          break;
        }
      }
      this.emit('ab', Object.assign({ a: used, team: p.team, pi: p.i, x: p.x, y: p.y }, extra));
    }

    registerHit(p, n) {
      p.hits += n; p.hitT = 150; p.hitImm = 20;
      if (p.hits >= 3) {
        p.hits = 0; p.hitT = 0;
        p.stun = Math.max(p.stun, 120); p.kickReady = false; p.charge = 0;
        this.stats.dizzy[1 - p.team]++;
        this.hitstop = Math.max(this.hitstop, 5);
        this.emit('dizzy', { team: p.team, pi: p.i, x: p.x, y: p.y });
      } else this.emit('hit', { team: p.team, pi: p.i, x: p.x, y: p.y, n: p.hits });
    }

    tackle(p, o, d) {
      const nx = (o.x - p.x) / (d || 1), ny = (o.y - p.y) / (d || 1);
      o.kickReady = false; o.charge = 0;
      p.tackleCd = 30; p.kickReady = false; p.kickRel = 0; p.charge = 0;
      this.emit('tackle', { x: (p.x + o.x) / 2, y: (p.y + o.y) / 2, team: p.team, pi: p.i });
      this.registerHit(o, 1);
    }

    kick(p) {
      const b = this.ball;
      p.magnet = 0; // kendi şutunu geri çekip öldürmesin
      if (p.hold > 0) { p.hold = 0; p.glove = 0; }
      const dx = b.x - p.x, dy = b.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      let nx = dx / d, ny = dy / d;
      // Nişan yardımı: bastığın yön şutu yönlendirir
      const il = Math.hypot(p.ix, p.iy);
      if (il > 0.3) {
        const ux = p.ix / il, uy = p.iy / il;
        if (ux * nx + uy * ny > 0.05) {
          let ax = nx + ux * C.AIM_ASSIST, ay = ny + uy * C.AIM_ASSIST;
          const al = Math.hypot(ax, ay) || 1; nx = ax / al; ny = ay / al;
        }
      }
      const ch = p.charge;
      let s = C.KICK_BASE + C.KICK_CHARGE_BONUS * Math.pow(ch, 1.3);
      let kind = ch > 0.6 ? 'power' : 'kick';
      if (p.giant > 0) s *= C.GIANT_KICK;
      if (p.mini > 0) s *= 0.7;
      const perfect = p.perfect && ch >= 1; p.perfect = false;
      if (perfect) { s *= 1.2; kind = 'perfect'; }
      if (p.rocket > 0) {
        s = 21;
        b.vx = nx * s; b.vy = ny * s;
        b.fire = 150; b.rocketT = 45; b.fireTeam = p.team;
        p.rocket = 0; kind = 'rocket';
      } else {
        b.vx += nx * s; b.vy += ny * s;
      }
      b.spin = 0;
      if (p.curve > 0) {
        const lat = p.ix * (-ny) + p.iy * nx;
        let sign = Math.abs(lat) > 0.2 ? Math.sign(lat) : (Math.sign(p.vx * (-ny) + p.vy * nx) || 1);
        b.spin = sign * 0.022; // bastığın yöne kıvrılır
        b.curveT = 75; b.curveTeam = p.team; b.curveBy = p.i;
        if (kind !== 'rocket') { b.vx *= 1.1; b.vy *= 1.1; }
        p.curve = 0; kind = kind === 'kick' ? 'curve' : kind;
      }
      p.vx -= nx * C.KICK_RECOIL; p.vy -= ny * C.KICK_RECOIL;
      this.lastToucher = p.i;
      p.kickReady = false; p.kickBuf = 0; p.kickRel = 0;
      this.lastTouch = p.team;
      this.stats.fast[p.team] = Math.max(this.stats.fast[p.team], Math.round(s * 10.8));
      this.stats.kicks[p.team]++;
      if (ch > 0.6) this.stats.power[p.team]++;
      this.emit(kind, { x: b.x, y: b.y, team: p.team, pi: p.i, s, ch, nx, ny });
      p.charge = 0;
    }

    step(inputs) {
      this.tick++;
      if (this.hitstop > 0) { this.hitstop--; return; }
      const b = this.ball, P = this.players;
      if (this.freeze > 0) {
        this.freeze--;
        if (this.freeze === 0) this.emit('whistle', {});
      }
      const frozen = this.freeze > 0;

      // Girdi + yetenekler
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        const raw = inputs[i] || NONE;
        const inp = (frozen || p.stun > 0 || p.fly > 0 || this.phase === 'over') ? NONE : raw;
        let ax = inp.x || 0, ay = inp.y || 0;
        if (p.inv > 0) { ax = -ax; ay = -ay; }
        // emoji (donukken de atılabilir)
        if (p.emoCd > 0) p.emoCd--;
        const emo = raw.emo || 0;
        if (emo && emo !== p.lastEmo && p.emoCd <= 0 && this.phase !== 'goal') { this.emit('emote', { team: p.team, pi: p.i, e: emo }); p.emoCd = 40; }
        p.lastEmo = emo;
        const l = Math.hypot(ax, ay);
        if (l > 1) { ax /= l; ay /= l; }
        p.ix = ax; p.iy = ay;
        // Şut: basınca hazır, basılı tutunca şarj; bırakınca kısa bir süre daha geçerli (tampon)
        // Şut: basılı tutunca şarj olur, TUŞU BIRAKINCA vurur (top o an uzaksa kısa süre daha geçerli)
        if (inp.kick && !p.kickHeld) { p.kickReady = true; p.charge = 0; p.kickRel = 0; }
        else if (!inp.kick && p.kickHeld && p.kickReady) { p.kickRel = C.KICK_BUFFER + 1; p.perfect = p.charge >= 1 && p.fullT > 0 && p.fullT <= 10; }
        if (!inp.kick) {
          if (p.kickRel > 0) { p.kickRel--; if (p.kickRel === 0) { p.kickReady = false; p.charge = 0; } }
          else { p.kickReady = false; p.charge = 0; }
        }
        p.kickHeld = !!inp.kick;
        if (p.kickReady && p.kickHeld) {
          p.charge = Math.min(1, p.charge + 1 / C.CHARGE_TIME);
          p.fullT = p.charge >= 1 ? p.fullT + 1 : 0;
        } else if (!p.kickReady) p.fullT = 0;
        let acc = p.kickHeld && p.kickReady ? C.PLAYER_KICK_ACC : C.PLAYER_ACC;
        if (p.giant > 0) acc *= 0.92;
        if (p.slow > 0) acc *= 0.4;
        if (p.turbo > 0) acc *= 1.4;
        const chaosTurbo = this.chaos && this.chaos.k === 'turbo';
        if (chaosTurbo) acc *= 1.3;
        // Sprint + dayanıklılık
        const moving = Math.hypot(ax, ay) > 0.1;
        if (p.exhausted && p.stamina >= C.STAMINA_MIN) p.exhausted = false;
        p.sprinting = !!inp.sp && moving && !p.exhausted && p.stamina > 0 && p.slow <= 0;
        if (p.sprinting) {
          acc *= C.SPRINT_MULT;
          if (p.turbo <= 0 && !chaosTurbo) p.stamina = Math.max(0, p.stamina - C.STAMINA_DRAIN);
          p.stDelay = C.STAMINA_DELAY;
          if (p.stamina <= 0) { p.exhausted = true; this.emit('tired', { team: p.team, pi: p.i, x: p.x, y: p.y }); }
        } else if (p.stDelay > 0) p.stDelay--;
        else p.stamina = Math.min(1, p.stamina + C.STAMINA_REGEN * (p.exhausted ? 1.25 : 1));
        p.vx += ax * acc; p.vy += ay * acc;
        // 1-2-3: her slot ayrı tuş, ayrı bekleme süresi; aynı anda basılırsa hepsi birlikte çalışır (kombo)
        const abm = inp.ab === true ? 1 : (inp.ab | 0);
        if (this.phase !== 'goal' && this.phase !== 'over')
          for (let k = 0; k < 3; k++) if ((abm & (1 << k)) && !(p.abMask & (1 << k)) && p.deck[k] && p.cd[k] <= 0) this.useAbility(p, ax, ay, k);
        p.abMask = abm; p.abHeld = !!abm;

        for (let k = 0; k < 3; k++) if (p.cd[k] > 0) p.cd[k]--;
        if (p.rocket > 0) p.rocket--;
        if (p.curve > 0) p.curve--;
        if (p.dash > 0) p.dash--;
        if (p.stun > 0) p.stun--;
        if (p.slow > 0) p.slow--;
        if (p.giant > 0) p.giant--;
        if (p.ghost > 0) p.ghost--;
        if (p.turbo > 0) p.turbo--;
        if (p.mini > 0) p.mini--;
        if (p.inv > 0) p.inv--;
        if (p.tackleCd > 0) p.tackleCd--;
        if (p.hitImm > 0) p.hitImm--;
        if (p.fly > 0) p.fly--;
        if (p.hitT > 0) { p.hitT--; if (p.hitT === 0) p.hits = 0; }
        if (p.glove > 0 && p.hold === 0) p.glove--;
        const tr = p.giant > 0 ? C.GIANT_R : p.mini > 0 ? 10 : C.PLAYER_R;
        p.r += (tr - p.r) * 0.18;
        p.invMass = p.giant > 0 ? C.GIANT_INVMASS : p.mini > 0 ? 0.9 : C.PLAYER_INVMASS;
        if (p.magnet > 0) {
          p.magnet--;
          // topu kendine değil, önündeki hücum noktasına çek (kendine çekince top kendi kalene doğru gidiyordu)
          const atk = p.team === 0 ? 1 : -1;
          const px = p.x + atk * (p.r + b.r + 6), py = p.y;
          const dx = px - b.x, dy = py - b.y, d = Math.hypot(dx, dy) || 1;
          if (d < 180 && d > 4) {
            const f = 0.26 * (1 - d / 200);
            b.vx += dx / d * f; b.vy += dy / d * f;
            b.vx *= 0.975; b.vy *= 0.975;
          }
        }
      }

      if (this.fog > 0) this.fog--;
      if (this.bouncy > 0) this.bouncy--;
      if (this.wind) {
        const dir = this.wind.team === 0 ? 1 : -1;
        b.vx += dir * 0.085;
        for (const o of P) if (o.team !== this.wind.team) o.vx += dir * 0.03;
        if (--this.wind.t <= 0) this.wind = null;
      }
      for (const sh of this.shields) sh.t--;
      if (this.shields.length) this.shields = this.shields.filter(sh => sh.t > 0);

      // Falso: hız vektörünü döndür
      // Falso: top havadayken şutu atan sağa/sola basarak kavisi yönetir
      if (b.curveT > 0) {
        b.curveT--;
        const o = P[b.curveBy >= 0 ? b.curveBy : b.curveTeam], v = Math.hypot(b.vx, b.vy);
        if (o && v > 1) {
          const steer = (o.ix * (-b.vy) + o.iy * b.vx) / v; // topun gidişine göre sağ/sol
          b.spin = Math.max(-0.045, Math.min(0.045, b.spin + steer * 0.0026));
        }
      }
      if (b.spin !== 0) {
        const c = Math.cos(b.spin), s = Math.sin(b.spin);
        const vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c;
        b.vx = vx; b.vy = vy;
        b.spin *= b.curveT > 0 ? 0.996 : 0.984;
        if (Math.abs(b.spin) < 0.0008) b.spin = 0;
      }
      // Roket: kısa süre hafifçe rakip kalenin ağzına yönelir
      if (b.rocketT > 0) {
        b.rocketT--;
        if (b.spin === 0 && b.fireTeam >= 0) {
          const gx = (b.fireTeam === 0 ? 1 : -1) * (C.FW + 20), gy = Math.max(-C.GH * 0.6, Math.min(C.GH * 0.6, b.y));
          const want = Math.atan2(gy - b.y, gx - b.x), cur = Math.atan2(b.vy, b.vx);
          let d = want - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          if (Math.abs(d) < 1.2) {
            const turn = Math.max(-0.012, Math.min(0.012, d)), v = Math.hypot(b.vx, b.vy);
            b.vx = Math.cos(cur + turn) * v; b.vy = Math.sin(cur + turn) * v;
          }
        }
      }

      // Alt adımlı hareket + çarpışma
      let maxV = Math.hypot(b.vx, b.vy);
      for (const p of P) maxV = Math.max(maxV, Math.hypot(p.vx, p.vy));
      const N = Math.min(4, Math.max(1, Math.ceil(maxV / 6)));
      let wallHit = 0, postHit = 0, netHit = 0, bump = 0, bumpAt = null, touch = [0, 0], bumperHit = null;
      for (let k = 0; k < N; k++) {
        b.x += b.vx / N; b.y += b.vy / N;
        for (const o of P) { o.x += o.vx / N; o.y += o.vy / N; }
        // oyuncu - top
        for (const p of P) {
          const fireBefore = b.fire > 0 && b.fireTeam !== p.team;
          const sp = Math.hypot(b.vx, b.vy), bvx = b.vx, bvy = b.vy;
          const enemyBall = this.lastTouch >= 0 && this.lastTouch !== p.team;
          const c = collideCircles(b, p, 0.3);
          if (c) {
            touch[p.team] = 1;
            const gloved = p.glove > 0;
            const hitNow = enemyBall && sp > 5.5 && p.hitImm <= 0 && !gloved;
            if (fireBefore && sp > 4 && !gloved) {
              // ROKET: adamı uçur
              const dx = bvx / sp, dy = bvy / sp;
              const k = 17 * (p.giant > 0 ? 0.55 : 1);
              p.vx = dx * k; p.vy = dy * k;
              p.fly = 70; p.flyGoal = false; p.stun = Math.max(p.stun, 80); p.kickReady = false;
              b.vx = bvx * 0.8; b.vy = bvy * 0.8; // top delip geçer
              this.hitstop = 7;
              this.emit('burn', { x: p.x, y: p.y, team: p.team, pi: p.i, nx: dx, ny: dy });
            } else if (hitNow && sp > 7.5) {
              // sert şut isabeti: savur
              const dx = bvx / sp, dy = bvy / sp, k = (sp - 4) * 0.95 * (p.giant > 0 ? 0.5 : 1);
              p.vx += dx * k; p.vy += dy * k;
              if (sp > 11) { p.fly = Math.round(sp * 1.5); p.flyGoal = false; }
              if (sp > 10) this.hitstop = 4;
              this.emit('smack', { x: p.x, y: p.y, team: p.team, pi: p.i, s: sp });
            }
            if (hitNow) this.registerHit(p, fireBefore ? 2 : 1);
            b.spin = 0; b.curveT = 0;
          }
        }
        // oyuncu - oyuncu (her çift)
        for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
          const A = P[i], B = P[j];
          if (A.ghost > 0 || B.ghost > 0) continue;
          const c = collideCircles(A, B, 0.3);
          if (!c) continue;
          const rv = -c.rv, was = bump;
          for (const [p, o, s] of [[A, B, -1], [B, A, 1]]) { // normal B'den A'ya
            // atılma yalnız rakibi savurur
            if (p.dash > 0 && o.dash <= 0 && p.team !== o.team) {
              o.vx += c.nx * s * 9 * o.invMass * 2; o.vy += c.ny * s * 9 * o.invMass * 2;
              o.stun = Math.max(o.stun, 20); o.fly = Math.max(o.fly, 30); this.hitstop = 4;
              p.dash = 0;
              bump = Math.max(bump, 6);
            }
          }
          if (rv > 1.5) bump = Math.max(bump, rv);
          if (bump > was) bumpAt = [(A.x + B.x) / 2, (A.y + B.y) / 2];
        }
        // duvarlar
        for (const w of this.walls) {
          if (w.mask & BALL) {
            const h = collideSeg(b, w, this.bouncy > 0 ? 0.95 : C.BALL_BOUNCE);
            if (h > 0) {
              const isNet = w.mask & PLAYER;
              if (isNet) netHit = Math.max(netHit, h); else wallHit = Math.max(wallHit, h);
              b.spin = 0; b.curveT = 0; b.rocketT = 0;
            }
          }
          if (w.mask & PLAYER) for (const p of P) {
            const h = collideSeg(p, w, p.fly > 0 ? 0.7 : C.PLAYER_BOUNCE);
            if (h > 4 && p.fly > 0) { p.slam = Math.max(p.slam || 0, h); }
          }
        }
        for (const sh of this.shields) {
          const cb = collideCircles(b, sh, 0.6);
          if (cb && -cb.rv > 1) { this.emit('shieldhit', { x: b.x, y: b.y, team: sh.team }); b.spin = 0; b.fire = 0; }
          for (const p of P) collideCircles(p, sh, 0.4);
        }
        for (const bp of this.bumpers) {
          const cb = collideCircles(b, bp, 0.9);
          if (cb) { b.vx += cb.nx * 3; b.vy += cb.ny * 3; b.spin = 0; bumperHit = bp; }
          for (const p of P) { const cp = collideCircles(p, bp, 0.6); if (cp) { p.vx += cp.nx * 2; p.vy += cp.ny * 2; bumperHit = bumperHit || bp; } }
        }
        for (const post of this.posts) {
          const cb = collideCircles(b, post, this.bouncy > 0 ? 0.95 : 0.5);
          if (cb && -cb.rv > postHit) { postHit = -cb.rv; b.spin = 0; }
          for (const p of P) collideCircles(p, post, 0.5);
        }
      }
      if (touch[0] || touch[1]) {
        if (touch[0] && !touch[1]) this.lastTouch = 0;
        else if (touch[1] && !touch[0]) this.lastTouch = 1;
        // golcüyü bulmak için topa en son değen oyuncu
        let near = -1, nd = 1e9;
        for (const p of P) { if (!touch[p.team]) continue; const d = Math.hypot(b.x - p.x, b.y - p.y) - p.r - b.r; if (d < nd) { nd = d; near = p.i; } }
        if (near >= 0) this.lastToucher = near;
      }
      if (bumperHit) this.emit('bumper', { x: bumperHit.x, y: bumperHit.y, i: this.bumpers.indexOf(bumperHit) });
      if (wallHit > 2) this.emit('wall', { x: b.x, y: b.y, s: wallHit });
      if (postHit > 1.5) this.emit('post', { x: b.x, y: b.y, s: postHit });
      if (netHit > 1) this.emit('net', { x: b.x, y: b.y, s: netHit, side: Math.sign(b.x) });
      for (const p of P) if (p.slam) {
        this.emit('slam', { x: p.x, y: p.y, team: p.team, pi: p.i, s: p.slam });
        if (p.slam > 8) this.registerHit(p, 1);
        p.slam = 0;
      }
      // uçarak kaleye girdi mi
      for (const p of P) if (p.fly > 0 && !p.flyGoal && Math.abs(p.x) > C.FW + p.r * 0.5 && Math.abs(p.y) < C.GH) {
        p.flyGoal = true;
        this.emit('intogoal', { x: p.x, y: p.y, team: p.team, pi: p.i, own: Math.sign(p.x) === (p.team === 0 ? -1 : 1) });
      }
      if (bump > 0 && bumpAt) this.emit('bump', { x: bumpAt[0], y: bumpAt[1], s: bump });

      // Kaleci eldiveni: kendi yarında topa değince kısa süre tut
      for (const p of P) {
        const atk = p.team === 0 ? 1 : -1; // hücum yönü
        if (p.hold > 0) {
          if (p.stun > 0 || p.fly > 0 || this.phase !== 'play') { p.hold = 0; p.glove = 0; continue; }
          p.hold--;
          // top hep hücum yönünde önünde durur (kendi kalene sokamazsın), yukarı/aşağı ile kaydırılır
          let fx = atk, fy = p.iy * 0.9;
          const fl = Math.hypot(fx, fy); fx /= fl; fy /= fl;
          const dd = p.r + b.r + 0.5;
          b.x = p.x + fx * dd; b.y = p.y + fy * dd; b.vx = p.vx; b.vy = p.vy; b.spin = 0; b.fire = 0; b.bomb = 0;
          this.lastTouch = p.team;
          if (p.hold === 0) { b.vx += fx * 2.5; b.vy += fy * 2.5; p.glove = 0; }
        } else if (p.glove > 0 && touch[p.team] && this.phase === 'play' && atk * b.x < 20) {
          p.hold = C.GLOVE_HOLD;
          this.emit('catch', { x: b.x, y: b.y, team: p.team, pi: p.i });
        }
      }

      // Şut
      for (const p of P) {
        if (!p.kickReady || p.kickRel <= 0) continue;
        const d = Math.hypot(b.x - p.x, b.y - p.y) - p.r - b.r;
        if (d < C.KICK_RANGE) { this.kick(p); continue; }
        // top uzak ama rakip dibimizdeyse: rakibe vur
        const o = this.nearestFoe(p);
        const dd = Math.hypot(o.x - p.x, o.y - p.y);
        if (dd - p.r - o.r < C.KICK_RANGE + 3 && p.tackleCd <= 0 && o.ghost <= 0) this.tackle(p, o, dd);
      }

      // Sönümleme
      const icy = this.chaos && this.chaos.k === 'buz';
      for (const p of P) { const d = p.fly > 0 ? 0.982 : icy ? 0.984 : C.PLAYER_DAMP; p.vx *= d; p.vy *= d; }
      const bd = b.rocketT > 0 ? 1 : this.bouncy > 0 || icy ? 0.995 : C.BALL_DAMP;
      b.vx *= bd; b.vy *= bd;
      if (b.fire > 0) { b.fire--; if (Math.hypot(b.vx, b.vy) < 3) b.fire = 0; }

      // Emniyet kelepçesi
      const lim = C.FW + C.GD - b.r;
      if (b.x < -lim) { b.x = -lim; b.vx = Math.abs(b.vx) * 0.3; }
      if (b.x > lim) { b.x = lim; b.vx = -Math.abs(b.vx) * 0.3; }
      if (b.y < -C.FH + b.r) { b.y = -C.FH + b.r; b.vy = Math.abs(b.vy) * 0.5; }
      if (b.y > C.FH - b.r) { b.y = C.FH - b.r; b.vy = -Math.abs(b.vy) * 0.5; }

      // Mayınlar
      if (this.mines.length) {
        for (const m of this.mines) {
          m.t--; if (m.arm > 0) m.arm--;
          const o = P.find(q => q.team !== m.team && q.ghost <= 0 && Math.hypot(q.x - m.x, q.y - m.y) < q.r + 9);
          if (m.arm <= 0 && o) {
            const dx = o.x - m.x, dy = o.y - m.y, d = Math.hypot(dx, dy) || 1;
            o.vx += dx / d * 11; o.vy += dy / d * 11; o.fly = 45; this.hitstop = 5;
            o.stun = Math.max(o.stun, 50); o.kickReady = false;
            m.t = 0;
            this.emit('mine', { x: m.x, y: m.y, team: o.team, pi: o.i });
            this.registerHit(o, 1);
          }
        }
        this.mines = this.mines.filter(m => m.t > 0);
      }
      // Bomba top
      if (b.bomb > 0 && --b.bomb === 0) {
        for (const p of P) {
          const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
          if (d < 160) {
            const f = 4 + 10 * (1 - d / 160);
            p.vx += dx / d * f; p.vy += dy / d * f;
            p.fly = Math.max(p.fly, 40);
            if (p.team !== b.bombTeam) { p.stun = Math.max(p.stun, 45); p.kickReady = false; this.registerHit(p, 1); }
          }
        }
        this.hitstop = 6;
        this.emit('boom', { x: b.x, y: b.y, team: b.bombTeam });
      }
      // Kaos olayları (yalnızca oda sahibi başlatır)
      const bigBall = this.chaos && this.chaos.k === 'devtop';
      b.r += ((bigBall ? 18 : C.BALL_R) - b.r) * 0.1;
      b.invMass = bigBall ? 0.55 : C.BALL_INVMASS;
      if (this.chaos) {
        if (this.chaos.k === 'meteor' && !this.client && this.chaos.t % 50 === 0 && this.phase === 'play')
          this.meteors.push({ x: Math.round((Math.random() - 0.5) * 2 * (C.FW - 40)), y: Math.round((Math.random() - 0.5) * 2 * (C.FH - 30)), t: 70 });
        if (--this.chaos.t <= 0) { this.emit('chaosend', { c: this.chaos.k }); this.chaos = null; }
      } else if (this.chaosOn && !this.client && this.phase === 'play' && ++this.chaosTimer > 1500) {
        this.chaosTimer = 0;
        const ks = ['buz', 'devtop', 'meteor', 'turbo'];
        this.chaos = { k: ks[(Math.random() * ks.length) | 0], t: 480 };
        this.emit('chaos', { c: this.chaos.k });
      }
      if (this.meteors.length) {
        for (const m of this.meteors) {
          if (--m.t === 0) {
            for (const o of [b, ...P]) {
              const dx = o.x - m.x, dy = o.y - m.y, d = Math.hypot(dx, dy) || 1;
              if (d < 85) {
                const f = 3 + 7 * (1 - d / 85);
                o.vx += dx / d * f; o.vy += dy / d * f;
                if (o !== b) { o.stun = Math.max(o.stun, 25); o.fly = Math.max(o.fly, 20); o.kickReady = false; }
              }
            }
            this.emit('meteor', { x: m.x, y: m.y });
          }
        }
        this.meteors = this.meteors.filter(m => m.t > 0);
      }

      // Enerji küreleri (yalnızca oda sahibi üretir)
      if (this.phase === 'play') {
        if (!this.client && ++this.pickTimer > 1200 && !this.pickups.length) {
          this.pickTimer = 0;
          this.pickups.push({ x: Math.round((Math.random() - 0.5) * 2 * (C.FW - 90)), y: Math.round((Math.random() - 0.5) * 2 * (C.FH - 40)), t: 720 });
          this.emit('pickspawn', {});
        }
        for (const pk of this.pickups) {
          pk.t--;
          for (const p of P) if (pk.t > 0 && Math.hypot(p.x - pk.x, p.y - pk.y) < p.r + 13) {
            // en uzun bekleyen TEK yeteneği yeniler + koşu barını doldurur
            let best = -1;
            for (let k = 0; k < 3; k++) if (p.cd[k] > 0 && (best < 0 || p.cd[k] > p.cd[best])) best = k;
            if (best >= 0) p.cd[best] = 0;
            p.stamina = 1; p.exhausted = false; pk.t = 0;
            this.emit('pickup', { x: pk.x, y: pk.y, team: p.team, pi: p.i, a: best >= 0 ? p.deck[best] : null });
          }
        }
        if (this.pickups.length) this.pickups = this.pickups.filter(pk => pk.t > 0);
      }

      // Başlama vuruşu kısıtı
      if (this.phase === 'kickoff') {
        if (Math.hypot(b.vx, b.vy) > 0.01 || b.x !== 0 || b.y !== 0) this.phase = 'play';
        else for (const p of P) {
          const side = p.team === 0 ? -1 : 1;
          const dc = Math.hypot(p.x, p.y);
          if (p.team === this.kickoffTeam) {
            if (dc > C.CENTER_R && side * p.x < p.r) { p.x = side * p.r; p.vx = 0; }
          } else {
            if (side * p.x < p.r) { p.x = side * p.r; p.vx = 0; }
            const lim2 = C.CENTER_R + p.r;
            if (dc < lim2) { const f = lim2 / (dc || 1); p.x = (dc ? p.x * f : side * lim2); p.y *= (dc ? f : 0); }
          }
        }
      }

      // Top hakimiyeti
      if (this.phase === 'play') {
        let best = -1, bd = 40;
        for (const p of P) { const d = Math.hypot(b.x - p.x, b.y - p.y) - p.r - b.r; if (d < bd) { bd = d; best = p.team; } }
        if (best >= 0) this.stats.poss[best]++;
      }

      // Gol
      if (this.phase === 'play' || this.phase === 'kickoff') {
        let scorer = -1;
        if (b.x < -C.FW - b.r && Math.abs(b.y) < C.GH) scorer = 1;
        else if (b.x > C.FW + b.r && Math.abs(b.y) < C.GH) scorer = 0;
        if (scorer >= 0) {
          this.score[scorer]++;
          const own = this.lastTouch >= 0 && this.lastTouch !== scorer;
          this.lastGoal = { team: scorer, own, speed: Math.hypot(b.vx, b.vy), fire: b.fire > 0 };
          this.phase = 'goal';
          this.goalTimer = C.GOAL_PAUSE;
          this.kickoffTeam = 1 - scorer;
          this.emit('goal', { team: scorer, own, pi: this.lastToucher != null ? this.lastToucher : -1, x: b.x, y: b.y, s: Math.hypot(b.vx, b.vy), score: this.score.slice() });
        }
      }

      if (this.phase === 'goal') {
        this.goalTimer--;
        if (this.goalTimer <= 0) {
          const lim = this.opts.scoreLimit;
          if (this.overtime || (lim > 0 && this.score[this.lastGoal.team] >= lim)) this.endMatch();
          else this.resetKickoff(false);
        }
      }

      // Süre
      if ((this.phase === 'play' || this.phase === 'kickoff') && this.freeze <= 0 && this.timeLeft > 0 && !this.overtime) {
        this.timeLeft--;
        if (this.timeLeft === 0) {
          if (this.score[0] === this.score[1]) { this.overtime = true; this.emit('overtime', {}); }
          else this.endMatch();
        }
      }
    }

    endMatch() {
      this.phase = 'over';
      this.winner = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : -1;
      this.emit('end', { winner: this.winner, score: this.score.slice() });
    }

    // --- Ağ ---
    snapshot() {
      const r = (v) => Math.round(v * 100) / 100;
      const b = this.ball;
      return {
        tk: this.tick, ph: this.phase, fr: this.freeze, gt: this.goalTimer, tl: this.timeLeft, ot: this.overtime ? 1 : 0,
        sc: this.score, ko: this.kickoffTeam, lt: this.lastTouch, w: this.winner, lg: this.lastGoal,
        b: [r(b.x), r(b.y), r(b.vx), r(b.vy), b.fire, r(b.spin * 1000), b.fireTeam, b.bomb, b.bombTeam, r(b.r), b.curveT, b.curveTeam, b.rocketT, b.curveBy, this.lastToucher != null ? this.lastToucher : -1],
        p: this.players.map(p => [r(p.x), r(p.y), r(p.vx), r(p.vy), r(p.r), p.kickReady ? 1 : 0, r(p.charge), p.cd, p.cdMax,
          p.rocket, p.curve, p.magnet, p.giant, p.dash, p.stun, Math.round(p.stamina * 100) / 100, (p.sprinting ? 1 : 0) | (p.exhausted ? 2 : 0), p.deck, p.abMask, p.slow,
          p.kickHeld ? 1 : 0, p.abHeld ? 1 : 0, p.kickRel, p.stDelay, p.ghost, p.turbo, p.mini, p.inv, p.hits, p.hitT, p.tackleCd, p.hitImm, p.fly, p.fullT, p.perfect ? 1 : 0, p.glove, p.hold]),
        cx: this.chaos ? [this.chaos.k, this.chaos.t] : 0, mt: this.meteors.map(m => [m.x, m.y, m.t]), ct: this.chaosTimer,
        hs: this.hitstop,
        mn: this.mines.map(m => [m.team, Math.round(m.x), Math.round(m.y), m.t, m.arm]),
        pk: this.pickups.map(k => [k.x, k.y, k.t]),
        wd: this.wind ? [this.wind.team, this.wind.t] : 0, fg: this.fog, bc: this.bouncy,
        sh: this.shields.map(s => [s.team, Math.round(s.x), Math.round(s.y), s.r, s.t]),
        st: [this.stats.kicks, this.stats.power, this.stats.poss, this.stats.abil, this.stats.fast, this.stats.dizzy],
      };
    }

    applySnapshot(s) {
      this.tick = s.tk; this.phase = s.ph; this.freeze = s.fr; this.goalTimer = s.gt; this.timeLeft = s.tl;
      this.overtime = !!s.ot; this.score = s.sc; this.kickoffTeam = s.ko; this.lastTouch = s.lt; this.winner = s.w; this.lastGoal = s.lg;
      const b = this.ball;
      [b.x, b.y, b.vx, b.vy, b.fire] = s.b; b.spin = s.b[5] / 1000; b.fireTeam = s.b[6]; b.bomb = s.b[7] || 0; b.bombTeam = s.b[8]; if (s.b[9]) b.r = s.b[9];
      b.curveT = s.b[10] || 0; b.curveTeam = s.b[11]; b.rocketT = s.b[12] || 0; b.curveBy = s.b[13] != null ? s.b[13] : -1; this.lastToucher = s.b[14] != null ? s.b[14] : -1;
      s.p.forEach((a, i) => {
        const p = this.players[i];
        [p.x, p.y, p.vx, p.vy, p.r] = a; p.kickReady = !!a[5];
        [p.charge, p.cd, p.cdMax, p.rocket, p.curve, p.magnet, p.giant, p.dash, p.stun, p.stamina] = a.slice(6);
        p.sprinting = !!(a[16] & 1); p.exhausted = !!(a[16] & 2);
        p.deck = a[17]; p.abMask = a[18]; p.slow = a[19]; p.ability = p.deck[0];
        // misafirdeki tahmin bu durumdan ileri sardığı için tuş geçmişi de gerekli
        if (a.length > 20) { p.kickHeld = !!a[20]; p.abHeld = !!a[21]; p.kickRel = a[22]; p.stDelay = a[23]; }
        if (a.length > 24) [p.ghost, p.turbo, p.mini, p.inv, p.hits, p.hitT, p.tackleCd, p.hitImm, p.fly, p.fullT] = a.slice(24, 34);
        if (a.length > 34) p.perfect = !!a[34];
        if (a.length > 36) { p.glove = a[35]; p.hold = a[36]; }
      });
      this.stats = { kicks: s.st[0], power: s.st[1], poss: s.st[2], abil: s.st[3], fast: s.st[4] || [0, 0], dizzy: s.st[5] || [0, 0] };
      this.mines = (s.mn || []).map(a => ({ team: a[0], x: a[1], y: a[2], t: a[3], arm: a[4] }));
      this.pickups = (s.pk || []).map(a => ({ x: a[0], y: a[1], t: a[2] }));
      this.wind = s.wd ? { team: s.wd[0], t: s.wd[1] } : null; this.fog = s.fg || 0; this.bouncy = s.bc || 0; this.hitstop = s.hs || 0;
      this.chaos = s.cx ? { k: s.cx[0], t: s.cx[1] } : null; this.meteors = (s.mt || []).map(a => ({ x: a[0], y: a[1], t: a[2] })); this.chaosTimer = s.ct || 0;
      this.shields = (s.sh || []).map(a => ({ team: a[0], x: a[1], y: a[2], r: a[3], t: a[4], invMass: 0, vx: 0, vy: 0 }));
    }
  }

  TP.Sim = Sim;
  TP.NO_INPUT = NONE;
})();
