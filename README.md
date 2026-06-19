# Xiaomi Air Purifier Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

Xiaomi hava temizleyiciler için minimalist tile kart. Orijinal cihaz ekranından ilham alınmıştır.

## 📦 Kurulum

### HACS ile (Önerilen)
1. HACS > Entegrasyonlar > 3 nokta > Özel Depo Ekle
2. URL: `https://github.com/korkuttum/xiaomi_air_purifier_card`
3. Kategori: `Lovelace`
4. Kurulumu onaylayın ve Home Assistant'ı yeniden başlatın

### Manuel Kurulum
1. `custom_components/xiaomi_air_purifier_card/` klasörünü oluşturun
2. Tüm dosyaları bu klasöre kopyalayın
3. Home Assistant'ı yeniden başlatın

## 🚀 Kullanım

```yaml
type: custom:xiaomi-air-purifier-card
entity: fan.xiaomi_air_purifier
