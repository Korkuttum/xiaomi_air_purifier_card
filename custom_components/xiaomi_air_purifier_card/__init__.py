import logging
import os
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

DOMAIN = "xiaomi_air_purifier_card"
VERSION = "1.0.0"

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema({
    DOMAIN: vol.Schema({}),
}, extra=vol.ALLOW_EXTRA)

async def async_setup(hass: HomeAssistant, config: dict):
    """Xiaomi Air Purifier Card'i başlat."""
    _LOGGER.info("Xiaomi Air Purifier Card v%s yükleniyor...", VERSION)
    
    # Kart dosyasının varlığını kontrol et
    js_path = hass.config.path(f"custom_components/{DOMAIN}/purifier-card.js")
    if os.path.exists(js_path):
        _LOGGER.info("purifier-card.js bulundu: %s", js_path)
        # Kartı frontend'e ekle
        add_extra_js_url(hass, f"/{DOMAIN}/purifier-card.js")
        _LOGGER.info("Xiaomi Air Purifier Card başarıyla yüklendi!")
    else:
        _LOGGER.error("purifier-card.js BULUNAMADI! Path: %s", js_path)
        return False
    
    return True
