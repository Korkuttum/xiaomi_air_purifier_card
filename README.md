# Xiaomi Air Purifier Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

Xiaomi hava temizleyiciler için minimalist tile kart. Orijinal cihaz ekranından ilham alınmıştır.

## 📦 Kurulum

### HACS ile (Önerilen)
1. HACS > sağ üstteki **⋮ (3 nokta)** > **Özel depolar (Custom repositories)**
2. Depo URL'si: `https://github.com/korkuttum/xiaomi_air_purifier_card`
3. Kategori: **Dashboard (Lovelace)**
4. "Ekle" deyin, ardından HACS'ta kartı bulup **İndir**'e tıklayın
5. HACS, kaynağı (resource) otomatik olarak panonuza ekler. Eklemezse:
   Ayarlar > Panolar > sağ üst **⋮** > **Kaynakları Yönet** > **Kaynak Ekle**
   - URL: `/hacsfiles/xiaomi_air_purifier_card/purifier-card.js`
   - Tür: **JavaScript Modülü**
6. Tarayıcı önbelleğini temizleyip sayfayı yenileyin

### Manuel Kurulum
1. `purifier-card.js` dosyasını `config/www/` klasörüne kopyalayın
2. Ayarlar > Panolar > sağ üst **⋮** > **Kaynakları Yönet** > **Kaynak Ekle**
   - URL: `/local/purifier-card.js`
   - Tür: **JavaScript Modülü**
3. Tarayıcı önbelleğini temizleyip Home Assistant'ı yenileyin

## 🚀 Kullanım

Panoyu düzenleyin > **Kart Ekle** > listede **"Xiaomi Air Purifier Card"** kartını arayın
(önizlemesiyle birlikte görünecektir) ya da YAML modunda:

```yaml
type: custom:xiaomi-air-purifier-card
entity: fan.xiaomi_air_purifier
```
