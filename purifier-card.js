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
      throw new Error("Please specify a fan entity!");
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

  // PM2.5 değerini cihazın kendi ekranındaki gibi 3 haneli, sıfır dolgulu
  // formatta gösterir (5 -> "005", 15 -> "015", 112 -> "112").
  _formatPM(value) {
    if (value === "--" || value === undefined || value === null) return "--";
    const num = Number(value);
    if (Number.isNaN(num)) return "--";
    return Math.round(num).toString().padStart(3, "0");
  }

  render() {
    const fanState = this._hass?.states[this.entity];
    if (!fanState) {
      this.innerHTML = `
        <ha-card style="padding: 12px; color: var(--warning-color);">
          ⏳ Loading ${this.entity}...
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
    const pm25Display = this._formatPM(pm25);
    const temperature = temperatureData.value;
    const humidity = humidityData.value;

    const pmColor = this._getPMColor(pm25);
    const pmStatus = this._getPMStatus(pm25);

    const modeSteps = this._getModeSteps(attrs);
    const currentStepIndex = this._getCurrentStepIndex(modeSteps, attrs);

    // Cycle tuşuna basıldığında hedeflenen adımı (_pendingStep) entity'nin
    // kendi durumu o adıma ulaşana kadar (veya bir zaman aşımına kadar)
    // göstererek, "Favorite'ten sonra geçici olarak yanlış seviye görünmesi"
    // gibi yarış durumu kaynaklı kararsızlıkları önlüyoruz: cihazın
    // preset_mode'u güncellense de percentage attribute'u henüz hedefe
    // ulaşmamışken en yakın seviyeyi bulma mantığı (Manual1/2/3 arasından)
    // yanlışlıkla başka bir seviyeyi seçebiliyordu.
    let activeStep;
    if (this._pendingStep) {
      const pending = this._pendingStep;
      const presetMatches =
        (attrs.preset_mode || "").toString().toLowerCase() ===
        pending.presetMode;
      const percentageMatches =
        pending.percentage === null ||
        pending.percentage === undefined ||
        (typeof attrs.percentage === "number" &&
          Math.abs(attrs.percentage - pending.percentage) <= 1);
      const expired = Date.now() - pending.ts > 8000;
      if ((presetMatches && percentageMatches) || expired) {
        this._pendingStep = null;
        activeStep =
          currentStepIndex !== -1 ? modeSteps[currentStepIndex] : null;
      } else {
        activeStep = pending;
      }
    } else {
      activeStep = currentStepIndex !== -1 ? modeSteps[currentStepIndex] : null;
    }
    if (!activeStep) {
      activeStep = { presetMode: attrs.preset_mode || attrs.mode || "auto" };
    }
    const modeGlyphHtml = this._renderModeGlyph(activeStep);

    // Fan ikonu, cihazın gerçek hızına (percentage) göre döner: düşük hızda
    // yavaş, yüksek hızda hızlı. percentage bilgisi yoksa (örn. sadece preset
    // modlu basit cihazlar) orta bir hız varsayılır.
    let fanSpinDuration = "2.2s";
    if (state === "on") {
      const pct =
        typeof attrs.percentage === "number" ? attrs.percentage : 50;
      const duration = 3.4 - (Math.max(0, Math.min(100, pct)) / 100) * 2.6;
      fanSpinDuration = `${Math.max(0.8, duration).toFixed(2)}s`;
    }

    this.innerHTML = `
      <style>
        @keyframes xiaomi-ha-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
      <ha-card style="
        padding: 4px 12px;
        cursor: pointer;
        box-sizing: border-box;
        height: 100%;
      ">
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 100%;
        ">
          <!-- 1. Power toggle (mdi:fan, hıza göre dönen yeşil / sabit gri) -->
          <div
            data-action="toggle"
            style="
              flex-shrink: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              width: 32px;
              height: 32px;
              border-radius: 50%;
              box-sizing: border-box;
              cursor: pointer;
              background: ${state === "on" ? "rgba(76, 175, 80, 0.12)" : "rgba(var(--rgb-secondary-text-color), 0.06)"};
            "
          >
            <ha-icon icon="mdi:fan" style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 18px;
              height: 18px;
              --mdc-icon-size: 18px;
              color: ${state === "on" ? "#4CAF50" : "var(--secondary-text-color)"};
              animation: ${state === "on" ? `xiaomi-ha-spin ${fanSpinDuration} linear infinite` : "none"};
            "></ha-icon>
          </div>

          <!-- 2. PM2.5 (large) -->
          <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            flex: 1;
            min-width: 0;
          ">
            <span style="
              font-size: 26px;
              font-weight: 500;
              color: ${pmColor};
              line-height: 1.1;
              letter-spacing: 0px;
              font-variant-numeric: tabular-nums;
            ">${pm25Display}</span>
            <span style="
              font-size: 9px;
              margin-top: 3px;
              color: var(--secondary-text-color);
            ">${pm25Data.unit}</span>
          </div>

          <!-- 3. Temperature + humidity -->
          <div style="
            display: flex;
            flex-direction: column;
            gap: 1px;
            flex-shrink: 0;
            width: 38px;
            box-sizing: border-box;
          ">
            <div style="
              display: flex;
              align-items: center;
              gap: 2px;
              font-size: 12px;
              color: var(--primary-text-color);
              font-weight: 400;
            ">
              <ha-icon icon="mdi:thermometer" style="
                --mdc-icon-size: 13px;
                color: var(--secondary-text-color);
              "></ha-icon>
              <span>${temperature}${temperatureData.unit === "°" ? "°" : ""}</span>
            </div>
            <div style="
              display: flex;
              align-items: center;
              gap: 2px;
              font-size: 12px;
              color: var(--primary-text-color);
              font-weight: 400;
            ">
              <ha-icon icon="mdi:water-percent" style="
                --mdc-icon-size: 13px;
                color: var(--secondary-text-color);
              "></ha-icon>
              <span>${humidity}${humidityData.unit === "%" ? "%" : ""}</span>
            </div>
          </div>

          <!-- 4 + 5. Mode indicator + Cycle mode (yakın çift olarak gruplandı) -->
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2px;
            flex-shrink: 0;
          ">
            <div style="
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
              width: 32px;
              height: 32px;
              box-sizing: border-box;
            ">${modeGlyphHtml}</div>

            <div
              data-action="cycle"
              style="
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                box-sizing: border-box;
                cursor: pointer;
                background: rgba(var(--rgb-secondary-text-color), 0.06);
              "
            >
              <ha-icon icon="mdi:swap-horizontal" style="
                display: flex;
                align-items: center;
                justify-content: center;
                width: 18px;
                height: 18px;
                --mdc-icon-size: 18px;
                color: var(--secondary-text-color);
              "></ha-icon>
            </div>
          </div>
        </div>
      </ha-card>`;
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
    if (num <= 12) return "Good";
    if (num <= 35) return "Moderate";
    if (num <= 55) return "Sensitive";
    if (num <= 150) return "Poor";
    return "Very Poor";
  }

  // Mod göstergesinde metin yerine sembol kullanıyoruz: Auto -> "A",
  // Sleep -> hilal (ay) ikonu, Favorite -> kalp ikonu, tanımadığımız başka
  // bir preset adı için ismin baş harfi. "Manual" gibi seviyeli bir adımda
  // (step.level varsa) sayı yerine seviyeye göre 1/2/3 dalgalı (wavy) çizgi
  // çiziyoruz. Tüm semboller, güç düğmesiyle aynı stilde bir daire
  // (circle) içine alınıp ortalanır.
  _renderModeGlyph(step) {
    if (!step) return "";

    const circleStart = `<div style="
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      box-sizing: border-box;
      background: rgba(var(--rgb-secondary-text-color), 0.06);
    ">`;
    const circleEnd = `</div>`;

    if (step.level) {
      // Tek bir dalgalı çizgi (mini sinüs eğrisi), seviye sayısı kadar üst üste.
      const wave = `<svg width="12" height="5" viewBox="0 0 12 5" style="display:block; margin:0.5px 0;">
        <path d="M1 2.5 Q 3 0.5, 6 2.5 T 11 2.5" stroke="var(--primary-text-color)" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      </svg>`;
      return `${circleStart}<div style="display:flex; flex-direction:column; align-items:center; justify-content:center;">${wave.repeat(step.level)}</div>${circleEnd}`;
    }

    const preset = (step.presetMode || "").toString().toLowerCase();
    if (preset === "sleep") {
      return `${circleStart}<ha-icon icon="mdi:moon-waning-crescent" style="display:flex; align-items:center; justify-content:center; width:16px; height:16px; --mdc-icon-size:16px; color:var(--primary-text-color);"></ha-icon>${circleEnd}`;
    }
    if (preset === "favorite") {
      return `${circleStart}<ha-icon icon="mdi:heart" style="display:flex; align-items:center; justify-content:center; width:16px; height:16px; --mdc-icon-size:16px; color:var(--primary-text-color);"></ha-icon>${circleEnd}`;
    }
    const source = (step.presetMode || step.label || "?").toString();
    const letter = source.charAt(0).toUpperCase() || "?";
    return `${circleStart}<span style="font-size:15px; font-weight:700; color:var(--primary-text-color); line-height:1;">${letter}</span>${circleEnd}`;
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
            level: idx + 1,
            // Cihazın speed_list'teki ismi ne olursa olsun (Level1, Gear1,
            // vb.) ekranda sade bir sıra numarası gösteriyoruz: 1, 2, 3...
            label: `${idx + 1}`,
          });
        });
      } else if (isManualLike && percentageStep && percentageStep > 0) {
        const levels = Math.max(1, Math.round(100 / percentageStep));
        for (let i = 1; i <= levels; i++) {
          steps.push({
            presetMode: pm,
            percentage: Math.floor((i * 100) / levels),
            level: i,
            label: `${i}`,
          });
        }
      } else {
        steps.push({
          presetMode: pm,
          percentage: null,
          label: pm.toString().toUpperCase(),
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
          level: idx + 1,
          label: `${idx + 1}`,
        });
      });
    } else if (!steps.length && percentageStep) {
      const levels = Math.max(1, Math.round(100 / percentageStep));
      for (let i = 1; i <= levels; i++) {
        steps.push({
          presetMode: null,
          percentage: Math.floor((i * 100) / levels),
          level: i,
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

  // Sections (grid) görünümünde kart eklendiğinde varsayılan boyut.
  // Kullanıcı kart yapılandırmasında kendi grid_options'ını verirse o öncelikli
  // olur; bu sadece HA'nın önerdiği başlangıç değeridir.
  getGridOptions() {
    return {
      columns: 6,
      rows: 1,
      min_columns: 4,
      max_columns: 12,
    };
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
        <ha-entity-picker id="entity_picker" label="Fan / Air Purifier (required)"></ha-entity-picker>
        <ha-entity-picker id="pm25_picker" label="PM2.5 Sensor (optional)"></ha-entity-picker>
        <ha-entity-picker id="temperature_picker" label="Temperature Sensor (optional)"></ha-entity-picker>
        <ha-entity-picker id="humidity_picker" label="Humidity Sensor (optional)"></ha-entity-picker>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <label style="font-size:13px; color: var(--primary-text-color);">
            Mode Cycle Order (optional)
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
            The order the cycle button steps through. Enter the
            <code>preset_modes</code> names from your entity's attributes,
            separated by commas (case sensitive). A mode named "Manual" is
            automatically split into sub-levels (Manual1, Manual2, ...) if
            the entity reports a <code>percentage_step</code>. Leave empty to
            use the entity's own order.
          </div>
        </div>
        <div style="font-size:12px; color: var(--secondary-text-color);">
          If you don't select temperature/humidity/PM2.5 sensors, the card
          tries to read this data from the fan entity's own attributes
          (some integrations expose it there, others as separate sensor
          entities).
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
  description: "Minimalist tile card for Xiaomi air purifiers",
});
