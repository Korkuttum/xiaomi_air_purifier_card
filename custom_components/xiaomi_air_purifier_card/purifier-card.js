class XiaomiAirPurifierCard extends HTMLElement {
  static getStubConfig() {
    return {
      entity: "fan.xiaomi_air_purifier",
    };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Lütfen bir entity belirtin!");
    }
    this.config = config;
    this.entity = config.entity;

    // Olay dinleyicisini sadece bir kez bağla (event delegation).
    // Önceki sürüm @click="${...}" (lit-html sözdizimi) kullanıyordu ama
    // innerHTML ile render edildiği için hiçbir tıklama çalışmıyordu.
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

  render() {
    const entityState = this._hass?.states[this.entity];
    if (!entityState) {
      this.innerHTML = `
        <ha-card style="padding: 12px; color: var(--warning-color);">
          ⏳ ${this.entity} yükleniyor...
        </ha-card>
      `;
      return;
    }

    const state = entityState.state;
    const attrs = entityState.attributes || {};

    // Verileri al - entity attribute isimlerine göre ayarlayın
    const pm25 = attrs.pm25 || attrs.aqi || attrs.air_quality || "--";
    const temperature = attrs.temperature || attrs.temp || "--";
    const humidity = attrs.humidity || "--";
    const mode = attrs.mode || attrs.preset_mode || "auto";

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
              <span>µg/m³</span>
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
              <span>${temperature}°</span>
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
              <span>${humidity}%</span>
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
    const currentMode = entity.attributes.mode || entity.attributes.preset_mode || "auto";

    // Mod döngüsü - cihazınıza göre ayarlayın
    const modeCycle = ["auto", "silent", "medium", "high"];
    let currentIndex = modeCycle.indexOf(currentMode);
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

// Kartı tanımla
customElements.define("xiaomi-air-purifier-card", XiaomiAirPurifierCard);

// HACS ve Lovelace kart seçici (Add Card / Önizleme) için kaydet
window.customCards = window.customCards || [];
window.customCards.push({
  type: "xiaomi-air-purifier-card",
  name: "Xiaomi Air Purifier Card",
  preview: true,
  description: "Xiaomi hava temizleyiciler için minimalist tile kart",
});
