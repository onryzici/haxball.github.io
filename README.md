# Toparlak Lig ⚽ (v4.1)

Yuvarlak karakterlerle sert, arcade 1v1 tarayıcı futbolu: roket şutlar rakibi uçurur, bombalar patlar, 3 darbede rakip sersemler.

**Tarayıcıda oyna:** https://onryzici.github.io/haxball.github.io/

## Modlar
- **Bota karşı**: kolay / orta / zor
- **Aynı klavyede 2 kişi**: gamepad de destekleniyor
- **Online**: oda kodu ya da davet linkiyle. Önce doğrudan bağlantı (WebRTC) deneniyor, olmazsa aktarma sunucusu (MQTT) üzerinden bağlanıyor.
- **Yerel ağ**: aynı ofis/ev ağında gecikmesiz oynamak için (ayrıntılar aşağıda)

## Aynı ağda gecikmesiz oynama
1. `Oyunu Baslat.command` dosyasına çift tıkla (ya da terminalde `npm install && node server.js`).
2. Terminalde yazan adresleri açın: sen `http://localhost:8080`, arkadaşın `http://<senin-IP>:8080`.
3. Biriniz **Yerel Ağda Oyna → Oda Kur** desin, diğeri listede çıkan odaya **Katıl** desin.

Bağlantı koparsa oyun 25 saniye boyunca otomatik yeniden bağlanır. Rakibin girdisi takılırsa oyun ikiniz için de donar, yani boş kaleye gol atılamaz.

## Yetenek kartları
Maç başında 15 karttan 3'ünü seçersin. Maçta üçü de elinde: **1-2-3** tuşlarıyla her birini ayrı kullanırsın, her birinin kendi bekleme süresi var. Aynı anda basıp **kombola** (ör. Roket + Falso = falsolu roket).

🚀 Roket Şut · 🌀 Falso · 💥 Şok Dalgası · 🧊 Buz · ✨ Işınlanma · 🛡️ Kale Duvarı · 👻 Hayalet · ⚡ Turbo · 🔄 Ters Kontrol · 💣 Bomba Top · 🧨 Mayın · 🌪️ Rüzgar · 🪄 Topu Çağır · 🌫️ Sis · 🧤 Kaleci Eldiveni

## Arcade kuralları
- **Şut tuşu bırakınca vurur.** Ne kadar uzun basılı tutarsan o kadar sert.
- **Rakibe vur:** top uzaktayken rakibin dibinde şutu bırakırsan ona vurursun. Sert şutla isabet ettirmek de sayılır. **ard arda 3 isabette rakip sersemler** (aralarında 2.5 sn'den fazla geçerse sayaç sıfırlanır).
- **Roket şut** rakibe çarparsa onu havaya uçurur, kalesine kadar gömebilir.
- Sahaya ara ara (~20 sn) **⚡ enerji küresi** düşer: kapanın bekleme süresi en uzun kalan yeteneği hazır olur, koşu barı dolar.
- **Mükemmel şut:** halka dolup maviye döndüğü an bırakırsan şut çok daha sert gider.
- **Ekstra modlar (isteğe bağlı, menüden):** *Langırt*: ortadaki tamponlar topu ve oyuncuları fırlatır. *Kaos*: buzlu zemin, dev top, meteor yağmuru, herkese turbo.
- **Seri skoru:** aynı rakiple rövanşlarda seri tutulur.
- **Laf sokma:** golden sonraki 5 saniyede rakibe hazır laf at (1-6, P2: U I O J K L ya da tıkla). Laflar menüdeki 💬 Laflar ekranından değiştirilebilir.
- **Emoji:** 5-8 (P2: 9 0 * -) 😂🔥😡👍
- **Stadyum:** gündüz, akşam, gece ya da rastgele.

## Tuşlar (menüdeki ⌨️ Tuşlar ekranından değiştirilebilir)
| | Hareket | Şut | Koş | Yetenek |
|---|---|---|---|---|
| Tek / Online | WASD / Oklar | Space / X | Shift | E / C / Q |
| Aynı klavye P1 | WASD | Space | Sol Shift | E / Q |
| Aynı klavye P2 | Oklar | L / . | K / Sağ Shift | J / / |
| Gamepad | Sol çubuk | A / RT | RB / LT | B / X / Y |

- Şut anında hangi yöne basıyorsan top o yöne kayar.
- Sprint barı biterse bir süre koşamazsın.

## Karakter
İsim, numara, iki forma rengi, 8 desen, 5 yüz ifadesi, 8 saç modeli, saç rengi, 7 aksesuar.

## Dosyalar
- `index.html`, `css/`, `js/`: oyun (saf HTML/JS, kurulum gerektirmez)
- `server.js`: yerel ağ sunucusu (Node.js + `ws`)
- `js/sim.js`: fizik ve maç kuralları, `js/render.js`: çizim, `js/net.js`: bağlantı
