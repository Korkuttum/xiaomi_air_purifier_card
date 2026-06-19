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

  // Bu kart bir grid/sections görünümünde büyütüldüğünde (örn. columns 9
  // veya 12'ye çıkarıldığında) elemanlar arasındaki boşluğu da orantılı
  // büyütmek için kartın gerçek genişliğini ölçüp bir ölçek katsayısı
  // üretiyoruz. Referans genişlik, varsayılan columns:6 boyutunda kartın
  // tipik genişliğidir; daha büyük kartlarda scale > 1 olur.
  _getScale() {
    const REFERENCE_WIDTH = 260; // columns:6 civarı tipik kart genişliği (px)
    const width = this.offsetWidth || REFERENCE_WIDTH;
    let scale = width / REFERENCE_WIDTH;
    scale = Math.max(0.85, Math.min(scale, 2.2));
    return scale;
  }

  render() {
    const fanState = this._hass?.states[this.entity];
    if (!fanState) {
      this.innerHTML = `
        <ha-card style="padding: 12px; color: var(--warning-color);">
          ⏳ Loading ${this.entity}...
        </ha-card>
      `;
      this._built = false;
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
      attrs.temperature ?? attrs.temp,
      "°C"
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

    const modeSteps = this._getModeSteps(attrs);
    const currentStepIndex = this._getCurrentStepIndex(modeSteps, attrs);

    // Cycle tuşuna basıldığında hedeflenen adımı (_pendingStep) entity'nin
    // kendi durumu o adıma ulaşana kadar (veya bir zaman aşımına kadar)
    // göstererek, "Favorite'ten sonra geçici olarak yanlış seviye görünmesi"
    // gibi yarış durumu kaynaklı kararsızlıkları önlüyoruz.
    let activeStepIndex;
    if (this._pendingStep) {
      const pending = this._pendingStep;
      const presetMatches =
        (attrs.preset_mode || "").toString().toLowerCase() ===
        pending.step.presetMode;
      const percentageMatches =
        pending.step.percentage === null ||
        pending.step.percentage === undefined ||
        (typeof attrs.percentage === "number" &&
          Math.abs(attrs.percentage - pending.step.percentage) <= 1);
      const expired = Date.now() - pending.ts > 8000;
      if ((presetMatches && percentageMatches) || expired) {
        this._pendingStep = null;
        activeStepIndex = currentStepIndex;
      } else {
        activeStepIndex = pending.index;
      }
    } else {
      activeStepIndex = currentStepIndex;
    }
    const activeStep =
      activeStepIndex !== -1 && modeSteps[activeStepIndex]
        ? modeSteps[activeStepIndex]
        : { presetMode: attrs.preset_mode || attrs.mode || "auto" };

    const scale = this._getScale();

    // İlk render'da tüm DOM iskeletini bir kere kuruyoruz. Sonraki her
    // render çağrısında (hass her güncellendiğinde, saniyede birkaç kez
    // olabiliyor) İSKELETİ YENİDEN YAZMIYORUZ; sadece metin/renk/transform
    // gibi değişen kısımları güncelliyoruz. Fan ikonundaki CSS animasyonu
    // bu sayede DOM'dan hiç kopmuyor ve "takılma/sıçrama" olmadan kesintisiz
    // dönüyor — Home Assistant'ın kendi fan kartının yaptığı da bu.
    if (!this._built) {
      this._buildSkeleton();
    }
    this._updateSkeleton({
      state,
      attrs,
      pm25Display,
      pm25Unit: pm25Data.unit,
      pmColor,
      temperature,
      temperatureUnit: temperatureData.unit,
      humidity,
      humidityUnit: humidityData.unit,
      activeStep,
      scale,
    });
  }

  _buildSkeleton() {
    this.innerHTML = `
      <style>
        @keyframes xiaomi-ha-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .xap-fan-icon.spinning {
          animation-name: xiaomi-ha-spin;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
      </style>
      <ha-card class="xap-card" style="
        padding: 4px 12px;
        cursor: pointer;
        box-sizing: border-box;
        height: 100%;
        overflow: hidden;
      ">
        <div class="xap-row" style="
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
        ">
          <!-- 1. Power toggle (sabit 36x36, kart boyutundan etkilenmez) -->
          <div class="xap-power" data-action="toggle" style="
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            box-sizing: border-box;
            cursor: pointer;
          ">
            <ha-icon class="xap-fan-icon" icon="mdi:fan" style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 36px;
              height: 36px;
              --mdc-icon-size: 24px;
            "></ha-icon>
          </div>

          <!-- 2. PM2.5 — hem yatayda hem dikeyde tam ortalı, kart boyutu
               değiştikçe de ortalı kalır (flex:1 + center/center). -->
          <div class="xap-pm-col" style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            flex: 1 1 0;
            min-width: 0;
            height: 100%;
          ">
            <span class="xap-pm-value" style="
              font-weight: 400;
              line-height: 1;
              letter-spacing: 0px;
              font-variant-numeric: tabular-nums;
              text-align: center;
            "></span>
            <span class="xap-pm-unit" style="
              color: var(--secondary-text-color);
              text-align: center;
            "></span>
          </div>

          <!-- 3. Temperature + humidity — kolonun kendisi de yatayda
               ortalanan bir flex bölgesi içinde, satırlar da kendi
               içinde ortalı. -->
          <div class="xap-th-col" style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
            box-sizing: border-box;
          ">
            <div class="xap-temp-row" style="
              display: flex;
              align-items: center;
              justify-content: center;
              color: var(--primary-text-color);
              font-weight: 400;
            ">
              <ha-icon class="xap-temp-icon" icon="mdi:thermometer" style="
                color: var(--secondary-text-color);
                flex-shrink: 0;
              "></ha-icon>
              <span class="xap-temp-value"></span>
            </div>
            <div class="xap-hum-row" style="
              display: flex;
              align-items: center;
              justify-content: center;
              color: var(--primary-text-color);
              font-weight: 400;
            ">
              <ha-icon class="xap-hum-icon" icon="mdi:water-percent" style="
                color: var(--secondary-text-color);
                flex-shrink: 0;
              "></ha-icon>
              <span class="xap-hum-value"></span>
            </div>
          </div>

          <!-- 4. Mod tuşu: tek tuş (sabit 36x36), üzerinde mevcut modun
               sembolü, basınca bir sonraki moda geçer. -->
          <div class="xap-mode-btn" data-action="cycle" style="
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            box-sizing: border-box;
            cursor: pointer;
            position: relative;
          ">
            <div class="xap-mode-glyph" style="
              display: flex;
              align-items: center;
              justify-content: center;
            "></div>
          </div>
        </div>
      </ha-card>`;

    this._els = {
      fanIcon: this.querySelector(".xap-fan-icon"),
      power: this.querySelector(".xap-power"),
      pmValue: this.querySelector(".xap-pm-value"),
      pmUnit: this.querySelector(".xap-pm-unit"),
      pmCol: this.querySelector(".xap-pm-col"),
      thCol: this.querySelector(".xap-th-col"),
      tempRow: this.querySelector(".xap-temp-row"),
      humRow: this.querySelector(".xap-hum-row"),
      tempIcon: this.querySelector(".xap-temp-icon"),
      humIcon: this.querySelector(".xap-hum-icon"),
      tempValue: this.querySelector(".xap-temp-value"),
      humValue: this.querySelector(".xap-hum-value"),
      modeBtn: this.querySelector(".xap-mode-btn"),
      modeGlyph: this.querySelector(".xap-mode-glyph"),
      row: this.querySelector(".xap-row"),
    };

    this._built = true;
    this._lastGlyphKey = null;
  }

  _updateSkeleton(d) {
    const els = this._els;
    const scale = d.scale;

    // --- Sabit boyutlar (kart küçülüp büyüse de DEĞİŞMEZ) ---
    // Güç düğmesi, fan ikonu, mod tuşu ve mod glyph'i HTML'de zaten 36x36
    // sabit verildi; burada sadece glyph render'ı için sabit boyutu
    // referans alıyoruz.
    const FIXED_ICON_SIZE = 36; // fan ikonu + mod glyph'i, sabit 36x36

    // --- Ölçeklenen boyutlar (columns 6 -> 9 -> 12 büyüdükçe orantılı
    //     büyüyen tek şey aradaki boşluklar ve metinler) ---
    const pmFontSize = Math.round(27 * scale);
    const pmUnitFontSize = Math.round(9 * scale);
    const thFontSize = Math.round(12 * scale);
    const thIconSize = Math.round(13 * scale);
    const gap = Math.round(8 * scale); // ana elemanlar arası boşluk, ölçekle büyür

    els.row.style.gap = `${gap}px`;

    // Güç düğmesi — sabit 36x36
    els.power.style.background =
      d.state === "on"
        ? "rgba(76, 175, 80, 0.12)"
        : "rgba(var(--rgb-secondary-text-color), 0.06)";

    els.fanIcon.style.color =
      d.state === "on" ? "#4CAF50" : "var(--secondary-text-color)";

    // Fan dönüş hızı, cihazın gerçek percentage'ına göre.
    if (d.state === "on") {
      const pct =
        typeof d.attrs.percentage === "number" ? d.attrs.percentage : 50;
      const duration = 3.4 - (Math.max(0, Math.min(100, pct)) / 100) * 2.6;
      const durationStr = `${Math.max(0.8, duration).toFixed(2)}s`;
      // Süre değiştiğinde bile animasyonu KOPARMADAN güncelliyoruz: class
      // zaten "spinning" ise sadece animation-duration'ı değiştiriyoruz,
      // class'ı kaldırıp eklemiyoruz (bu da takılmaya sebep olurdu).
      if (els.fanIcon.style.animationDuration !== durationStr) {
        els.fanIcon.style.animationDuration = durationStr;
      }
      if (!els.fanIcon.classList.contains("spinning")) {
        els.fanIcon.classList.add("spinning");
      }
    } else {
      els.fanIcon.classList.remove("spinning");
      els.fanIcon.style.animationDuration = "";
    }

    // PM2.5 — hem yatay hem dikey tam ortalı; kolon flex:1 olduğu ve
    // align-items/justify-content: center kullandığı için kart boyutu
    // değiştikçe de ortalı kalır.
    els.pmCol.style.gap = `${Math.round(3 * scale)}px`;
    els.pmValue.style.fontSize = `${pmFontSize}px`;
    els.pmValue.style.color = d.pmColor;
    els.pmValue.textContent = d.pm25Display;
    els.pmUnit.style.fontSize = `${pmUnitFontSize}px`;
    els.pmUnit.textContent = d.pm25Unit;

    // Sıcaklık + nem — kolon kendi içinde ortalı, satırlar da kendi
    // içinde ortalı (yatay + dikey).
    els.thCol.style.gap = `${Math.max(1, Math.round(1 * scale))}px`;
    [els.tempRow, els.humRow].forEach((row) => {
      row.style.fontSize = `${thFontSize}px`;
      row.style.gap = `${Math.round(2 * scale)}px`;
    });
    [els.tempIcon, els.humIcon].forEach((icon) => {
      icon.style.width = `${thIconSize}px`;
      icon.style.height = `${thIconSize}px`;
      icon.style.setProperty("--mdc-icon-size", `${thIconSize}px`);
    });
    // Sıcaklık birimi: entity zaten "°C" gönderiyorsa olduğu gibi, sadece
    // "°" ya da boş geliyorsa "°C" tamamlanarak gösterilir; entity Fahrenheit
    // ise (°F) onu da olduğu gibi korur.
    let tempUnitDisplay = d.temperatureUnit;
    if (tempUnitDisplay === "°" || !tempUnitDisplay) tempUnitDisplay = "°C";
    els.tempValue.textContent = `${d.temperature}${tempUnitDisplay}`;
    els.humValue.textContent = `${d.humidity}${d.humidityUnit === "%" ? "%" : ""}`;

    // Mod tuşu — sabit 36x36, ok ipuçları kaldırıldı.
    els.modeBtn.style.background = "rgba(var(--rgb-secondary-text-color), 0.06)";

    this._renderModeGlyphInto(els.modeGlyph, d.activeStep, FIXED_ICON_SIZE);
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

  // Mod tuşunun ortasındaki sembolü günceller. Auto -> "A", Sleep -> hilal,
  // Favorite -> kalp, "Manual" gibi seviyeli bir adımda dalgalı çizgiler.
  // Gereksiz DOM thrash'ini önlemek için aynı glyph zaten çizilmişse
  // (key değişmemişse) yeniden yazmaz, sadece boyutunu günceller.
  _renderModeGlyphInto(container, step, iconSize) {
    if (!step) return;

    const level = step.level || 0;
    const preset = (step.presetMode || "").toString().toLowerCase();
    const key = level ? `level:${level}` : `preset:${preset || step.label || "?"}`;

    if (this._lastGlyphKey !== key) {
      if (level) {
        const wave = `<svg width="${Math.round(iconSize * 0.5)}" height="${Math.round(iconSize * 0.21)}" viewBox="0 0 12 5" style="display:block;">
          <path d="M1 2.5 Q 3 0.5, 6 2.5 T 11 2.5" stroke="var(--primary-text-color)" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        </svg>`;
        container.innerHTML = `<div class="xap-wave-stack" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;">${wave.repeat(level)}</div>`;
      } else if (preset === "sleep") {
        container.innerHTML = `<ha-icon icon="mdi:moon-waning-crescent" class="xap-glyph-icon" style="display:flex; align-items:center; justify-content:center; color:var(--primary-text-color);"></ha-icon>`;
      } else if (preset === "favorite") {
        container.innerHTML = `<ha-icon icon="mdi:heart" class="xap-glyph-icon" style="display:flex; align-items:center; justify-content:center; color:var(--primary-text-color);"></ha-icon>`;
      } else {
        const source = (step.presetMode || step.label || "?").toString();
        const letter = source.charAt(0).toUpperCase() || "?";
        container.innerHTML = `<span class="xap-glyph-letter" style="font-weight:700; color:var(--primary-text-color); line-height:1;">${letter}</span>`;
      }
      this._lastGlyphKey = key;
    }

    // Boyutu her render'da güncelle (skeleton yeniden yazılmasa bile).
    const glyphIcon = container.querySelector(".xap-glyph-icon");
    if (glyphIcon) {
      glyphIcon.style.width = `${iconSize}px`;
      glyphIcon.style.height = `${iconSize}px`;
      glyphIcon.style.setProperty("--mdc-icon-size", `${iconSize}px`);
    }
    const glyphLetter = container.querySelector(".xap-glyph-letter");
    if (glyphLetter) {
      glyphLetter.style.fontSize = `${Math.round(iconSize * 0.6)}px`;
    }
  }

  // Döngü tuşunun geçeceği adımları üretir. Varsayılan olarak entity'nin
  // kendi preset_modes sırasını kullanır; kart yapılandırmasında mode_order
  // verilmişse onu kullanır. "Manual" gibi bir preset, entity'nin kendi
  // speed_list attribute'u varsa doğrudan o isimlerle ve o sayıda alt adıma
  // bölünür. speed_list yoksa percentage_step'ten hesaplanır.
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
        const listLen = speedList.length;
        speedList.forEach((levelName, idx) => {
          const percentage = percentageStep && percentageStep > 0
            ? Math.floor(percentageStep * (idx + 1))
            : Math.floor(((idx + 1) * 100) / listLen);
          steps.push({
            presetMode: pm,
            percentage,
            level: idx + 1,
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

    this._pendingStep = { step: next, index: nextIndex, ts: Date.now() };

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

    // Optimistic UI: servis çağrısının state'e yansıması birkaç yüz ms
    // sürebileceğinden, glyph'i hemen yeni adıma göre güncelle.
    this.render();
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

  connectedCallback() {
    // Kart DOM'a eklendiğinde / boyutu değişebileceğinden (örn. grid
    // sütun sayısı sonradan değiştirildiğinde) genişliği izleyip ölçeği
    // güncelliyoruz.
    if (!this._resizeObserver && typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._built) this.render();
      });
      this._resizeObserver.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
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
