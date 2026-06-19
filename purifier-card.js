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

    const pm25 = pm25Data.value;
    const temperature = temperatureData.value;
    const humidity = humidityData.value;

    const pmColor = this._getPMColor(pm25);
    const pmStatus = this._getPMStatus(pm25);

    const modeSteps = this._getModeSteps(attrs);
    const currentStepIndex = this._getCurrentStepIndex(modeSteps, attrs);
    const modeDisplay =
      currentStepIndex !== -1
        ? modeSteps[currentStepIndex].label
        : this._getModeDisplay(attrs.preset_mode || attrs.mode || "auto");

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
            min-width: 44px;
          ">
            <span style="
              font-size: 17px;
              font-weight: 700;
              color: var(--primary-text-color);
              line-height: 1.1;
              white-space: nowrap;
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
    // Marka/modele göre sabit bir çeviri sözlüğüne bakmıyoruz; entity hangi
    // mod adını veriyorsa (Auto, Sleep, Favorite, Manual, ya da başka
    // herhangi bir şey) doğrudan ondan kısa bir etiket türetiyoruz.
    if (!mode) return "?";
    return mode.toString().slice(0, 3).toUpperCase();
  }

  // Döngü tuşunun geçeceği adımları üretir. Varsayılan olarak entity'nin
  // kendi preset_modes sırasını kullanır; kart yapılandırmasında mode_order
  // verilmişse onu kullanır (sıra entity'de farklıysa, örn. "Favorite"
  // "Manual"dan önce geliyorsa, istediğiniz sırayı burada belirtebilirsiniz).
  // "Manual" gibi bir preset, entity'nin kendi speed_list attribute'u
  // (örn. Level1, Level2, Level3) varsa doğrudan o isimlerle ve o sayıda
  // alt adıma bölünür. speed_list yoksa percentage_step'ten hesaplanır.
  // Not: HA'nın eski fan.set_speed servisi kaldırıldığı için kontrol yine
  // fan.set_percentage ile yapılır; speed_list sadece etiketleme/eşleme
  // amacıyla, HA'nın kendi ordered_list_item_to_percentage mantığıyla
  // aynı şekilde percentage'e çevrilerek kullanılır.
  _getModeSteps(attrs) {
    const order =
      this.config?.mode_order && this.config.mode_order.length
        ? this.config.mode_order
        : attrs.preset_modes || [];
    const speedList =
      attrs.speed_list && attrs.speed_list.length ? attrs.speed_list : null;
    const percentageStep = attrs.percentage_step;
    const steps = [];

    order.forEach((pm) => {
      const isManualLike = pm.toString().toLowerCase() === "manual";
      if (isManualLike && speedList) {
        // HA'nın ordered_list_item_to_percentage mantığı tam sayı bölmesi
        // (floor) kullanır: `list_position * 100 // list_len`. Burada
        // Math.round kullanmak, bazı uzunluklarda (örn. 3 seviye) bir üst
        // seviyenin sınırını aşan bir yüzde üretir (Level2 = round(66.67) =
        // 67 ama HA'nın üst sınırı 66'dır), bu da set_percentage çağrıldığında
        // gerçek cihazın bir sonraki seviyeye değil ondan sonrakine
        // atlamasına yol açar. Math.floor, HA ile birebir aynı sınırı verir.
        const listLen = speedList.length;
        speedList.forEach((levelName, idx) => {
          const percentage = percentageStep && percentageStep > 0
            ? Math.floor(percentageStep * (idx + 1))
            : Math.floor(((idx + 1) * 100) / listLen);
          steps.push({
            presetMode: pm,
            percentage,
            label: levelName.toString().toUpperCase(),
          });
        });
      } else if (isManualLike && percentageStep && percentageStep > 0) {
        const levels = Math.max(1, Math.round(100 / percentageStep));
        for (let i = 1; i <= levels; i++) {
          steps.push({
            presetMode: pm,
            percentage: Math.floor((i * 100) / levels),
            label: `${pm.toString().slice(0, 3).toUpperCase()}${i}`,
          });
        }
      } else {
        steps.push({
          presetMode: pm,
          percentage: null,
          label: pm.toString().slice(0, 3).toUpperCase(),
        });
      }
    });

    // preset_modes hiç yoksa ama speed_list / percentage_step bildiren
    // basit bir fan ise (preset kavramı olmadan doğrudan seviyeli)
    if (!steps.length && speedList) {
      const listLen = speedList.length;
      speedList.forEach((levelName, idx) => {
        const percentage = percentageStep && percentageStep > 0
          ? Math.floor(percentageStep * (idx + 1))
          : Math.floor(((idx + 1) * 100) / listLen);
        steps.push({
          presetMode: null,
          percentage,
          label: levelName.toString().toUpperCase(),
        });
      });
    } else if (!steps.length && percentageStep) {
      const levels = Math.max(1, Math.round(100 / percentageStep));
      for (let i = 1; i <= levels; i++) {
        steps.push({
          presetMode: null,
          percentage: Math.floor((i * 100) / levels),
          label: `${i}`,
        });
      }
    }

    return steps;
  }

  // Mevcut durumun (preset_mode + percentage) yukarıdaki adımlardan
  // hangisine karşılık geldiğini bulur.
  _getCurrentStepIndex(steps, attrs) {
    const currentPreset = (attrs.preset_mode || "").toString().toLowerCase();
    const currentPercentage = attrs.percentage;

    const candidates = steps
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s }) => (s.presetMode || "").toString().toLowerCase() === currentPreset
      );

    if (!candidates.length) return -1;
    if (candidates.length === 1) return candidates[0].i;

    // Aynı preset'e ait birden fazla seviye varsa (Manual1/2/3 gibi),
    // mevcut yüzdeye en yakın olanı seç.
    let best = candidates[0];
    let bestDiff = Math.abs((best.s.percentage ?? 0) - (currentPercentage ?? 0));
    candidates.forEach((c) => {
      const diff = Math.abs((c.s.percentage ?? 0) - (currentPercentage ?? 0));
      if (diff < bestDiff) {
        best = c;
        bestDiff = diff;
      }
    });
    return best.i;
  }

  _togglePower() {
    this._hass.callService("fan", "toggle", { entity_id: this.entity });
  }

  _cycleMode() {
    const entity = this._hass.states[this.entity];
    const attrs = entity?.attributes || {};
    const steps = this._getModeSteps(attrs);

    if (!steps.length) {
      // Hiç preset_modes / percentage_step bilgisi olmayan basit cihazlar
      // için son çare: jenerik bir sabit liste.
      const fallback = ["auto", "silent", "medium", "high"];
      const current = (attrs.preset_mode || attrs.mode || "auto").toLowerCase();
      let idx = fallback.indexOf(current);
      if (idx === -1) idx = 0;
      const next = fallback[(idx + 1) % fallback.length];
      this._hass.callService("fan", "set_preset_mode", {
        entity_id: this.entity,
        preset_mode: next,
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
        <div style="display:flex; flex-direction:column; gap:4px;">
          <label style="font-size:13px; color: var(--primary-text-color);">
            Mod Döngü Sırası (opsiyonel)
          </label>
          <input id="mode_order_input" type="text" placeholder="Auto, Sleep, Manual, Favorite" style="
            padding:10px 12px;
            border-radius:6px;
            border:1px solid var(--divider-color, #ccc);
            background: var(--card-background-color);
            color: var(--primary-text-color);
            font-size:14px;
          " />
          <div style="font-size:12px; color: var(--secondary-text-color);">
            Mod tuşuna basıldığında dolaşılacak sıra. Entity'nizin attribute
            listesindeki <code>preset_modes</code> isimlerini virgülle ayırarak
            yazın (büyük/küçük harf önemli). "Manual" gibi bir mod, entity
            <code>percentage_step</code> bildiriyorsa otomatik olarak alt
            seviyelere (Manual1, Manual2, ...) bölünür. Boş bırakırsanız
            entity'nin kendi sırası kullanılır.
          </div>
        </div>
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
    this._modeOrderInput = this.querySelector("#mode_order_input");

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
    this._modeOrderInput.addEventListener("change", (e) =>
      this._modeOrderChanged(e)
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
    if (this._modeOrderInput && document.activeElement !== this._modeOrderInput) {
      this._modeOrderInput.value = (this._config?.mode_order || []).join(", ");
    }
  }

  _modeOrderChanged(ev) {
    const raw = ev.target.value || "";
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const newConfig = { ...this._config };
    if (list.length) {
      newConfig.mode_order = list;
    } else {
      delete newConfig.mode_order;
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
