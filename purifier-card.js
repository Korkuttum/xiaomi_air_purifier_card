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
    const newLayout = config.layout || "horizontal";
    if (this._builtLayout && this._builtLayout !== newLayout) {
      this._built = false;
    }
    this.config = config;
    this.entity = config.entity;
    this.pm25Entity = config.pm25_entity;
    this.temperatureEntity = config.temperature_entity;
    this.humidityEntity = config.humidity_entity;

    // tap_action: HA standart formatı. Varsayılan: fan more-info aç.
    // Şekil: { action: "more-info" | "toggle" | "call-service" | "navigate" | "url" | "none",
    //          entity?: string,           // more-info için hedef entity
    //          service?: string,          // call-service için (örn. "fan.toggle")
    //          service_data?: object,     // call-service için
    //          navigation_path?: string,  // navigate için
    //          url_path?: string }        // url için
    this.tapAction = config.tap_action || { action: "more-info" };

    if (!this._listenersBound) {
      this.addEventListener("click", (e) => this._handleClick(e));
      this._listenersBound = true;
    }

    this.render();
  }

  _handleClick(e) {
    // Önizleme modunda (entity gerçekten hass'te yoksa) tuşların hiçbir
    // şey yapmaması için tıklamayı sessizce yutuyoruz.
    if (this._isPreview) {
      e.stopPropagation();
      return;
    }
    const actionTarget = e.target.closest("[data-action]");
    if (actionTarget) {
      e.stopPropagation();
      const action = actionTarget.dataset.action;
      if (action === "toggle") this._togglePower();
      if (action === "cycle") this._cycleMode();
      return;
    }
    // Karta dokunma (power/mode tuşları dışında): tap_action'ı uygula.
    this._executeTapAction();
  }

  // Yapılandırılmış tap_action'ı çalıştırır. HA'nın resmi action
  // tiplerini destekler. "more-info" varsayılan olarak fan entity'yi açar
  // ama config'te "entity" verilirse (örn. PM2.5 sensörü) onun more-info'su
  // açılır — kullanıcının başlangıç isteğindeki "tıklayınca sıcaklık/nem/PM"
  // davranışı bu sayede tek bir alandan ayarlanabilir.
  _executeTapAction() {
    const action = this.tapAction || { action: "more-info" };
    switch (action.action) {
      case "none":
        return;
      case "toggle":
        this._hass.callService("fan", "toggle", { entity_id: this.entity });
        return;
      case "call-service": {
        if (!action.service) return;
        const [domain, service] = action.service.split(".");
        if (!domain || !service) return;
        this._hass.callService(domain, service, action.service_data || {});
        return;
      }
      case "navigate": {
        if (!action.navigation_path) return;
        history.pushState(null, "", action.navigation_path);
        const event = new Event("location-changed", {
          bubbles: true,
          composed: true,
        });
        window.dispatchEvent(event);
        return;
      }
      case "url": {
        if (!action.url_path) return;
        window.open(action.url_path, "_blank");
        return;
      }
      case "more-info":
      default: {
        const targetEntity = action.entity || this.entity;
        this._openMoreInfo(targetEntity);
        return;
      }
    }
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

  // Kart seçici / önizleme ekranında entity henüz mevcut olmayabilir
  // (örn. kullanıcının kurulumunda farklı bir entity ID'si vardır). Bu
  // durumda "Loading..." göstermek yerine sahte verilerle gerçek bir
  // önizleme çiziyoruz ki kullanıcı kartın nasıl göründüğünü görsün.
  _getPreviewState() {
    return {
      state: "on",
      attributes: {
        pm25: 12,
        temperature: 23,
        humidity: 45,
        preset_mode: "auto",
        percentage: 50,
        preset_modes: ["Auto", "Sleep", "Favorite"],
      },
    };
  }

  render() {
    let fanState = this._hass?.states[this.entity];
    this._isPreview = false;
    if (!fanState) {
      // Entity yoksa (kart seçici önizlemesi gibi) sahte veriyle çiz.
      fanState = this._getPreviewState();
      this._isPreview = true;
    }

    const state = fanState.state;
    const attrs = fanState.attributes || {};

    // Önizleme modunda harici sensör entity'lerini de aramıyoruz;
    // doğrudan attribute'lardaki sahte verileri kullanıyoruz.
    const pm25Data = this._isPreview
      ? { value: attrs.pm25, unit: "µg/m³" }
      : this._readValue(
          this.pm25Entity,
          attrs.pm25 || attrs.aqi || attrs.air_quality,
          "µg/m³"
        );
    const temperatureData = this._isPreview
      ? { value: attrs.temperature, unit: "°C" }
      : this._readValue(
          this.temperatureEntity,
          attrs.temperature ?? attrs.temp,
          "°C"
        );
    const humidityData = this._isPreview
      ? { value: attrs.humidity, unit: "%" }
      : this._readValue(this.humidityEntity, attrs.humidity, "%");

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
      pm25,
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
    const layout = this.config?.layout || "horizontal";
    if (layout === "vertical") {
      this._buildSkeletonVertical();
    } else {
      this._buildSkeletonHorizontal();
    }
    this._builtLayout = layout;
  }

  _buildSkeletonHorizontal() {
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
        padding: 4px 6px;
        cursor: pointer;
        box-sizing: border-box;
        height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
      ">
        <canvas class="xap-particles" style="
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 0;
        "></canvas>
        <div class="xap-row" style="
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1 1 auto;
          min-height: 0;
          position: relative;
          z-index: 1;
        ">
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
              width: 24px;
              height: 24px;
              --mdc-icon-size: 24px;
            "></ha-icon>
          </div>

          <div class="xap-pm-col" style="
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            flex: 1 1 0;
            align-self: stretch;
            min-width: 0;
          ">
            <span class="xap-pm-value" style="
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              font-weight: 400;
              line-height: 1;
              letter-spacing: 0px;
              font-variant-numeric: tabular-nums;
              text-align: center;
              white-space: nowrap;
            "></span>
            <span class="xap-pm-unit" style="
              position: absolute;
              top: calc(50% + 10px);
              left: 50%;
              transform: translateX(-50%);
              color: var(--secondary-text-color);
              text-align: center;
              white-space: nowrap;
              line-height: 1.2;
            "></span>
          </div>

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
              color: var(--primary-text-color);
              font-weight: 400;
            ">
              <ha-icon class="xap-temp-icon" icon="mdi:thermometer" style="
                color: var(--secondary-text-color);
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
              "></ha-icon>
              <span class="xap-temp-value" style="
                display: inline-block;
                text-align: left;
              "></span>
            </div>
            <div class="xap-hum-row" style="
              display: flex;
              align-items: center;
              color: var(--primary-text-color);
              font-weight: 400;
            ">
              <ha-icon class="xap-hum-icon" icon="mdi:water-percent" style="
                color: var(--secondary-text-color);
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
              "></ha-icon>
              <span class="xap-hum-value" style="
                display: inline-block;
                text-align: left;
              "></span>
            </div>
          </div>

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
      card: this.querySelector(".xap-card"),
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
      particlesCanvas: this.querySelector(".xap-particles"),
    };

    this._destroyParticles();
    this._initParticles();

    this._built = true;
    this._lastGlyphKey = null;
  }

  _buildSkeletonVertical() {
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
        padding: 8px 4px;
        cursor: pointer;
        box-sizing: border-box;
        height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
      ">
        <canvas class="xap-particles" style="
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 0;
        "></canvas>
        <div class="xap-row" style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-evenly;
          flex: 1 1 auto;
          min-height: 0;
          position: relative;
          z-index: 1;
        ">
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
              width: 24px;
              height: 24px;
              --mdc-icon-size: 24px;
            "></ha-icon>
          </div>

          <div class="xap-pm-col" style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          ">
            <span class="xap-pm-value" style="
              font-weight: 400;
              line-height: 1;
              letter-spacing: 0px;
              font-variant-numeric: tabular-nums;
              text-align: center;
              white-space: nowrap;
            "></span>
            <span class="xap-pm-unit" style="
              color: var(--secondary-text-color);
              text-align: center;
              white-space: nowrap;
              line-height: 1.4;
            "></span>
          </div>

          <div class="xap-th-col" style="
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
          ">
            <div class="xap-temp-row" style="
              display: flex;
              align-items: center;
              color: var(--primary-text-color);
              font-weight: 400;
            ">
              <ha-icon class="xap-temp-icon" icon="mdi:thermometer" style="
                color: var(--secondary-text-color);
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
              "></ha-icon>
              <span class="xap-temp-value" style="
                display: inline-block;
                text-align: left;
              "></span>
            </div>
            <div class="xap-hum-row" style="
              display: flex;
              align-items: center;
              color: var(--primary-text-color);
              font-weight: 400;
            ">
              <ha-icon class="xap-hum-icon" icon="mdi:water-percent" style="
                color: var(--secondary-text-color);
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
              "></ha-icon>
              <span class="xap-hum-value" style="
                display: inline-block;
                text-align: left;
              "></span>
            </div>
          </div>

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
      card: this.querySelector(".xap-card"),
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
      particlesCanvas: this.querySelector(".xap-particles"),
    };

    this._destroyParticles();
    this._initParticles();

    this._built = true;
    this._lastGlyphKey = null;
  }

  _updateSkeleton(d) {
    if ((this.config?.layout || "horizontal") === "vertical") {
      this._updateSkeletonVertical(d);
    } else {
      this._updateSkeletonHorizontal(d);
    }
  }

  _updateSkeletonHorizontal(d) {
    const els = this._els;
    const scale = d.scale;

    const FIXED_GLYPH_ICON_SIZE = 24;
    const FIXED_PM_FONT = 27;
    const FIXED_PM_UNIT_FONT = 9;
    const FIXED_TH_FONT = 12;
    const FIXED_TH_ICON = 13;
    const FIXED_TH_VALUE_WIDTH = 34;

    const gap = Math.round(8 * scale);

    els.row.style.gap = `${gap}px`;

    const rightShift = Math.round(6 * scale);
    els.pmValue.style.left = `calc(50% + ${rightShift}px)`;
    els.pmUnit.style.left = `calc(50% + ${rightShift}px)`;
    els.thCol.style.transform = `translateX(${rightShift}px)`;

    els.power.style.background =
      d.state === "on"
        ? "rgba(76, 175, 80, 0.12)"
        : "rgba(var(--rgb-secondary-text-color), 0.06)";

    els.fanIcon.style.color =
      d.state === "on" ? "#4CAF50" : "var(--secondary-text-color)";

    if (d.state === "on") {
      const pct =
        typeof d.attrs.percentage === "number" ? d.attrs.percentage : 50;
      const duration = 1.6 - (Math.max(0, Math.min(100, pct)) / 100) * 1.15;
      const durationStr = `${Math.max(0.45, duration).toFixed(2)}s`;
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

    els.pmValue.style.fontSize = `${FIXED_PM_FONT}px`;
    els.pmValue.style.color = d.pmColor;
    els.pmValue.textContent = d.pm25Display;
    els.pmUnit.style.fontSize = `${FIXED_PM_UNIT_FONT}px`;
    els.pmUnit.textContent = d.pm25Unit;

    els.thCol.style.gap = `${Math.max(1, Math.round(1 * scale))}px`;
    [els.tempRow, els.humRow].forEach((row) => {
      row.style.fontSize = `${FIXED_TH_FONT}px`;
      row.style.gap = `${Math.max(1, Math.round(1 * scale))}px`;
    });
    [els.tempIcon, els.humIcon].forEach((icon) => {
      icon.style.width = `${FIXED_TH_ICON}px`;
      icon.style.height = `${FIXED_TH_ICON}px`;
      icon.style.setProperty("--mdc-icon-size", `${FIXED_TH_ICON}px`);
    });
    els.tempValue.style.width = `${FIXED_TH_VALUE_WIDTH}px`;
    els.humValue.style.width = `${FIXED_TH_VALUE_WIDTH}px`;
    let tempUnitDisplay = d.temperatureUnit;
    if (tempUnitDisplay === "°" || !tempUnitDisplay) tempUnitDisplay = "°C";
    els.tempValue.textContent = `${d.temperature}${tempUnitDisplay}`;
    els.humValue.textContent = `${d.humidity}${d.humidityUnit === "%" ? "%" : ""}`;

    els.modeBtn.style.background = "rgba(var(--rgb-secondary-text-color), 0.06)";

    this._renderModeGlyphInto(els.modeGlyph, d.activeStep, FIXED_GLYPH_ICON_SIZE);

    this._updateParticleSystem(d);
  }

  _updateSkeletonVertical(d) {
    const els = this._els;
    const scale = d.scale;

    const FIXED_GLYPH_ICON_SIZE = 24;
    const FIXED_PM_FONT = 36;
    const FIXED_PM_UNIT_FONT = 10;
    const FIXED_TH_FONT = 12;
    const FIXED_TH_ICON = 13;
    const FIXED_TH_VALUE_WIDTH = 36;

    els.power.style.background =
      d.state === "on"
        ? "rgba(76, 175, 80, 0.12)"
        : "rgba(var(--rgb-secondary-text-color), 0.06)";
    els.fanIcon.style.color =
      d.state === "on" ? "#4CAF50" : "var(--secondary-text-color)";

    if (d.state === "on") {
      const pct =
        typeof d.attrs.percentage === "number" ? d.attrs.percentage : 50;
      const duration = 1.6 - (Math.max(0, Math.min(100, pct)) / 100) * 1.15;
      const durationStr = `${Math.max(0.45, duration).toFixed(2)}s`;
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

    els.pmValue.style.fontSize = `${FIXED_PM_FONT}px`;
    els.pmValue.style.color = d.pmColor;
    els.pmValue.textContent = d.pm25Display;
    els.pmUnit.style.fontSize = `${FIXED_PM_UNIT_FONT}px`;
    els.pmUnit.textContent = d.pm25Unit;

    els.thCol.style.gap = `${Math.max(6, Math.round(8 * scale))}px`;
    [els.tempRow, els.humRow].forEach((row) => {
      row.style.fontSize = `${FIXED_TH_FONT}px`;
      row.style.gap = `${Math.max(1, Math.round(1 * scale))}px`;
    });
    [els.tempIcon, els.humIcon].forEach((icon) => {
      icon.style.width = `${FIXED_TH_ICON}px`;
      icon.style.height = `${FIXED_TH_ICON}px`;
      icon.style.setProperty("--mdc-icon-size", `${FIXED_TH_ICON}px`);
    });
    els.tempValue.style.width = `${FIXED_TH_VALUE_WIDTH}px`;
    els.humValue.style.width = `${FIXED_TH_VALUE_WIDTH}px`;
    let tempUnitDisplay = d.temperatureUnit;
    if (tempUnitDisplay === "°" || !tempUnitDisplay) tempUnitDisplay = "°C";
    els.tempValue.textContent = `${d.temperature}${tempUnitDisplay}`;
    els.humValue.textContent = `${d.humidity}${d.humidityUnit === "%" ? "%" : ""}`;

    els.modeBtn.style.background = "rgba(var(--rgb-secondary-text-color), 0.06)";
    this._renderModeGlyphInto(els.modeGlyph, d.activeStep, FIXED_GLYPH_ICON_SIZE);

    this._updateParticleSystem(d);
  }

  // ---------------------------------------------------------------------
  // Toz parçacıkları (Xiaomi uygulamasındakine benzer "emiliyor" efekti)
  // ---------------------------------------------------------------------
  _initParticles() {
    const canvas = this._els.particlesCanvas;
    if (!canvas) return;
    this._particleCtx = canvas.getContext("2d");
    this._particles = [];
    this._particleTargetCount = 0;
    this._particlesActive = false;
    this._particleDpr = Math.min(window.devicePixelRatio || 1, 2);

    if (typeof ResizeObserver !== "undefined") {
      this._particleResizeObserver = new ResizeObserver(() =>
        this._resizeParticlesCanvas()
      );
      this._particleResizeObserver.observe(this._els.card);
    }
    this._resizeParticlesCanvas();

    const loop = () => {
      this._particleFrame();
      this._particleRafId = requestAnimationFrame(loop);
    };
    this._particleRafId = requestAnimationFrame(loop);
  }

  _resizeParticlesCanvas() {
    const canvas = this._els.particlesCanvas;
    const card = this._els.card;
    if (!canvas || !card) return;
    const w = card.clientWidth;
    const h = card.clientHeight;
    if (!w || !h) return;
    const dpr = this._particleDpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this._particleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cardRect = card.getBoundingClientRect();
    const fanRect = this._els.power.getBoundingClientRect();
    this._fanCenter = {
      x: fanRect.left - cardRect.left + fanRect.width / 2,
      y: fanRect.top - cardRect.top + fanRect.height / 2,
    };
    this._canvasSize = { w, h };
  }

  _updateParticleSystem(d) {
    if (!this._particleCtx) return;

    this._particlesActive = d.state === "on";

    const num = Number(d.pm25);
    let target;
    if (!this._particlesActive || Number.isNaN(num)) {
      target = 0;
    } else {
      target = Math.round(10 + (Math.min(Math.max(num, 0), 150) / 150) * 32);
    }
    this._particleTargetCount = target;

    const pct =
      typeof d.attrs?.percentage === "number" ? d.attrs.percentage : 50;
    this._particleSpeedFactor = 0.6 + (Math.max(0, Math.min(100, pct)) / 100) * 1.1;

    this._particleColor = d.pmColor || "#9e9e9e";
  }

  _spawnParticle() {
    const { w, h } = this._canvasSize || { w: 0, h: 0 };
    if (!w || !h || !this._fanCenter) return null;

    const edge = Math.floor(Math.random() * 4);
    let x, y;
    const margin = 2;
    if (edge === 0) {
      x = Math.random() * w;
      y = margin;
    } else if (edge === 1) {
      x = w - margin;
      y = Math.random() * h;
    } else if (edge === 2) {
      x = Math.random() * w;
      y = h - margin;
    } else {
      x = margin;
      y = Math.random() * h;
    }

    return {
      x,
      y,
      startX: x,
      startY: y,
      progress: 0,
      speed: 0.006 + Math.random() * 0.01,
      size: 1.1 + Math.random() * 1.8,
      baseAlpha: 0.45 + Math.random() * 0.45,
    };
  }

  _particleFrame() {
    const ctx = this._particleCtx;
    if (!ctx || !this._canvasSize) return;
    const { w, h } = this._canvasSize;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    const particles = this._particles;
    const target = this._particleTargetCount || 0;

    if (particles.length < target) {
      const p = this._spawnParticle();
      if (p) particles.push(p);
    } else if (particles.length > target) {
      particles.pop();
    }

    if (!this._fanCenter || particles.length === 0) return;

    const speedFactor = this._particleSpeedFactor || 1;
    const fan = this._fanCenter;

    ctx.fillStyle = this._particleColor || "#9e9e9e";

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.progress += p.speed * speedFactor;

      if (p.progress >= 1) {
        const fresh = this._spawnParticle();
        if (fresh) particles[i] = fresh;
        continue;
      }

      const t = p.progress;
      const eased = t * t;
      p.x = p.startX + (fan.x - p.startX) * eased;
      p.y = p.startY + (fan.y - p.startY) * eased;

      const fade = 1 - t;
      const radius = Math.max(0.3, p.size * fade);
      const alpha = p.baseAlpha * fade;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _destroyParticles() {
    if (this._particleRafId) {
      cancelAnimationFrame(this._particleRafId);
      this._particleRafId = null;
    }
    if (this._particleResizeObserver) {
      this._particleResizeObserver.disconnect();
      this._particleResizeObserver = null;
    }
    this._particles = [];
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

  _renderModeGlyphInto(container, step, moonHeartIconSize) {
    if (!step) return;

    const WAVE_WIDTH = 18;
    const WAVE_HEIGHT = 8;
    const LETTER_FONT_SIZE = 22;

    const level = step.level || 0;
    const preset = (step.presetMode || "").toString().toLowerCase();
    const key = level ? `level:${level}` : `preset:${preset || step.label || "?"}`;

    if (this._lastGlyphKey !== key) {
      if (level) {
        const wave = `<svg width="${WAVE_WIDTH}" height="${WAVE_HEIGHT}" viewBox="0 0 12 5" style="display:block;">
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

    const glyphIcon = container.querySelector(".xap-glyph-icon");
    if (glyphIcon) {
      glyphIcon.style.width = `${moonHeartIconSize}px`;
      glyphIcon.style.height = `${moonHeartIconSize}px`;
      glyphIcon.style.setProperty("--mdc-icon-size", `${moonHeartIconSize}px`);
    }
    const glyphLetter = container.querySelector(".xap-glyph-letter");
    if (glyphLetter) {
      glyphLetter.style.fontSize = `${LETTER_FONT_SIZE}px`;
    }
  }

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

    this.render();
  }

  _openMoreInfo(entityId) {
    const event = new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId: entityId || this.entity },
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
    this._destroyParticles();
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    if ((this.config?.layout || "horizontal") === "vertical") {
      return {
        columns: 3,
        rows: 3,
        min_columns: 1,
        max_columns: 12,
      };
    }
    return {
      columns: 6,
      rows: 1,
      min_columns: 4,
      max_columns: 12,
    };
  }
}

// =====================================================================
// Görsel yapılandırma editörü — Home Assistant ha-form ile
// =====================================================================
// HA'nın resmi Tile / Entities kartı editörleriyle birebir aynı
// görünüm: aynı tipografi, aynı input stilleri, katlanabilir
// "Görünüm" ve "Etkileşim" panelleri, tap_action için HA'nın kendi
// action editörü (More info / Toggle / Perform action / Navigate /
// URL / Assist / None — bu seçenekler bizden değil HA'dan geliyor).
//
// Tüm form ha-form'a teslim ediliyor; kendi <select> / <input>
// elemanlarımız YOK. Bu sayede HA tema/tasarımı her zaman bizimkiyle
// tutarlı kalır ve gelecekteki HA değişikliklerinden ücretsiz olarak
// faydalanırız.
class XiaomiAirPurifierCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    this._render();
  }

  // ---------- Lokalizasyon ----------
  // Üç katmanlı çeviri:
  //   1. HA'nın hass.localize() — varsa kullanıcının HA dilinde döner
  //   2. Kart-içi mini sözlük — HA'da o key yoksa kullanıcının dil
  //      koduna göre (tr/en) bizim çevirimiz devreye girer
  //   3. İngilizce fallback string
  // Bu sayede HA key'inin gerçekten var olup olmadığına bel bağlamadan
  // editör hem Türkçe hem İngilizce'de doğru görünür. Başka diller HA
  // çevirileri varsa onlardan, yoksa İngilizce fallback gösterir.
  _dict() {
    // Anahtar = İngilizce fallback string. Değer = dile göre çeviri.
    // Yeni dil eklemek istersen sadece bu tabloya yeni anahtarlar ekle.
    return {
      Sensors: { tr: "Sensörler" },
      Appearance: { tr: "Görünüm" },
      Interactions: { tr: "Etkileşimler" },
      "Content layout": { tr: "İçerik düzeni" },
      Horizontal: { tr: "Yatay" },
      Vertical: { tr: "Dikey" },
      "Tap behavior": { tr: "Dokunma davranışı" },
      "PM2.5 sensor": { tr: "PM2.5 sensörü" },
      "Temperature sensor": { tr: "Sıcaklık sensörü" },
      "Humidity sensor": { tr: "Nem sensörü" },
    };
  }

  _userLang() {
    // hass.locale.language en güvenilir kaynak; eski sürümlerde
    // hass.language. İlk iki harfini (örn. "tr-TR" -> "tr") al.
    const raw =
      this._hass?.locale?.language ||
      this._hass?.language ||
      "en";
    return raw.toLowerCase().slice(0, 2);
  }

  _t(haKey, fallback) {
    // 1) HA'nın çevirisi (gerçek key varsa)
    const ha = haKey ? this._hass?.localize?.(haKey) : null;
    if (ha && typeof ha === "string") return ha;
    // 2) Kart mini sözlüğü
    const lang = this._userLang();
    const dict = this._dict();
    const entry = dict[fallback];
    if (entry && entry[lang]) return entry[lang];
    // 3) İngilizce
    return fallback;
  }

  // ---------- Cihaz/sensör tespit yardımcıları ----------

  _getDeviceIdForEntity(entityId) {
    if (!this._hass || !entityId) return null;
    const reg = this._hass.entities || this._hass.entityRegistry;
    if (!reg) return null;
    return reg[entityId]?.device_id || null;
  }

  _getEntitiesForDevice(deviceId) {
    if (!this._hass || !deviceId) return [];
    const reg = this._hass.entities || this._hass.entityRegistry;
    if (!reg) return [];
    return Object.values(reg)
      .filter((e) => e.device_id === deviceId)
      .map((e) => e.entity_id);
  }

  _classifySensor(entityId) {
    if (!entityId) return null;
    const state = this._hass?.states?.[entityId];
    const attrs = state?.attributes || {};
    const deviceClass = (attrs.device_class || "").toString().toLowerCase();
    const unit = (attrs.unit_of_measurement || "").toString().toLowerCase();
    const id = entityId.toLowerCase();

    if (deviceClass === "pm25" || deviceClass === "pm2.5") return "pm25";
    if (deviceClass === "temperature") return "temperature";
    if (deviceClass === "humidity") return "humidity";

    if (unit.includes("µg") || unit.includes("ug/m")) return "pm25";
    if (unit === "°c" || unit === "°f") return "temperature";
    if (unit === "%" && (id.includes("humid") || id.includes("nem")))
      return "humidity";

    if (id.includes("pm2") || id.includes("pm_2")) return "pm25";
    if (
      id.includes("temperature") ||
      id.includes("temp") ||
      id.includes("sicaklik")
    )
      return "temperature";
    if (id.includes("humidity") || id.includes("nem")) return "humidity";

    return null;
  }

  _detectSensorsFromFan(fanEntityId) {
    const deviceId = this._getDeviceIdForEntity(fanEntityId);
    if (!deviceId) return { pm25: null, temperature: null, humidity: null };
    const siblings = this._getEntitiesForDevice(deviceId);
    const result = { pm25: null, temperature: null, humidity: null };
    for (const eid of siblings) {
      if (eid === fanEntityId) continue;
      if (!eid.startsWith("sensor.")) continue;
      const kind = this._classifySensor(eid);
      if (kind && !result[kind]) result[kind] = eid;
    }
    return result;
  }

  // ---------- ha-form şeması ----------
  // HA'nın Tile / Entities card editor'ünün kullandığı pattern: tek bir
  // ha-form, içinde "expandable" gruplar. Her grup içinde bir alt şema.
  // selector tipleri (entity, select, ui_action) HA'nın kendi
  // bileşenlerini doğrudan render eder — biz HTML yazmıyoruz.
  _schema() {
    return [
      // Üstte zorunlu ana entity (fan).
      {
        name: "entity",
        required: true,
        selector: { entity: { domain: ["fan"] } },
      },

      // SENSÖRLER paneli — fan'in PM2.5 / sıcaklık / nem yardımcı sensörleri.
      // Fan seçildiğinde otomatik tespit edilip boş alanlara yazılırlar.
      {
        type: "expandable",
        name: "",
        title: this._t(
          "ui.panel.config.devices.entities.sensors",
          "Sensors"
        ),
        iconPath:
          "M15,13V5A3,3 0 0,0 12,2A3,3 0 0,0 9,5V13A5,5 0 1,0 15,13M12,4A1,1 0 0,1 13,5V8H11V5A1,1 0 0,1 12,4Z",
        schema: [
          {
            name: "pm25_entity",
            selector: { entity: { domain: ["sensor"] } },
          },
          {
            name: "temperature_entity",
            selector: { entity: { domain: ["sensor"] } },
          },
          {
            name: "humidity_entity",
            selector: { entity: { domain: ["sensor"] } },
          },
        ],
      },

      // GÖRÜNÜM paneli — HA Tile card editörüyle birebir aynı key'leri
      // kullanıyoruz; "Appearance", "Content layout", "Horizontal",
      // "Vertical" HA tarafından kullanıcının diline çevriliyor.
      {
        type: "expandable",
        name: "",
        title: this._t(
          "ui.panel.lovelace.editor.card.tile.appearance",
          "Appearance"
        ),
        iconPath:
          "M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z",
        schema: [
          {
            name: "layout",
            selector: {
              select: {
                mode: "box",
                box_max_columns: 2,
                options: [
                  {
                    value: "horizontal",
                    label: this._t(
                      "ui.panel.lovelace.editor.card.tile.content_layout_options.horizontal",
                      "Horizontal"
                    ),
                    image: {
                      src: "/static/images/form/tile_content_layout_horizontal.svg",
                      src_dark:
                        "/static/images/form/tile_content_layout_horizontal_dark.svg",
                      flip_rtl: true,
                    },
                  },
                  {
                    value: "vertical",
                    label: this._t(
                      "ui.panel.lovelace.editor.card.tile.content_layout_options.vertical",
                      "Vertical"
                    ),
                    image: {
                      src: "/static/images/form/tile_content_layout_vertical.svg",
                      src_dark:
                        "/static/images/form/tile_content_layout_vertical_dark.svg",
                    },
                  },
                ],
              },
            },
          },
        ],
      },

      // ETKİLEŞİM paneli — tap_action. ui_action selector HA'nın action
      // editörünü olduğu gibi (more-info / toggle / perform-action /
      // navigate / url / assist / none) getirir, hepsi otomatik çevrilir.
      {
        type: "expandable",
        name: "",
        title: this._t(
          "ui.panel.lovelace.editor.card.tile.interactions",
          "Interactions"
        ),
        iconPath:
          "M11,16.5L5.5,11L7,9.5L11,13.5L17,7.5L18.5,9L11,16.5Z",
        schema: [
          {
            name: "tap_action",
            selector: { ui_action: {} },
          },
        ],
      },
    ];
  }

  // Alan etiketleri. Doğrulanmış HA key'leri tercih ediliyor:
  //  - "Entity"      → ui.components.entity.entity-picker.entity (var)
  //  - "Temperature" → ui.card.weather.attributes.temperature (var)
  //  - "Humidity"    → ui.card.weather.attributes.humidity (var)
  // Geri kalanlar mini sözlükten (tr/en) ya da İngilizce fallback'ten.
  _computeLabel(schema) {
    switch (schema.name) {
      case "entity":
        return this._t(
          "ui.components.entity.entity-picker.entity",
          "Entity"
        );
      case "pm25_entity":
        // "PM2.5" + boşluk + lokalize "sensor". Tek sözcük halinde
        // mini sözlüğümüzde de "PM2.5 sensor" anahtarı var.
        return this._t(null, "PM2.5 sensor");
      case "temperature_entity": {
        const t = this._t(
          "ui.card.weather.attributes.temperature",
          "Temperature"
        );
        return this._t(null, "Temperature sensor").replace("Temperature", t);
      }
      case "humidity_entity": {
        const h = this._t(
          "ui.card.weather.attributes.humidity",
          "Humidity"
        );
        return this._t(null, "Humidity sensor").replace("Humidity", h);
      }
      case "layout":
        return this._t(
          "ui.panel.lovelace.editor.card.tile.content_layout",
          "Content layout"
        );
      case "tap_action":
        return this._t(
          "ui.panel.lovelace.editor.card.generic.tap_action",
          "Tap behavior"
        );
      default:
        return schema.name || "";
    }
  }

  // ---------- Render ----------

  _render() {
    if (!this._hass) return;

    // ha-form tek bir kere oluşturulur, sonra sadece data/schema güncellenir.
    if (!this._haForm) {
      this.innerHTML = "";
      this._haForm = document.createElement("ha-form");
      this._haForm.addEventListener("value-changed", (e) =>
        this._valueChanged(e)
      );
      this.appendChild(this._haForm);
    }

    // ha-form için config'i normalize et: tap_action varsayılan olarak
    // fan'in more-info'su olsun ki kullanıcı etkileşim panelini açtığında
    // boş değil, anlamlı bir varsayılan görsün.
    const data = { ...this._config };
    if (!data.tap_action) {
      data.tap_action = { action: "more-info" };
    }
    // Layout config'te tutulmasa bile (varsayılan = horizontal, YAML'da
    // gerekmiyor) ha-form kutucuğunun seçili görünmesi için burada
    // doldur. _valueChanged'da horizontal hâlâ siliniyor, böylece YAML
    // çıktısı temiz kalır ama UI'da kutu hep seçili görünür.
    if (!data.layout) {
      data.layout = "horizontal";
    }

    this._haForm.hass = this._hass;
    this._haForm.schema = this._schema();
    this._haForm.data = data;
    this._haForm.computeLabel = (s) => this._computeLabel(s);
  }

  // ha-form value-changed event'i tüm config'i topluca verir. Burada:
  // 1) Eğer fan entity değiştiyse, aynı cihazın PM2.5 / sıcaklık / nem
  //    sensörlerini otomatik tespit et ve BOŞ olanları doldur.
  // 2) Varsayılan tap_action ({action: "more-info", boş entity}) ise
  //    YAML çıktısını temiz tutmak için config'ten çıkar (kart zaten
  //    aynı şeyi varsayılan olarak yapıyor).
  _valueChanged(ev) {
    ev.stopPropagation();
    const incoming = { ...(ev.detail.value || {}) };

    const previousFan = this._config?.entity;
    if (incoming.entity && incoming.entity !== previousFan) {
      const detected = this._detectSensorsFromFan(incoming.entity);
      if (!incoming.pm25_entity && detected.pm25)
        incoming.pm25_entity = detected.pm25;
      if (!incoming.temperature_entity && detected.temperature)
        incoming.temperature_entity = detected.temperature;
      if (!incoming.humidity_entity && detected.humidity)
        incoming.humidity_entity = detected.humidity;
    }

    // tap_action sadeleştirme: salt varsayılan ise YAML'a yazma.
    if (incoming.tap_action) {
      const ta = incoming.tap_action;
      const isDefault =
        (ta.action === "more-info" || !ta.action) &&
        !ta.entity &&
        !ta.service &&
        !ta.navigation_path &&
        !ta.url_path;
      if (isDefault) delete incoming.tap_action;
    }

    // Boş string'leri temizle (ha-form bazı alanlarda boş string emit eder).
    for (const k of Object.keys(incoming)) {
      if (incoming[k] === "" || incoming[k] === null) delete incoming[k];
    }
    // layout: horizontal varsayılan olduğu için config'e yazmaya gerek yok.
    if (incoming.layout === "horizontal") delete incoming.layout;

    this._config = incoming;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: incoming },
        bubbles: true,
        composed: true,
      })
    );
  }
}

// Kartları tanımla
customElements.define("xiaomi-air-purifier-card", XiaomiAirPurifierCard);
customElements.define(
  "xiaomi-air-purifier-card-editor",
  XiaomiAirPurifierCardEditor
);

// HACS ve Lovelace kart seçici (Add Card / Önizleme) için kaydet
window.customCards = window.customCards || [];
window.customCards.push({
  type: "xiaomi-air-purifier-card",
  name: "Xiaomi Air Purifier Card",
  preview: true,
  description: "Minimalist tile card for Xiaomi air purifiers",
});
