# StockPulse Onaylı Mesaj Otomasyonu Tasarımı

Tarih: 29 Ağustos 2026  
Durum: Kullanıcı tarafından yaklaşımı onaylanmış tasarım; uygulama planı öncesi son inceleme.

## Amaç ve başarı ölçütü

StockPulse için pazar ilgisini telefon veya toplantı istemeden, yalnızca yazılı B2B mesajlarla ölçmek. Sistem araştırma ve tekrar eden büro işini otomatikleştirir; insan adına kontrolsüz iletişim kurmaz.

İlk turda 10 nitelikli Shopify işletmesinden doğrulanabilir mesaj sonuçları elde edilir: anlamlı yanıt, somut stok sorunu, demo talebi, belirli demo geri bildirimi, pilot talebi ve belirli ödeme niyeti. Başarı gönderilen mesaj sayısı değil, doğru sınıflandırılmış ve denetlenebilir sonuçtur.

## Yaklaşım ve veri akışı

Yerel, sağlayıcıdan bağımsız bir onay kuyruğu oluşturulacaktır. Aday araştırması ve mesaj üretimi gönderim kanalından ayrılır. Her kayıt şu durum makinesini izler:

`draft → approved → sent → replied | followup_due | opted_out | closed`

`approved` olmadan gönderim adaptörü çalışamaz. `opted_out` son durumdur ve aynı işletme/adres için yeni taslak oluşturulmasını engeller.

## Bileşenler

### Aday kaydı

Yalnız kamuya açık işletme verisi tutulur: dahili anonim kod, işletme adı ve mağaza alan adı, Shopify kullanımını destekleyen kaynak URL, fiziksel stok uygunluğu ve kısa gerekçe, hedef rol, kamuya açık işletme iletişim kanalının kaynak URL’si, durum ve zaman damgaları.

Kişisel e-posta tahmini, satın alınmış liste, telefon veya müşteri verisi kullanılmaz. Gerçek iletişim adresleri ve mesaj gövdeleri Git’e girmez; yerel gitignore edilmiş çalışma verisinde veya seçilen sağlayıcıda tutulur.

### Taslak üretici

Onaylanmış şablona işletmeye özgü, doğrulanmış tek bir cümle ekler. Uydurma fayda, gelir, tasarruf, müşteri sayısı veya ürün kullanımı iddiası üretmez. Demo bağlantısını yalnız kişi açıkça istediğinde ikinci mesaja ekler.

### Onay kuyruğu

Kullanıcıya alıcı işletme, kanal, kaynaklar, son mesaj ve olası takip tarihini gösterir. Her mesaj ayrı onaylanır. Toplu “hepsini onayla” işlemi ilk sürümde yoktur. Düzenleme veya reddetme mesajı göndermez.

### Gönderim adaptörü

İlk sürüm sağlayıcıdan bağımsız kuru çalışma yapar ve gönderilecek zarfı önizler. Canlı e-posta adaptörü ancak şu koşullardan sonra eklenir:

1. Kullanıcı gönderici hesabını ve sağlayıcıyı seçer.
2. Anahtarlar ortam değişkeninde tutulur.
3. Gönderici kimliği, MERSİS/işletme bilgileri, İYS gereklilikleri ve ücretsiz ret yolu doğrulanır.
4. Kullanıcının kendi test adresine onaylanmış deneme gönderimi başarıyla tamamlanır.

LinkedIn otomasyonu ilk kapsamın dışındadır; LinkedIn aday keşfi veya manuel kullanıcı gönderimi için kaynak olabilir.

### Takip zamanlayıcı

İlk mesajdan beş iş günü sonra, yalnız yanıt ve ret yoksa tek takip taslağı üretir. Takip de ayrı onay ister. İkinci takip üretilmez.

### Yanıt sınıflandırıcı

Yanıt metnini varsayılan olarak kalıcı depolamadan şu etiketlere dönüştürür: `meaningful_reply`, `problem_confirmed`, `demo_requested`, `demo_feedback`, `pilot_requested`, `price_stated`, `opt_out`, `other`. Belirsiz sonuç insan incelemesine gider. `opt_out` diğer tüm otomasyonları bastırır.

### Ölçüm özeti

Yalnız toplu sayıları ve anonim aday kodlarını raporlar. Payda sıfırken yüzde üretmez. Taslak, onaylanan ve gerçekten gönderilen mesajları birbirinden ayırır.

## Güvenlik ve kötüye kullanım sınırları

- Günde en fazla 3 onaylı ilk mesaj.
- İşletme başına 1 ilk mesaj ve en fazla 1 takip.
- Her canlı gönderimde eylem anında insan onayı.
- Ret aynı kanalda kolay ve ücretsiz olmalı; ret isteği operasyonel süre içinde uygulanmalı.
- Gönderim dışı kayıtlarda içerik en aza indirilir; yalnız tekrar teması önleyecek kimlik tutulur.
- Kaynaklarda bulunmayan kişi bilgileri türetilmez.
- Gizli anahtar, gerçek adres veya mesaj içeriği loglanmaz.
- Hata durumunda otomatik tekrar gönderilmez; sonuç `delivery_unknown` olur ve insan incelemesi ister.

## Yasal operasyon kapısı

Ticaret Bakanlığı tacir/esnaf alıcılara önceden onay zorunluluğu bakımından istisna açıklar; ret sonrası tekrar gönderim yapılamaz. İYS, gönderici kimliği ve ret yöntemi yükümlülükleri ayrıca doğrulanmalıdır. Sistem, alıcının tacir/esnaf statüsü ve gönderici yükümlülükleri doğrulanmadan canlı gönderime izin vermez. Bu teknik kapı hukuk danışmanlığının yerine geçmez.

## Test stratejisi

- Durum geçişleri ve onaysız gönderim engeli için birim testleri.
- İşletme/adres tekilleştirme ve gönderim dışı liste testleri.
- Günlük sınır, tek takip ve beş iş günü hesaplama testleri.
- Gizli/kişisel bilginin log ve sürüm kontrolüne girmediğini doğrulayan testler.
- Kuru çalışma adaptöründe tam zarf önizleme testi.
- Canlı adaptör eklenirse sahte sağlayıcıyla başarılı, reddedilen ve belirsiz teslimat testleri; sonra yalnız kullanıcının kendi test adresine onaylı uçtan uca test.

## İlk sürümün kapsamı dışında

- LinkedIn tarayıcı botu.
- Otomatik toplu gönderim.
- Kişisel e-posta bulma veya zenginleştirme servisi.
- Otomatik yanıt verme veya fiyat pazarlığı.
- CRM, ücretli analitik, gerçek müşteri verisi ve kamuya açık üretim paneli.
