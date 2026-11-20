// TOPARLAK — basit ama inatçı yapay zeka
(function () {
  const C = TP.C;
  class Bot {
    constructor(level) {
      this.level = level || 'orta';
      const L = { kolay: { speed: 0.62, react: 14, aim: 0.55, ab: 0.004 }, orta: { speed: 0.85, react: 7, aim: 0.75, ab: 0.012 }, zor: { speed: 1, react: 2, aim: 0.88, ab: 0.03 } };
      this.cfg = L[this.level] || L.orta;
      this.out = { x: 0, y: 0, kick: false, ab: 0, sp: false };
      this.t = 0; this.kickHold = 0; this.mode = 'atk'; this.holding = false; this.held = 0; this.holdTarget = 0; this.tackling = false;
      this.wobble = Math.random() * 10;
    }

    think(sim, idx) {
      this.t++;
      const me = sim.players[idx], b = sim.ball;
      const opp = sim.nearestFoe ? sim.nearestFoe(me, b.x, b.y) : sim.players[1 - idx];
      const side = me.team === 0 ? -1 : 1;              // kendi kalemiz bu tarafta
      const goalX = -side * (C.FW + 10);                // hücum kalesi
      const ownX = side * C.FW;
      const cfg = this.cfg;
      if (this.t % cfg.react !== 0 && this.t > 1) return this.out;

      // Topun birkaç tick sonraki konumu
      const look = 8;
      const bx = b.x + b.vx * look, by = b.y + b.vy * look;
      const dB = Math.hypot(bx - me.x, by - me.y);
      const dO = Math.hypot(bx - opp.x, by - opp.y);

      // Hedef: topun arkasında, kaleye doğru bakacak nokta
      let aimY = Math.max(-C.GH + 18, Math.min(C.GH - 18, by * 0.3 + Math.sin(this.t * 0.01 + this.wobble) * 30));
      let gx = goalX - bx, gy = aimY - by;
      let gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
      const behind = me.r + b.r + 4;
      let tx = bx - gx * behind, ty = by - gy * behind;

      // Takım rolü: topa en yakın arkadaş topa gider; ikinci destek, üçüncü defans
      const mates = sim.players.filter(q => q.team === me.team);
      let rank = 0;
      if (mates.length > 1) {
        // herkes aynı sıralamayı hesaplar (eşitlikte oyuncu numarası); top taşıyana küçük öncelik → rol titremez
        const dist = (q) => Math.hypot(bx - q.x, by - q.y) - (sim.lastToucher === q.i ? 30 : 0);
        const sorted = mates.slice().sort((a, c) => (dist(a) - dist(c)) || (a.i - c.i));
        rank = sorted.indexOf(me);
      }

      // Savunma: rakip topa çok daha yakın ve top bizim yarıda ise kaleyle top arasına gir
      const ballOurHalf = side * b.x > -60;
      const myKickoff = sim.phase === 'kickoff' && sim.kickoffTeam === me.team;
      const defend = rank === 0 && !myKickoff && dO + 40 < dB && ballOurHalf;
      if (rank > 0) {
        // destek / defans pozisyonu
        if (rank === 1 && !(ballOurHalf && side * b.x > 120)) {
          tx = Math.max(-C.FW + 40, Math.min(C.FW - 40, b.x - side * 110));
          ty = b.y > 0 ? Math.max(-C.FH + 40, b.y - 150) : Math.min(C.FH - 40, b.y + 150);
        } else {
          tx = ownX - side * (rank === 1 ? 170 : 110) + (b.x - ownX) * 0.25;
          ty = Math.max(-C.GH, Math.min(C.GH, b.y * 0.55));
        }
        if (sim.phase === 'kickoff') { tx = me.x; ty = me.y; }
      }
      if (defend) {
        const k = 0.35;
        tx = ownX + (b.x - ownX) * k; ty = b.y * k * 1.4;
        tx -= side * 18;
      }

      // Topun yanlış tarafındaysak etrafından dolaş
      const mx = me.x - bx, my = me.y - by;
      const wrongSide = (mx * gx + my * gy) > 0;
      if (rank === 0 && !defend && wrongSide && Math.hypot(mx, my) < 90) {
        const perp = (mx * -gy + my * gx) >= 0 ? 1 : -1;
        tx = bx - gx * 30 + -gy * perp * 42; ty = by - gy * 30 + gx * perp * 42;
      }

      // Topun arkasında ve hizalıysak içinden geç (dripling)
      const nearBall = Math.hypot(me.x - bx, me.y - by) < me.r + b.r + 14;
      if (rank === 0 && !defend && !wrongSide && nearBall) { tx = bx + gx * 20; ty = by + gy * 20; }

      let dx = tx - me.x, dy = ty - me.y;
      const dl = Math.hypot(dx, dy);
      let speed = cfg.speed;
      if (dl < 6) speed *= dl / 6;
      if (dl > 0.01) { dx /= dl; dy /= dl; }
      this.out.x = dx * speed; this.out.y = dy * speed;
      // Sprint: uzaktaysak ve nefesimiz varsa koş
      this.out.sp = (dB > 130 || (defend && dB > 70)) && me.stamina > (this.level === 'kolay' ? 0.7 : 0.35) && this.level !== 'kolay' || (this.level === 'kolay' && dB > 250 && me.stamina > 0.8);

      // Şut kararı
      const toBx = b.x - me.x, toBy = b.y - me.y, tl = Math.hypot(toBx, toBy) || 1;
      const align = (toBx / tl) * gx + (toBy / tl) * gy;
      const close = tl - me.r - b.r < 22;
      const distGoal = Math.abs(goalX - b.x);
      const inRange = tl - me.r - b.r < C.KICK_RANGE + 1;
      const dOppNow = Math.hypot(opp.x - me.x, opp.y - me.y);
      // Şut tuşu bırakınca vurur: bas, (gerekirse şarj et), topa değince bırak
      if (this.holding) {
        this.held += cfg.react;
        const ready = this.held >= this.holdTarget;
        if ((ready && inRange && (align > cfg.aim - 0.2 || defend)) || this.held > 100 || this.tackling) { this.out.kick = false; this.holding = false; this.tackling = false; }
        else this.out.kick = true;
      } else if (close && (align > cfg.aim || (defend && align > -0.2))) {
        this.holding = true; this.held = 0; this.holdTarget = distGoal > 260 && Math.random() < 0.5 ? 45 : 1; this.out.kick = true;
      } else if (!close && distGoal < 380 && align > 0.85 && tl < 90 && Math.random() < 0.1) {
        this.holding = true; this.held = 0; this.holdTarget = 40; this.out.kick = true; // şarj ederek yaklaş
      } else if (!close && dOppNow < me.r + opp.r + 9 && Math.random() < 0.25 * cfg.speed) {
        this.holding = true; this.held = 0; this.holdTarget = 0; this.tackling = true; this.out.kick = true; // rakibe vur
      } else this.out.kick = false;

      // Yetenek: 3 slot, her biri kendi bekleme süresinde; uygun olanları aynı anda kullanabilir (kombo)
      this.out.ab = 0;
      const dOpp = Math.hypot(opp.x - me.x, opp.y - me.y);
      for (let k = 0; k < 3; k++) {
        const a = me.deck && me.deck[k];
        if (!a || me.cd[k] > 0 || Math.random() > cfg.ab * cfg.react) continue;
        let use = false;
        if (a === 'roket' && close && align > 0.6 && distGoal < 520) use = true;
        else if (a === 'falso' && close && distGoal < 450) use = true;
        else if (a === 'sok' && dOpp < 90 && Math.hypot(opp.x - b.x, opp.y - b.y) < 60) use = true;
        else if (a === 'buz' && dO < dB && dO < 80 && dOpp < C.BUZ_RANGE) use = true;
        else if (a === 'isinlan' && (wrongSide || dB > 220) && !defend) use = true;
        else if (a === 'kalkan' && Math.abs(ownX - b.x) < 200 && b.vx * side > 1.5) use = true;
        else if (a === 'eldiven' && side * b.x > 0 && b.vx * side > 1 && dB < 160) use = true;
        else if (a === 'hayalet' && dOpp < 60 && dB < 120) use = true;
        else if (a === 'turbo' && dB > 160) use = true;
        else if (a === 'ters' && dOpp < 160 && dO < dB + 40) use = true;
        else if (a === 'bomba' && Math.hypot(opp.x - b.x, opp.y - b.y) < 70 && dB > 60) use = true;
        else if (a === 'mayin' && (defend || Math.abs(ownX - me.x) < 220)) use = true;
        else if (a === 'ruzgar' && side * b.x < 0 && Math.abs(goalX - b.x) < 420) use = true;
        else if (a === 'cagir' && dB > 180 && dO < dB) use = true;
        else if (a === 'sis' && close && distGoal < 400) use = true;
        if (use) this.out.ab |= 1 << k;
      }
      return this.out;
    }
  }
  TP.Bot = Bot;
})();
