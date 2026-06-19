class XiaomiAirPurifierCard extends HTMLElement {
  static getStubConfig() {
    return {
      entity: "fan.xiaomi_air_purifier",
    };
  }

  static getConfigElement() {
    return document.createElement("xiaomi-air-purifier-card-editor");
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Lütfen bir fan entity'si belirtin!");
    }
    this.config = config;
    this.entity = config.entity;
    this.pm25Entity = config.pm25_entity;
    this.temperatureEntity = config.temperature_entity;
    this.humidityEntity = config.humidity_entity;

    if (!this._listenersBound) {
      this.addEventListener("click", (e) => this._handleClick(e));
      this._listenersBound = true;
    }

    this.render();
  }

  _handleClick(e) {
    const actionTarget = e.target.closest("[data-action]");
    if (actionTarget) {
      e.stopPropagation();
      const action = actionTarget.dataset.action;
      if (action === "toggle") this._togglePower();
      if (action === "cycle") this._cycleMode();
      return;
    }
    this._openMoreInfo();
  }

  // Bir sensör entity'sinden ya da (verilmemişse) fan entity attribute'larından
  // değer + birim oku. Böylece hem ayrı sensör hem de eski "her şey fan
  // attribute'unda" kurulumları desteklenir.
  _readValue(separateEntityId, fallbackValue, fallbackUnit) {
    if (separateEntityId) {
      const st = this._hass?.states[separateEntityId];
      if (st && st.state !== "unavailable" && st.state !== "unknown") {
        return {
          value: st.state,
          unit: st.attributes?.unit_of_measurement || fallbackUnit,
        };
      }
      return { value: "--", unit: fallbackUnit };
    }
    if (fallbackValue === undefined || fallbackValue === null) {
      return { value: "--", unit: fallbackUnit };
    }
    return { value: fallbackValue, unit: fallbackUnit };
  }

  render() {
    const fanState = this._hass?.states[this.entity];
    if (!fanState) {
      this.innerHTML = `
        <ha-card style="padding: 12px; color: var(--warning-color);">
          ⏳ ${this.entity} yükleniyor...
        </ha-card>
      `;
      return;
    }

    const state = fanState.state;
    const attrs = fanState.attributes || {};

    const pm25Data = this._readValue(
      this.pm25Entity,
      attrs.pm25 || attrs.aqi || attrs.air_quality,
      "µg/m³"
    );
    const temperatureData = this._readValue(
      this.temperatureEntity,
      attrs.temperature || attrs.temp,
      "°"
    );
    const humidityData = this._readValue(
      this.humidityEntity,
      attrs.humidity,
      "%"
    );

    const mode = attrs.preset_mode || attrs.mode || "auto";

    const pm25 = pm25Data.value;
    const temperature = temperatureData.value;
    const humidity = humidityData.value;

    const pmColor = this._getPMColor(pm25);
    const pmStatus = this._getPMStatus(pm25);
    const modeDisplay = this._getModeDisplay(mode);

    this.innerHTML = `
      <ha-card style="
        padding: 12px 16px;
        border-radius: 16px;
        background: var(--card-background-color);
        box-shadow: var(--ha-card-box-shadow);
        min-height: 80px;
        cursor: pointer;
        transition: all 0.2s ease;
      ">

        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          height: 100%;
        ">
          <!-- 1. Aç/Kapa Butonu -->
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <ha-icon-button
              data-action="toggle"
              style="
                color: ${state === "on" ? "var(--primary-color)" : "var(--secondary-text-color)"};
                --mdc-icon-button-size: 42px;
                background: ${state === "on" ? "rgba(var(--rgb-primary-color), 0.12)" : "rgba(var(--rgb-secondary-text-color), 0.06)"};
                border-radius: 50%;
                padding: 6px;
                width: 42px;
                height: 42px;
                transition: all 0.2s ease;
              "
            >
              <ha-icon icon="${state === "on" ? "mdi:power" : "mdi:power-off"}"></ha-icon>
            </ha-icon-button>
            <span style="
              font-size: 9px;
              color: var(--secondary-text-color);
              text-transform: uppercase;
              letter-spacing: 0.3px;
              font-weight: 500;
            ">${state === "on" ? "AÇIK" : "KAPALI"}</span>
          </div>

          <!-- 2. PM2.5 (Büyük) -->
          <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            flex: 1;
            min-width: 60px;
          ">
            <span style="
              font-size: 34px;
              font-weight: 700;
              color: ${pmColor};
              line-height: 1.1;
              letter-spacing: -0.5px;
            ">${pm25}</span>
            <div style="
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 10px;
              color: var(--secondary-text-color);
            ">
              <span>${pm25Data.unit}</span>
              <span style="
                padding: 0px 6px;
                border-radius: 8px;
                background: ${pmColor}22;
                color: ${pmColor};
                font-weight: 600;
                font-size: 9px;
              ">${pmStatus}</span>
            </div>
          </div>

          <!-- 3. Sıcaklık + Nem (Alt alta) -->
          <div style="
            display: flex;
            flex-direction: column;
            gap: 1px;
            min-width: 38px;
          ">
            <div style="
              display: flex;
              align-items: center;
              gap: 2px;
              font-size: 14px;
              color: var(--primary-text-color);
              font-weight: 500;
            ">
              <span style="font-size: 14px;">🌡️</span>
              <span>${temperature}${temperatureData.unit === "°" ? "°" : ""}</span>
            </div>
            <div style="
              display: flex;
              align-items: center;
              gap: 2px;
              font-size: 14px;
              color: var(--primary-text-color);
              font-weight: 500;
            ">
              <span style="font-size: 14px;">💧</span>
              <span>${humidity}${humidityData.unit === "%" ? "%" : ""}</span>
            </div>
          </div>

          <!-- 4. Mod Göstergesi -->
          <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            min-width: 32px;
          ">
            <span style="
              font-size: 26px;
              font-weight: 700;
              color: var(--primary-text-color);
              line-height: 1.1;
            ">${modeDisplay}</span>
            <span style="
              font-size: 8px;
              color: var(--secondary-text-color);
              text-transform: uppercase;
              letter-spacing: 0.3px;
              font-weight: 600;
            ">MOD</span>
          </div>

          <!-- 5. Mod Değiştir (Döngü Okları) -->
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <ha-icon-button
              data-action="cycle"
              style="
                color: var(--secondary-text-color);
                --mdc-icon-button-size: 42px;
                background: rgba(var(--rgb-secondary-text-color), 0.06);
                border-radius: 50%;
                padding: 6px;
                width: 42px;
                height: 42px;
                transition: all 0.2s ease;
              "
            >
              <ha-icon icon="mdi:sync"></ha-icon>
            </ha-icon-button>
            <span style="
              font-size: 8px;
              color: var(--secondary-text-color);
              text-transform: uppercase;
              letter-spacing: 0.3px;
              font-weight: 600;
            ">DEĞİŞTİR</span>
          </div>
        </div>
      </ha-card>
    `;
  }

  _getPMColor(value) {
    if (value === "--" || value === undefined || value === null) {
      return "var(--secondary-text-color)";
    }
    const num = Number(value);
    if (Number.isNaN(num)) return "var(--secondary-text-color)";
    if (num <= 12) return "#4CAF50";
    if (num <= 35) return "#FFC107";
    if (num <= 55) return "#FF9800";
    if (num <= 150) return "#F44336";
    return "#9C27B0";
  }

  _getPMStatus(value) {
    if (value === "--" || value === undefined || value === null) {
      return "--";
    }
    const num = Number(value);
    if (Number.isNaN(num)) return "--";
    if (num <= 12) return "İyi";
    if (num <= 35) return "Orta";
    if (num <= 55) return "Hassas";
    if (num <= 150) return "Kötü";
    return "Çok Kötü";
  }

  _getModeDisplay(mode) {
    const modeMap = {
      auto: "A",
      automatic: "A",
      silent: "1",
      sleep: "1",
      quiet: "1",
      medium: "2",
      normal: "2",
      high: "3",
      strong: "3",
      turbo: "3",
      favorite: "F",
      manual: "M",
    };
    return modeMap[mode?.toLowerCase()] || mode?.charAt(0).toUpperCase() || "A";
  }

  _togglePower() {
    this._hass.callService("fan", "toggle", { entity_id: this.entity });
  }

  _cycleMode() {
    const entity = this._hass.states[this.entity];
    const currentMode = entity.attributes.preset_mode || entity.attributes.mode || "auto";

    // Cihazın gerçek mod listesi varsa onu kullan (her Xiaomi modeli farklı
    // mod isimleri kullanabilir, örn. "Auto"/"Sleep"/"Favorite").
    const modeCycle = entity.attributes.preset_modes && entity.attributes.preset_modes.length
      ? entity.attributes.preset_modes
      : ["auto", "silent", "medium", "high"];

    let currentIndex = modeCycle.findIndex(
      (m) => m.toLowerCase() === currentMode.toLowerCase()
    );
    if (currentIndex === -1) currentIndex = 0;
    const nextIndex = (currentIndex + 1) % modeCycle.length;

    this._hass.callService("fan", "set_preset_mode", {
      entity_id: this.entity,
      preset_mode: modeCycle[nextIndex],
    });
  }

  _openMoreInfo() {
    const event = new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId: this.entity },
    });
    this.dispatchEvent(event);
  }

  set hass(hass) {
    this._hass = hass;
    if (this.config) {
      this.render();
    }
  }

  getCardSize() {
    return 2;
  }
}

// ---------------------------------------------------------------------
// Görsel yapılandırma editörü (Kart Ekle > Düzenle ekranında açılır)
// ---------------------------------------------------------------------
class XiaomiAirPurifierCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._updatePickers();
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    if (this._rendered) {
      this._updatePickers();
      return;
    }
    this.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px; padding:8px 2px;">
        <ha-entity-picker id="entity_picker" label="Fan / Hava Temizleyici (zorunlu)"></ha-entity-picker>
        <ha-entity-picker id="pm25_picker" label="PM2.5 Sensörü (opsiyonel)"></ha-entity-picker>
        <ha-entity-picker id="temperature_picker" label="Sıcaklık Sensörü (opsiyonel)"></ha-entity-picker>
        <ha-entity-picker id="humidity_picker" label="Nem Sensörü (opsiyonel)"></ha-entity-picker>
        <div style="font-size:12px; color: var(--secondary-text-color);">
          Sıcaklık/nem/PM2.5 sensörlerinizi seçmezseniz, kart bu verileri fan
          entity'sinin attribute'larından okumayı dener (bazı entegrasyonlarda
          orada bulunur, bazılarında ayrı sensör entity'si olarak gelir).
        </div>
      </div>
    `;
    this._rendered = true;

    this._entityPicker = this.querySelector("#entity_picker");
    this._pm25Picker = this.querySelector("#pm25_picker");
    this._temperaturePicker = this.querySelector("#temperature_picker");
    this._humidityPicker = this.querySelector("#humidity_picker");

    this._entityPicker.includeDomains = ["fan"];
    this._pm25Picker.includeDomains = ["sensor"];
    this._temperaturePicker.includeDomains = ["sensor"];
    this._humidityPicker.includeDomains = ["sensor"];

    this._entityPicker.addEventListener("value-changed", (e) =>
      this._valueChanged("entity", e)
    );
    this._pm25Picker.addEventListener("value-changed", (e) =>
      this._valueChanged("pm25_entity", e)
    );
    this._temperaturePicker.addEventListener("value-changed", (e) =>
      this._valueChanged("temperature_entity", e)
    );
    this._humidityPicker.addEventListener("value-changed", (e) =>
      this._valueChanged("humidity_entity", e)
    );

    this._updatePickers();
  }

  _updatePickers() {
    if (!this._rendered || !this._hass) return;
    [this._entityPicker, this._pm25Picker, this._temperaturePicker, this._humidityPicker].forEach(
      (p) => {
        if (p) p.hass = this._hass;
      }
    );
    if (this._entityPicker) this._entityPicker.value = this._config?.entity || "";
    if (this._pm25Picker) this._pm25Picker.value = this._config?.pm25_entity || "";
    if (this._temperaturePicker)
      this._temperaturePicker.value = this._config?.temperature_entity || "";
    if (this._humidityPicker)
      this._humidityPicker.value = this._config?.humidity_entity || "";
  }

  _valueChanged(key, ev) {
    ev.stopPropagation();
    const value = ev.detail.value;
    const newConfig = { ...this._config };
    if (value) {
      newConfig[key] = value;
    } else {
      delete newConfig[key];
    }
    this._config = newConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: newConfig },
        bubbles: true,
        composed: true,
      })
    );
  }
}

// Kartları tanımla
customElements.define("xiaomi-air-purifier-card", XiaomiAirPurifierCard);
customElements.define("xiaomi-air-purifier-card-editor", XiaomiAirPurifierCardEditor);

// HACS ve Lovelace kart seçici (Add Card / Önizleme) için kaydet
window.customCards = window.customCards || [];
window.customCards.push({
  type: "xiaomi-air-purifier-card",
  name: "Xiaomi Air Purifier Card",
  preview: true,
  description: "Xiaomi hava temizleyiciler için minimalist tile kart",
});
