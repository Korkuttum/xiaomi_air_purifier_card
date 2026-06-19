import os
import logging
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.core import HomeAssistant
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
    
    # Kartı frontend'e ekle
    local_path = f"/{DOMAIN}/purifier-card.js"
    add_extra_js_url(hass, local_path)
    
    _LOGGER.info("Xiaomi Air Purifier Card başarıyla yüklendi!")
    return True
