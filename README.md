# Personel Çağırma Socket Sunucusu

Bu proje, ERP sistemi içerisinde personellerin birbirini gerçek zamanlı olarak çağırmasını, bildirim almasını ve günlük rapor hatırlatmalarını yöneten Socket.io tabanlı bir sunucudur.

## 🚀 Özellikler

- **Anlık Çağrı:** Personellerin birbirine "Gördüm" onaylı çağrı göndermesi.
- **Durum Takibi:** Kullanıcıların çevrimiçi durumuna göre çağrı yönetimi.
- **Otomatik Rapor Hatırlatıcı:** Her gün saat **16:50**'de tüm aktif kullanıcılara otomatik rapor doldurma bildirimi gönderir.
- **Kesintisiz Çalışma:** PM2 entegrasyonu sayesinde hata durumunda otomatik yeniden başlama.

## 🛠 Kurulum

1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

2. Sunucuyu başlatın:
   - Geliştirme modu:
     ```bash
     node socket_server.js
     ```
   - Canlı ortam (PM2):
     ```bash
     npm run pm2:start
     ```

## 📡 Socket Olayları (Events)

### İstemci -> Sunucu (Emits)
- `register`: Kullanıcı ID'sini soket bağlantısı ile eşleştirir.
- `call_user`: Belirli bir personeli çağırmak için kullanılır.
- `call_seen`: Çağrının alıcı tarafından görüldüğünü bildirir.

### Sunucu -> İstemci (Listeners)
- `incoming_call`: Hedef kullanıcıya gelen çağrı bildirimi.
- `call_sent`: Çağrının başarıyla iletildiğine dair göndericiye onay.
- `call_accepted`: Çağrılan kişinin bildirimi gördüğüne dair göndericiye onay.
- `show_report_popup`: Günlük rapor saati geldiğinde tüm kullanıcılara gönderilen bildirim.

## ⚙️ Yapılandırma

- **Port:** Varsayılan olarak `3000` portunda çalışır.
- **CORS:** Tüm originlere izin verecek şekilde yapılandırılmıştır (Geliştirme ve esneklik için).
- **Loglar:** `logs/` klasörü altında PM2 tarafından tutulur.

## 📝 Notlar
Hata durumunda veya sunucu kapandığında PM2 otomatik olarak devreye girer. Logları takip etmek için `pm2 logs personel-cagirma` komutunu kullanabilirsiniz.
