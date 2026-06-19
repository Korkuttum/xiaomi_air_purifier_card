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
      this.innerHTML = `<ha-card style="padding: 12px; color: var(--warning-color);">⏳ ${this.entity} yükleniyor...</ha-card>`;
      return;
    }

    const state = fanState.state;
    const attrs = fanState.attributes || {};

    const pm25Data = this._readValue(this.pm25Entity, attrs.pm25 || attrs.aqi || attrs.air_quality, "µg/m³");
    const temperatureData = this._readValue(this.temperatureEntity, attrs.temperature || attrs.temp, "°");
    const humidityData = this._readValue(this.humidityEntity, attrs.humidity, "%");

    const pm25 = pm25Data.value;
    const temperature = temperatureData.value;
    const humidity = humidityData.value;

    const pmColor = this._getPMColor(pm25);
    const pmStatus = this._getPMStatus(pm25);

    const modeSteps = this._getModeSteps(attrs);
    const currentStepIndex = this._getCurrentStepIndex(modeSteps, attrs);
    const modeDisplay = currentStepIndex !== -1 
      ? modeSteps[currentStepIndex].label 
      : this._getModeDisplay(attrs.preset_mode || attrs.mode || "auto");

    this.innerHTML = `
      <ha-card style="padding: 12px 16px; border-radius: 16px; background: var(--card-background-color); box-shadow: var(--ha-card-box-shadow); min-height: 80px; cursor: pointer; transition: all 0.2s ease;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 100%;">
          <!-- Power -->
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <ha-icon-button data-action="toggle" style="color: ${state === "on" ? "var(--primary-color)" : "var(--secondary-text-color)"}; --mdc-icon-button-size: 42px; background: ${state === "on" ? "rgba(var(--rgb-primary-color), 0.12)" : "rgba(var(--rgb-secondary-text-color), 0.06)"}; border-radius: 50%; padding: 6px; width: 42px; height: 42px;">
              <ha-icon icon="${state === "on" ? "mdi:power" : "mdi:power-off"}"></ha-icon>
            </ha-icon-button>
            <span style="font-size: 9px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.3px; font-weight: 500;">${state === "on" ? "AÇIK" : "KAPALI"}</span>
          </div>

          <!-- PM2.5 -->
          <div style="display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 60px;">
            <span style="font-size: 34px; font-weight: 700; color: ${pmColor}; line-height: 1.1; letter-spacing: -0.5px;">${pm25}</span>
            <div style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--secondary-text-color);">
              <span>${pm25Data.unit}</span>
              <span style="padding: 0 6px; border-radius: 8px; background: ${pmColor}22; color: ${pmColor}; font-weight: 600; font-size: 9px;">${pmStatus}</span>
            </div>
          </div>

          <!-- Temp + Hum -->
          <div style="display: flex; flex-direction: column; gap: 1px; min-width: 38px;">
            <div style="display: flex; align-items: center; gap: 2px; font-size: 14px; color: var(--primary-text-color); font-weight: 500;">
              🌡️ <span>${temperature}${temperatureData.unit === "°" ? "°" : ""}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 2px; font-size: 14px; color: var(--primary-text-color); font-weight: 500;">
              💧 <span>${humidity}${humidityData.unit === "%" ? "%" : ""}</span>
            </div>
          </div>

          <!-- Mode -->
          <div style="display: flex; flex-direction: column; align-items: center; min-width: 44px;">
            <span style="font-size: 17px; font-weight: 700; color: var(--primary-text-color); line-height: 1.1; white-space: nowrap;">${modeDisplay}</span>
            <span style="font-size: 8px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600;">MOD</span>
          </div>

          <!-- Cycle -->
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <ha-icon-button data-action="cycle" style="color: var(--secondary-text-color); --mdc-icon-button-size: 42px; background: rgba(var(--rgb-secondary-text-color), 0.06); border-radius: 50%; padding: 6px; width: 42px; height: 42px;">
              <ha-icon icon="mdi:sync"></ha-icon>
            </ha-icon-button>
            <span style="font-size: 8px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600;">DEĞİŞTİR</span>
          </div>
        </div>
      </ha-card>
    `;
  }

  _getPMColor(value) {
    if (value === "--" || value === undefined || value === null) return "var(--secondary-text-color)";
    const num = Number(value);
    if (Number.isNaN(num)) return "var(--secondary-text-color)";
    if (num <= 12) return "#4CAF50";
    if (num <= 35) return "#FFC107";
    if (num <= 55) return "#FF9800";
    if (num <= 150) return "#F44336";
    return "#9C27B0";
  }

  _getPMStatus(value) {
    if (value === "--" || value === undefined || value === null) return "--";
    const num = Number(value);
    if (Number.isNaN(num)) return "--";
    if (num <= 12) return "İyi";
    if (num <= 35) return "Orta";
    if (num <= 55) return "Hassas";
    if (num <= 150) return "Kötü";
    return "Çok Kötü";
  }

  _getModeDisplay(mode) {
    if (!mode) return "?";
    return mode.toString().slice(0, 4).toUpperCase();
  }

  // ====================== DÜZELTİLMİŞ MOD SİSTEMİ ======================
  _getModeSteps(attrs) {
    let order = this.config?.mode_order?.length 
      ? this.config.mode_order 
      : (attrs.preset_modes || []);

    const speedList = attrs.speed_list || [];
    const percentageStep = attrs.percentage_step || 0;
    const steps = [];

    order.forEach((pm) => {
      const pmLower = pm.toString().toLowerCase();

      if (!["manual", "favourite", "favorite"].includes(pmLower)) {
        steps.push({
          presetMode: pm,
          percentage: null,
          label: pm.toString().slice(0, 4).toUpperCase(),
        });
        return;
      }

      // Seviyeli mod (Manual / Favorite)
      if (speedList.length > 0) {
        const stepSize = percentageStep > 0 ? percentageStep : (100 / speedList.length);
        speedList.forEach((levelName, idx) => {
          let percentage = Math.round(stepSize * (idx + 1));
          if (idx === speedList.length - 1) percentage = 100; // Son seviye kesin 100
          
          steps.push({
            presetMode: pm,
            percentage: percentage,
            label: levelName.toString().toUpperCase(),
          });
        });
      } 
      else if (percentageStep > 0) {
        const levels = Math.max(1, Math.round(100 / percentageStep));
        for (let i = 1; i <= levels; i++) {
          let percentage = Math.round(percentageStep * i);
          if (i === levels) percentage = 100;
          
          steps.push({
            presetMode: pm,
            percentage: percentage,
            label: `${pm.toString().slice(0, 3).toUpperCase()}${i}`,
          });
        }
      } 
      else {
        steps.push({
          presetMode: pm,
          percentage: null,
          label: pm.toString().slice(0, 4).toUpperCase(),
        });
      }
    });

    // Fallback
    if (steps.length === 0 && speedList.length > 0) {
      const stepSize = percentageStep > 0 ? percentageStep : (100 / speedList.length);
      speedList.forEach((levelName, idx) => {
        let percentage = Math.round(stepSize * (idx + 1));
        if (idx === speedList.length - 1) percentage = 100;
        steps.push({
          presetMode: "Manual",
          percentage: percentage,
          label: levelName.toString().toUpperCase(),
        });
      });
    }

    return steps;
  }

  _getCurrentStepIndex(steps, attrs) {
    if (!steps.length) return -1;

    const currentPreset = (attrs.preset_mode || "").toString().toLowerCase();
    const currentPercentage = attrs.percentage || 0;

    // Tam eşleşme + tolerance
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if ((s.presetMode || "").toString().toLowerCase() === currentPreset) {
        if (s.percentage === null) return i;
        const diff = Math.abs((s.percentage || 0) - currentPercentage);
        if (diff <= 18) return i;   // 33.33 step için geniş tolerance
      }
    }

    // En yakın yüzde
    let bestIndex = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < steps.length; i++) {
      const diff = Math.abs((steps[i].percentage || 0) - currentPercentage);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  _togglePower() {
    this._hass.callService("fan", "toggle", { entity_id: this.entity });
  }

  _cycleMode() {
    const entity = this._hass.states[this.entity];
    const attrs = entity?.attributes || {};
    const steps = this._getModeSteps(attrs);

    if (!steps.length) {
      const fallback = ["auto", "sleep", "favorite", "manual"];
      const current = (attrs.preset_mode || attrs.mode || "auto").toLowerCase();
      let idx = fallback.indexOf(current);
      if (idx === -1) idx = 0;
      this._hass.callService("fan", "set_preset_mode", {
        entity_id: this.entity,
        preset_mode: fallback[(idx + 1) % fallback.length],
      });
      return;
    }

    const currentIndex = this._getCurrentStepIndex(steps, attrs);
    const nextIndex = (currentIndex + 1) % steps.length;
    const next = steps[nextIndex];

    if (next.presetMode) {
      this._hass.callService("fan", "set_preset_mode", {
        entity_id: this.entity,
        preset_mode: next.presetMode,
      });
    }
    if (next.percentage !== null && next.percentage !== undefined) {
      this._hass.callService("fan", "set_percentage", {
        entity_id: this.entity,
        percentage: next.percentage,
      });
    }
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
    if (this.config) this.render();
  }

  getCardSize() {
    return 2;
  }
}

// ====================== EDITOR ======================
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
        
        <div style="display:flex; flex-direction:column; gap:4px;">
          <label style="font-size:13px; color: var(--primary-text-color);">Mod Döngü Sırası (opsiyonel)</label>
          <input id="mode_order_input" type="text" placeholder="Auto, Sleep, Favorite, Manual" style="padding:10px 12px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); font-size:14px;"/>
        </div>
      </div>
    `;

    this._rendered = true;
    this._entityPicker = this.querySelector("#entity_picker");
    this._pm25Picker = this.querySelector("#pm25_picker");
    this._temperaturePicker = this.querySelector("#temperature_picker");
    this._humidityPicker = this.querySelector("#humidity_picker");
    this._modeOrderInput = this.querySelector("#mode_order_input");

    this._entityPicker.includeDomains = ["fan"];
    this._pm25Picker.includeDomains = ["sensor"];
    this._temperaturePicker.includeDomains = ["sensor"];
    this._humidityPicker.includeDomains = ["sensor"];

    this._entityPicker.addEventListener("value-changed", (e) => this._valueChanged("entity", e));
    this._pm25Picker.addEventListener("value-changed", (e) => this._valueChanged("pm25_entity", e));
    this._temperaturePicker.addEventListener("value-changed", (e) => this._valueChanged("temperature_entity", e));
    this._humidityPicker.addEventListener("value-changed", (e) => this._valueChanged("humidity_entity", e));
    this._modeOrderInput.addEventListener("change", (e) => this._modeOrderChanged(e));

    this._updatePickers();
  }

  _updatePickers() {
    if (!this._rendered || !this._hass) return;
    [this._entityPicker, this._pm25Picker, this._temperaturePicker, this._humidityPicker].forEach(p => {
      if (p) p.hass = this._hass;
    });

    if (this._entityPicker) this._entityPicker.value = this._config?.entity || "";
    if (this._pm25Picker) this._pm25Picker.value = this._config?.pm25_entity || "";
    if (this._temperaturePicker) this._temperaturePicker.value = this._config?.temperature_entity || "";
    if (this._humidityPicker) this._humidityPicker.value = this._config?.humidity_entity || "";
    if (this._modeOrderInput && document.activeElement !== this._modeOrderInput) {
      this._modeOrderInput.value = (this._config?.mode_order || []).join(", ");
    }
  }

  _modeOrderChanged(ev) {
    const list = (ev.target.value || "").split(",").map(s => s.trim()).filter(s => s.length > 0);
    const newConfig = { ...this._config };
    if (list.length) newConfig.mode_order = list;
    else delete newConfig.mode_order;
    this._config = newConfig;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: newConfig }, bubbles: true, composed: true }));
  }

  _valueChanged(key, ev) {
    const newConfig = { ...this._config };
    if (ev.detail.value) newConfig[key] = ev.detail.value;
    else delete newConfig[key];
    this._config = newConfig;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: newConfig }, bubbles: true, composed: true }));
  }
}

customElements.define("xiaomi-air-purifier-card", XiaomiAirPurifierCard);
customElements.define("xiaomi-air-purifier-card-editor", XiaomiAirPurifierCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "xiaomi-air-purifier-card",
  name: "Xiaomi Air Purifier Card",
  preview: true,
  description: "Xiaomi hava temizleyici için geliştirilmiş kart",
});
