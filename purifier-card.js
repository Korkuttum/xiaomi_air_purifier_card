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

    // Bağlantı/offline algılama. Normalde kullanıcının hiçbir şey
    // yapmasına gerek yok: Xiaomi Miot entegrasyonu her cihaz için
    // otomatik olarak bir "button.<cihaz>_info" diagnostik entity'si
    // oluşturur; kart bunu aynı cihazdaki entity'ler arasından kendisi
    // bulur (bkz. _getOfflineEntityId). offline_entity sadece farklı bir
    // entity kullanmak isteyenler için manuel override amaçlıdır.
    this.offlineEntity = config.offline_entity || null;
    this.staleMinutes = config.stale_minutes || 15;

    // Ek özellikler: filtre halkası, detay penceresi, parçacık/etiket
    // ayarları. Hepsi opsiyonel; verilmezse kart eskisi gibi çalışır.
    this.filterEntity = config.filter_life_entity || null;
    this.filterRing = config.filter_ring || "always"; // always | low | off
    this.pm10Entity = config.pm10_entity || null;
    this.co2Entity = config.co2_entity || null;
    this.tvocEntity = config.tvoc_entity || null;
    this.timerEntity = config.timer_entity || null;
    this.controls = Array.isArray(config.controls) ? config.controls : [];
    this.showAqiLabel = config.air_quality_label === true;
    this.particlesEnabled = config.particles !== false;
    this.pmThresholds =
      Array.isArray(config.pm25_thresholds) && config.pm25_thresholds.length === 4
        ? config.pm25_thresholds.map(Number)
        : [12, 35, 55, 150];

    // İkon (fan ikonu / güç düğmesi) için 3 aksiyon. Varsayılanlar HA
    // Tile card'la aynı tarzda: ikona dokun → cihazı aç/kapat; hold ve
    // double-tap kapalı. Kullanıcı her birini ui_action editöründen
    // istediği gibi değiştirebilir.
    this.iconTapAction = config.icon_tap_action || { action: "toggle" };
    this.iconHoldAction = config.icon_hold_action || { action: "none" };
    this.iconDoubleTapAction =
      config.icon_double_tap_action || { action: "none" };

    // Kart geneli için 3 aksiyon. Varsayılan tap = fan more-info; hold
    // ve double-tap kapalı.
    this.tapAction = config.tap_action || { action: "more-info" };
    this.holdAction = config.hold_action || { action: "none" };
    this.doubleTapAction = config.double_tap_action || { action: "none" };

    this.render();
  }

  // ---------------------------------------------------------------------
  // Action handler — HA Tile card mantığıyla tap / hold / double-tap
  // ---------------------------------------------------------------------
  // pointerdown → hold timer başlat. Belirli süre dolarsa hold action
  // tetiklenir. pointerup'tan önce dolmadıysa hold iptal.
  // pointerup → didHold ise hiçbir şey; değilse: double-tap configure
  // edilmişse 300ms iki tıklama beklemesi, edilmemişse tap'i hemen
  // tetikle (gecikme yaşatmamak için).
  // Mode (cycle) tuşu kendi davranışını korur, action handler'a girmez.
  _attachActionHandler(element, getActions) {
    if (!element || element._xapBound) return;
    element._xapBound = true;

    const HOLD_MS = 500;
    const DOUBLE_TAP_MS = 300;

    let holdTimer = null;
    let didHold = false;
    let pendingTap = null;
    let lastTapTime = 0;

    element.addEventListener("pointerdown", (e) => {
      // Power/mode tuşlarına basınca kart-level handler'ın da
      // tetiklenmesini önle.
      e.stopPropagation();
      if (this._isPreview) return;
      didHold = false;
      const { hold } = getActions();
      if (hold && hold.action && hold.action !== "none") {
        holdTimer = setTimeout(() => {
          didHold = true;
          this._fireHaptic("medium");
          this._executeAction(hold);
        }, HOLD_MS);
      }
    });

    const cancelHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    element.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      if (this._isPreview) return;
      cancelHold();
      if (didHold) return;

      const { tap, double_tap } = getActions();
      const hasDouble =
        double_tap && double_tap.action && double_tap.action !== "none";

      if (!hasDouble) {
        // Double-tap yoksa tek tap'i hemen çalıştır, beklemeye gerek yok.
        this._executeAction(tap);
        return;
      }

      const now = Date.now();
      if (lastTapTime && now - lastTapTime < DOUBLE_TAP_MS) {
        if (pendingTap) {
          clearTimeout(pendingTap);
          pendingTap = null;
        }
        this._executeAction(double_tap);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        pendingTap = setTimeout(() => {
          this._executeAction(tap);
          pendingTap = null;
          lastTapTime = 0;
        }, DOUBLE_TAP_MS);
      }
    });

    element.addEventListener("pointercancel", cancelHold);
    element.addEventListener("pointerleave", cancelHold);
  }

  // HA'nın haptic event'ini fırlat: telefon/tabletlerde dokunsal geri
  // bildirim verir. Yoksa zararsızca yutulur.
  _fireHaptic(type) {
    this.dispatchEvent(
      new CustomEvent("haptic", {
        bubbles: true,
        composed: true,
        detail: type,
      })
    );
  }

  // Bir HA action nesnesini çalıştırır. HA'nın resmi action tiplerini
  // destekler: none / toggle / more-info / call-service / perform-action
  // / navigate / url. "perform-action" 2024+ sürümlerde "call-service"
  // yerine kullanılan yeni isim — ikisi de aynı anda destekleniyor.
  _executeAction(action) {
    if (!action || !action.action || action.action === "none") return;
    switch (action.action) {
      case "toggle": {
        const target = action.entity || this.entity;
        const domain = target.split(".")[0];
        if (!domain) return;
        this._hass.callService(domain, "toggle", { entity_id: target });
        return;
      }
      case "more-info":
        this._openMoreInfo(action.entity || this.entity);
        return;
      case "call-service":
      case "perform-action": {
        const svc = action.perform_action || action.service;
        if (!svc) return;
        const [d, s] = svc.split(".");
        if (!d || !s) return;
        const data = action.data || action.service_data || {};
        const target = action.target;
        this._hass.callService(d, s, data, target);
        return;
      }
      case "navigate":
        if (!action.navigation_path) return;
        history.pushState(null, "", action.navigation_path);
        window.dispatchEvent(new Event("location-changed"));
        return;
      case "url":
        if (!action.url_path) return;
        window.open(action.url_path, "_blank");
        return;
    }
  }

  // Skeleton inşa edildikten sonra power ve mod tuşlarına + ha-card'ın
  // geneline action handler'ları bağlar. Skeleton yeniden inşa edilince
  // eski elemanlar GC'lenir, handler'ları da onlarla birlikte gider.
  _bindActionHandlers() {
    const els = this._els;
    if (!els) return;

    // Power butonu = icon aksiyonları.
    this._attachActionHandler(els.power, () => ({
      tap: this.iconTapAction,
      hold: this.iconHoldAction,
      double_tap: this.iconDoubleTapAction,
    }));

    // Kart geneli (ha-card) = card aksiyonları. Power ve mode tuşları
    // kendi stopPropagation'ları ile bunu bloklar, dolayısıyla bu
    // sadece "boş alana dokunma" için tetiklenir.
    this._attachActionHandler(els.card, () => ({
      tap: this.tapAction,
      hold: this.holdAction,
      double_tap: this.doubleTapAction,
    }));

    // Mode tuşu özel davranışını korur: cycle, ne kadar bekleyip nasıl
    // dokunduğundan bağımsız olarak. Yine de pointerdown stopPropagation
    // ile kart-level handler tetiklenmesin.
    if (els.modeBtn && !els.modeBtn._xapModeBound) {
      els.modeBtn._xapModeBound = true;
      let modeHoldTimer = null;
      let modeDidHold = false;
      els.modeBtn.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        modeDidHold = false;
        if (this._isPreview) return;
        modeHoldTimer = setTimeout(() => {
          modeDidHold = true;
          this._fireHaptic("medium");
          this._openPopup("modes");
        }, 500);
      });
      const cancelModeHold = () => {
        if (modeHoldTimer) {
          clearTimeout(modeHoldTimer);
          modeHoldTimer = null;
        }
      };
      els.modeBtn.addEventListener("pointercancel", cancelModeHold);
      els.modeBtn.addEventListener("pointerleave", cancelModeHold);
      els.modeBtn.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        cancelModeHold();
        if (this._isPreview || modeDidHold) return;
        this._cycleMode();
      });
    }

    // PM2.5 sütununa dokununca detay penceresi.
    if (els.pmCol && !els.pmCol._xapPmBound) {
      els.pmCol._xapPmBound = true;
      els.pmCol.style.cursor = "pointer";
      els.pmCol.addEventListener("pointerdown", (e) => e.stopPropagation());
      els.pmCol.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        if (this._isPreview) return;
        this._openPopup("details");
      });
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

  // Aynı cihazdaki (fan entity'siyle aynı device_id'ye sahip) Xiaomi
  // Miot diagnostik "Info" butonunu otomatik bulur. Bu entity her zaman
  // "button.<slug>_info" formatındadır ve Xiaomi Miot entegrasyonuyla
  // kurulan her cihazda mevcuttur — kullanıcının elle bir entity
  // seçmesine gerek bırakmaz. Sonuç, fan entity'si değişmediği sürece
  // cache'lenir ki her render'da tüm entity registry'si taranmasın.
  _getOfflineEntityId() {
    // Kullanıcı elle offline_entity verdiyse (farklı bir entegrasyon/
    // entity kullanmak istiyorsa) onu kullan, otomatik tespiti atla.
    if (this.offlineEntity) return this.offlineEntity;

    if (this._autoOfflineEntityFor === this.entity) {
      return this._autoOfflineEntity;
    }
    this._autoOfflineEntityFor = this.entity;
    this._autoOfflineEntity = null;

    const reg = this._hass?.entities || this._hass?.entityRegistry;
    if (!reg) return null;
    const fanReg = reg[this.entity];
    const deviceId = fanReg?.device_id;
    if (!deviceId) return null;

    let found = null;
    for (const eid of Object.keys(reg)) {
      if (!eid.startsWith("button.")) continue;
      if (reg[eid]?.device_id !== deviceId) continue;
      if (eid.endsWith("_info")) {
        found = eid;
        break;
      }
      if (!found) found = eid; // fallback: aynı cihazdaki herhangi bir button
    }
    this._autoOfflineEntity = found;
    return found;
  }

  // Kartın kendi arayüz metni için minimal dil algılama. Editördeki
  // 3 katmanlı _t() sistemiyle aynı mantık, ama kart HA'nın localize()
  // fonksiyonuna erişemeyeceği için (bu bir string kartın kendi ürettiği
  // metni, HA'nın bir çeviri key'i değil) burada basitçe kullanıcının
  // dil koduna (tr/en) göre seçim yapıyoruz. HACS üzerinden herkese açık
  // bir kart olduğu için varsayılan İngilizce, sadece Türkçe kullanıcıya
  // Türkçe gösteriyoruz.
  _offlineBadgeText() {
    return this._s("offline");
  }

  // Kartın kendi ürettiği metinler (rozet, pencere başlıkları, hava
  // kalitesi etiketleri). Anahtar -> dil kodu -> metin; dil yoksa en.
  _strings() {
    return {
      offline: { en: "Offline", tr: "Çevrimdışı", de: "Offline", fr: "Hors ligne", es: "Sin conexión" },
      filter: { en: "Filter", tr: "Filtre", de: "Filter", fr: "Filtre", es: "Filtro" },
      speed: { en: "Fan speed", tr: "Fan hızı", de: "Lüfterstufe", fr: "Vitesse", es: "Velocidad" },
      mode: { en: "Mode", tr: "Mod", de: "Modus", fr: "Mode", es: "Modo" },
      timer: { en: "Turn off in", tr: "Kapanma süresi", de: "Ausschalten in", fr: "Arrêt dans", es: "Apagar en" },
      timer_off: { en: "Off", tr: "Kapalı", de: "Aus", fr: "Désactivé", es: "Apagado" },
      controls: { en: "Controls", tr: "Kontroller", de: "Steuerung", fr: "Commandes", es: "Controles" },
      temperature: { en: "Temperature", tr: "Sıcaklık", de: "Temperatur", fr: "Température", es: "Temperatura" },
      humidity: { en: "Humidity", tr: "Nem", de: "Luftfeuchte", fr: "Humidité", es: "Humedad" },
      aq0: { en: "Good", tr: "İyi", de: "Gut", fr: "Bon", es: "Buena" },
      aq1: { en: "Moderate", tr: "Orta", de: "Mäßig", fr: "Modéré", es: "Moderada" },
      aq2: { en: "Poor", tr: "Kötü", de: "Schlecht", fr: "Mauvais", es: "Mala" },
      aq3: { en: "Unhealthy", tr: "Sağlıksız", de: "Ungesund", fr: "Malsain", es: "Insalubre" },
      aq4: { en: "Hazardous", tr: "Tehlikeli", de: "Gefährlich", fr: "Dangereux", es: "Peligrosa" },
    };
  }

  _s(key) {
    const raw = this._hass?.locale?.language || this._hass?.language || "en";
    const lang = raw.toLowerCase().slice(0, 2);
    const entry = this._strings()[key] || {};
    return entry[lang] || entry.en || key;
  }

  // Bir entity'nin TÜM attribute'larını tarar; iki koşuldan biri
  // sağlanırsa true döner:
  //  1) Attribute ADI ".error" ile bitiyor ve değeri boş değil — Xiaomi
  //     Miot entegrasyonu cihaz yanıt vermediğinde her ilgili property
  //     için "<prop>.error" adında bir attribute ekliyor. Bu, hata
  //     mesajının içeriğinden tamamen bağımsız, en güvenilir sinyal.
  //  2) Attribute DEĞERİ "timeout" veya "offline" kelimesini içeriyor —
  //     hata koduna göre mesaj metni değişebiliyor (örn. "Device
  //     operation timeout" ya da "Device offline"); bu ikinci kontrol
  //     farklı adlandırma kullanan entegrasyonlar için yedek görevi
  //     görür.
  _attrsContainTimeout(attrs) {
    if (!attrs) return false;
    for (const key of Object.keys(attrs)) {
      const val = attrs[key];
      if (
        key.endsWith(".error") &&
        val !== undefined &&
        val !== null &&
        val !== ""
      ) {
        return true;
      }
      if (typeof val !== "string") continue;
      const lower = val.toLowerCase();
      if (lower.includes("timeout") || lower.includes("offline")) {
        return true;
      }
    }
    return false;
  }

  // Cihazın gerçekten bağlı olup olmadığını belirler.
  // Öncelik: aynı cihazdaki Xiaomi Miot "Info" butonu (otomatik tespit
  // edilir, bkz. _getOfflineEntityId) ya da elle verilmiş offline_entity.
  // Bu entity'nin TÜM attribute'ları taranır: herhangi birinde "timeout"
  // geçiyorsa cihaz kesin offline sayılır — bu, ana entity'nin
  // "available" attribute'u hep true kalsa ve RPM gibi değerler son
  // bilinen (örn. 0) değerde sabit kalsa bile çalışır. Timeout izi yoksa
  // entity'nin state'i unavailable/unknown mı diye bakılır (klasik
  // durum). Uygun bir entity hiç bulunamazsa, ana fan entity'sinin son
  // güncellenme zamanına bakarak "bayat veri" (stale) fallback'i
  // devreye girer.
  _getOfflineState(fanState) {
    const offlineEntityId = this._isPreview ? null : this._getOfflineEntityId();

    if (offlineEntityId) {
      const st = this._hass?.states[offlineEntityId];
      if (!st) {
        return { offline: true, reason: "disconnected" };
      }

      if (this._attrsContainTimeout(st.attributes)) {
        return { offline: true, reason: "timeout" };
      }

      if (st.state === "unavailable" || st.state === "unknown") {
        return { offline: true, reason: "disconnected" };
      }
      return { offline: false, reason: null };
    }

    if (!this._isPreview && fanState?.last_updated) {
      const lastUpdated = new Date(fanState.last_updated).getTime();
      const ageMinutes = (Date.now() - lastUpdated) / 60000;
      if (ageMinutes > this.staleMinutes) {
        return { offline: true, reason: "stale" };
      }
    }
    return { offline: false, reason: null };
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
    const offlineStatus = this._getOfflineState(fanState);

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
      offline: offlineStatus.offline,
      filterLife: this._isPreview ? 82 : this._getFilterLife(attrs),
    });
    this._refreshPopup();
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
        <div class="xap-offline-badge" style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px 14px;
          border-radius: 12px;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(2px);
          color: #FFFFFF;
          z-index: 5;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">
          <ha-icon icon="mdi:wifi-off" style="--mdc-icon-size: 22px; display:flex; color:#FF5252;"></ha-icon>
          <span class="xap-offline-text" style="
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.3px;
            white-space: nowrap;
            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          "></span>
        </div>
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
      offlineBadge: this.querySelector(".xap-offline-badge"),
      offlineText: this.querySelector(".xap-offline-text"),
    };

    this._destroyParticles();
    this._initParticles();
    this._bindActionHandlers();

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
        <div class="xap-offline-badge" style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px 14px;
          border-radius: 12px;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(2px);
          color: #FFFFFF;
          z-index: 5;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">
          <ha-icon icon="mdi:wifi-off" style="--mdc-icon-size: 22px; display:flex; color:#FF5252;"></ha-icon>
          <span class="xap-offline-text" style="
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.3px;
            white-space: nowrap;
            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          "></span>
        </div>
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
      offlineBadge: this.querySelector(".xap-offline-badge"),
      offlineText: this.querySelector(".xap-offline-text"),
    };

    this._destroyParticles();
    this._initParticles();
    this._bindActionHandlers();

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
    els.pmUnit.textContent =
      this.showAqiLabel && this._getAqiLabel(d.pm25) ? this._getAqiLabel(d.pm25) : d.pm25Unit;

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

    // Offline durumu: rozet göster, kartı soluklaştır, animasyonu
    // (varsa) durdur. Bu blok animasyon açma/kapama bloğundan SONRA
    // çalışır ki cache'lenmiş "on" state'e rağmen spin'i geçersiz kılsın.
    if (d.offline) {
      els.offlineBadge.style.display = "flex";
      els.offlineText.textContent = this._offlineBadgeText();
      els.card.style.filter = "grayscale(0.8) opacity(0.6)";
      els.fanIcon.classList.remove("spinning");
      els.fanIcon.style.animationDuration = "";
    } else {
      els.offlineBadge.style.display = "none";
      els.card.style.filter = "";
    }

    this._updateFilterRing(d);
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
    els.pmUnit.textContent =
      this.showAqiLabel && this._getAqiLabel(d.pm25) ? this._getAqiLabel(d.pm25) : d.pm25Unit;

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

    // Offline durumu: rozet göster, kartı soluklaştır, animasyonu durdur.
    if (d.offline) {
      els.offlineBadge.style.display = "flex";
      els.offlineText.textContent = this._offlineBadgeText();
      els.card.style.filter = "grayscale(0.8) opacity(0.6)";
      els.fanIcon.classList.remove("spinning");
      els.fanIcon.style.animationDuration = "";
    } else {
      els.offlineBadge.style.display = "none";
      els.card.style.filter = "";
    }

    this._updateFilterRing(d);
    this._updateParticleSystem(d);
  }

  // ---------------------------------------------------------------------
  // Toz parçacıkları (Xiaomi uygulamasındakine benzer "emiliyor" efekti)
  // ---------------------------------------------------------------------
  _initParticles() {
    const canvas = this._els.particlesCanvas;
    if (!canvas) return;
    if (!this.particlesEnabled) {
      canvas.style.display = "none";
      return;
    }
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

    this._particlesActive = d.state === "on" && !d.offline;

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
    const t = this.pmThresholds || [12, 35, 55, 150];
    if (num <= t[0]) return "#4CAF50";
    if (num <= t[1]) return "#FFC107";
    if (num <= t[2]) return "#FF9800";
    if (num <= t[3]) return "#F44336";
    return "#9C27B0";
  }

  _getAqiLabel(value) {
    const num = Number(value);
    if (value === "--" || value === undefined || value === null || Number.isNaN(num)) {
      return "";
    }
    const t = this.pmThresholds || [12, 35, 55, 150];
    const idx = num <= t[0] ? 0 : num <= t[1] ? 1 : num <= t[2] ? 2 : num <= t[3] ? 3 : 4;
    return this._s(`aq${idx}`);
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
    this._applyStep(steps[nextIndex], nextIndex);
  }

  _applyStep(next, nextIndex) {
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


  // ---------------------------------------------------------------------
  // Filtre ömrü + halka
  // ---------------------------------------------------------------------
  // Filtre yüzdesi: önce filter_life_entity, yoksa fan attribute'ları
  // (Miot: filter_life_level / filter_life_remaining / filter_life).
  // Sayı bulunamazsa null döner ve halka çizilmez.
  _getFilterLife(attrs) {
    let raw = null;
    if (this.filterEntity) {
      const st = this._hass?.states[this.filterEntity];
      if (st && st.state !== "unavailable" && st.state !== "unknown") raw = st.state;
    } else {
      raw =
        attrs?.filter_life_level ??
        attrs?.filter_life_remaining ??
        attrs?.filter_life ??
        null;
    }
    const num = Number(raw);
    if (raw === null || raw === "" || Number.isNaN(num)) return null;
    return Math.max(0, Math.min(100, num));
  }

  _filterColor(pct) {
    if (pct > 20) return "#4CAF50";
    if (pct > 10) return "#FF9800";
    return "#F44336";
  }

  // Güç düğmesinin (fan ikonunun) etrafına ilerleme halkası. Halka ikonun
  // kardeşi olarak çizilir, bu yüzden fan dönerken sabit kalır.
  _updateFilterRing(d) {
    const power = this._els?.power;
    if (!power) return;
    const pct = d.filterLife;
    const visible =
      this.filterRing !== "off" &&
      pct !== null &&
      pct !== undefined &&
      (this.filterRing !== "low" || pct <= 20);

    if (!visible) {
      if (this._ring) this._ring.style.display = "none";
      return;
    }
    if (!this._ring || !power.contains(this._ring)) {
      power.style.position = "relative";
      const R = 17;
      const wrap = document.createElement("div");
      wrap.className = "xap-filter-ring";
      wrap.style.cssText =
        "position:absolute; inset:-1px; pointer-events:none; z-index:2;";
      wrap.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 38 38" style="display:block; overflow:visible;">
        <circle cx="19" cy="19" r="${R}" fill="none" stroke="rgba(var(--rgb-secondary-text-color), 0.2)" stroke-width="2"/>
        <circle class="xap-ring-arc" cx="19" cy="19" r="${R}" fill="none" stroke-width="2" stroke-linecap="round" transform="rotate(-90 19 19)" style="transition: stroke-dasharray .4s ease, stroke .4s ease;"/>
      </svg>`;
      power.appendChild(wrap);
      this._ring = wrap;
      this._ringArc = wrap.querySelector(".xap-ring-arc");
    }
    const C = 2 * Math.PI * 17;
    this._ring.style.display = "";
    this._ringArc.setAttribute("stroke-dasharray", `${(C * pct) / 100} ${C}`);
    this._ringArc.setAttribute("stroke", this._filterColor(pct));
  }

  // ---------------------------------------------------------------------
  // Detay ve mod pencereleri
  // ---------------------------------------------------------------------
  _esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  _stepLabel(step) {
    if (step.level) return `${step.presetMode ? step.presetMode + " " : ""}${step.level}`;
    return (step.presetMode || step.label || "?").toString();
  }

  // Pencere kartın bulunduğu yerden açılır: alt kenarı kartın alt kenarıyla
  // hizalı, içerik arttıkça YUKARI doğru uzar. Arkada karartma yok; boş
  // alana dokunmak ya da Esc kapatır. Yer yetmezse üstten 8px boşluk
  // bırakıp içeride kaydırılır.
  _openPopup(kind) {
    if (this._isPreview || !this._hass) return;
    this._closePopup();
    const ov = document.createElement("div");
    ov.style.cssText =
      "position:fixed; inset:0; z-index:9999; font-family:var(--paper-font-body1_-_font-family, Roboto, sans-serif);";
    const panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed; box-sizing:border-box; overflow:auto; padding:16px; scrollbar-width:thin; scrollbar-color:rgba(var(--rgb-secondary-text-color, 155,155,155), 0.4) transparent; background:var(--ha-card-background, var(--card-background-color, #1c1c1c)); color:var(--primary-text-color, #e1e1e1); border:1px solid var(--divider-color, rgba(255,255,255,0.12)); border-radius:var(--ha-card-border-radius, 12px); box-shadow:0 8px 28px rgba(0,0,0,0.35); transform-origin:bottom center; animation:xap-pop-in .18s ease-out;";
    if (!document.getElementById("xap-pop-style2")) {
      const st = document.createElement("style");
      st.id = "xap-pop-style2";
      st.textContent =
        "@keyframes xap-pop-in{from{opacity:0;transform:translateY(12px) scaleY(.9)}to{opacity:1;transform:none}}" +
        "@keyframes xap-grow-up{from{clip-path:inset(100% 0 0 0)}to{clip-path:inset(0)}}" +
        "@keyframes xap-grow-down{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0)}}";
      document.head.appendChild(st);
    }
    ov.appendChild(panel);
    ov.addEventListener("pointerdown", (e) => {
      if (e.target === ov) this._closePopup();
    });
    panel.addEventListener("click", (e) => this._popupClick(e));
    panel.addEventListener("pointerdown", (e) => this._popupPointerDown(e));
    panel.addEventListener("pointermove", (e) => this._popupPointerMove(e));
    panel.addEventListener("pointerup", () => this._popupPointerUp());
    panel.addEventListener("pointercancel", () => this._popupPointerUp());
    panel.addEventListener("keydown", (e) => this._popupKeyDown(e));
    this._popupKeyHandler = (e) => {
      if (e.key === "Escape") this._closePopup();
    };
    this._popupReposition = () => this._positionPopup();
    document.addEventListener("keydown", this._popupKeyHandler);
    window.addEventListener("resize", this._popupReposition);
    window.addEventListener("scroll", this._popupReposition, true);
    document.body.appendChild(ov);
    this._popup = { ov, panel, kind };
    this._renderPopup();
    this._positionPopup();
  }

  // Pencerenin zeminini, çerçevesini, yazı rengini ve fontunu kartın kendi
  // hesaplanmış stilinden alır; böylece hangi tema/özel stil kullanılırsa
  // kullanılsın pencere kartla aynı görünür.
  _matchCardSurface(p) {
    const card = this._els?.card;
    if (!card) return;
    const cs = getComputedStyle(card);
    const st = p.panel.style;
    if (p.kind === "modes") {
      // Düğmenin üstüne biner, saydam olmamalı: kartın zemini (renk +
      // varsa gradyan) opak bir tabanın üstüne katman olarak konur.
      const layers = [];
      if (cs.backgroundImage && cs.backgroundImage !== "none") layers.push(cs.backgroundImage);
      layers.push(`linear-gradient(${cs.backgroundColor}, ${cs.backgroundColor})`);
      layers.push("linear-gradient(var(--card-background-color, #1c1c1c), var(--card-background-color, #1c1c1c))");
      st.background = layers.join(", ");
      st.borderStyle = cs.borderLeftStyle;
      st.borderColor = cs.borderLeftColor;
      st.borderWidth = cs.borderLeftWidth;
    } else {
      st.backgroundColor = cs.backgroundColor;
      st.backgroundImage = cs.backgroundImage;
      st.backdropFilter = cs.backdropFilter;
      st.webkitBackdropFilter = cs.webkitBackdropFilter || cs.backdropFilter;
      st.borderStyle = cs.borderLeftStyle;
      st.borderColor = cs.borderLeftColor;
      st.borderWidth = cs.borderLeftWidth;
    }
    st.color = cs.color;
    st.fontFamily = cs.fontFamily;
  }

  _positionPopup() {
    const p = this._popup;
    if (!p) return;
    this._matchCardSurface(p);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (p.kind === "modes") {
      // Seçili satır mod butonunun tam üstüne gelecek şekilde açılır.
      const btn = (this._els?.modeBtn || this).getBoundingClientRect();
      p.panel.style.width = "auto";
      p.panel.style.maxHeight = `${vh - 16}px`;
      const w = p.panel.offsetWidth;
      const h = Math.min(p.panel.scrollHeight + 2, vh - 16);
      const left = Math.max(8, Math.min(btn.left - 1, vw - w - 8));
      const top = Math.max(8, Math.min(btn.top - (p._activeIdx || 0) * 50 - 1, vh - h - 8));
      p.panel.style.left = `${left}px`;
      p.panel.style.top = `${top}px`;
      return;
    }
    // Kartın kendisi uzuyormuş gibi: aynı genişlik, aynı zemin/çerçeve,
    // kartla arasında dikiş yok. Yukarıda yer varsa yukarı, yoksa aşağı
    // doğru açılır.
    const card = this._els?.card;
    const rect = (card || this).getBoundingClientRect();
    if (p._radius === undefined) {
      p._radius = (card && getComputedStyle(card).borderTopLeftRadius) || "12px";
    }
    const R = p._radius;
    const width = Math.min(Math.max(rect.width, 240), vw);
    const left = Math.max(0, Math.min(rect.left, vw - width));
    p.panel.style.width = `${width}px`;
    p.panel.style.left = `${left}px`;
    p.panel.style.boxShadow = "none";
    // İçeriğin gerçek yüksekliğine göre yön: sığan yöne aç, ikisine de
    // sığmıyorsa geniş olan yöne açıp içeride kaydır.
    p.panel.style.maxHeight = "none";
    const natural = p.panel.scrollHeight + 1;
    const spaceUp = rect.top - 4;
    const spaceDown = vh - rect.bottom - 4;
    const up =
      natural <= spaceUp ? true : natural <= spaceDown ? false : spaceUp >= spaceDown;
    if (up) {
      p.panel.style.top = "auto";
      p.panel.style.bottom = `${vh - rect.top}px`;
      p.panel.style.maxHeight = `${Math.max(120, rect.top - 4)}px`;
      p.panel.style.borderRadius = `${R} ${R} 0 0`;
      p.panel.style.borderBottomWidth = "0";
      p.panel.style.transformOrigin = "bottom center";
    } else {
      p.panel.style.bottom = "auto";
      p.panel.style.top = `${rect.bottom}px`;
      p.panel.style.maxHeight = `${Math.max(120, vh - rect.bottom - 4)}px`;
      p.panel.style.borderRadius = `0 0 ${R} ${R}`;
      p.panel.style.borderTopWidth = "0";
      p.panel.style.transformOrigin = "top center";
    }
    if (card) {
      card.style.borderTopLeftRadius = up ? "0" : "";
      card.style.borderTopRightRadius = up ? "0" : "";
      card.style.borderBottomLeftRadius = up ? "" : "0";
      card.style.borderBottomRightRadius = up ? "" : "0";
      card.style.borderTopColor = up ? "transparent" : "";
      card.style.borderBottomColor = up ? "" : "transparent";
    }
    if (!p._animSet) {
      p._animSet = true;
      p.panel.style.animation = `${up ? "xap-grow-up" : "xap-grow-down"} .2s ease-out`;
    }
  }

  _closePopup() {
    if (!this._popup) return;
    this._popup.ov.remove();
    this._popup = null;
    const c = this._els?.card;
    if (c) {
      c.style.borderTopLeftRadius = "";
      c.style.borderTopRightRadius = "";
      c.style.borderBottomLeftRadius = "";
      c.style.borderBottomRightRadius = "";
      c.style.borderTopColor = "";
      c.style.borderBottomColor = "";
    }
    document.removeEventListener("keydown", this._popupKeyHandler);
    window.removeEventListener("resize", this._popupReposition);
    window.removeEventListener("scroll", this._popupReposition, true);
  }

  _refreshPopup() {
    if (!this._popup) return;
    // Kullanıcı kaydırıcıyı sürüklerken yeniden çizip bozma.
    if (this._dragging) return;
    this._renderPopup();
  }

  _sensorRow(label, entityId, fallbackUnit) {
    if (!entityId) return null;
    const st = this._hass.states[entityId];
    if (!st || st.state === "unavailable" || st.state === "unknown") return null;
    const unit = st.attributes?.unit_of_measurement || fallbackUnit || "";
    return { label, value: `${st.state}${unit ? " " + unit : ""}` };
  }

  // Mod adımı için HA'nın kendi fan/preset ikon diline yakın MDI ikonu.
  _stepIcon(step) {
    const preset = (step.presetMode || "").toString().toLowerCase();
    if (step.level) return `mdi:fan-speed-${Math.min(step.level, 3)}`;
    const map = {
      auto: "mdi:brightness-auto",
      sleep: "mdi:moon-waning-crescent",
      night: "mdi:moon-waning-crescent",
      favorite: "mdi:heart",
      silent: "mdi:volume-off",
      low: "mdi:fan-speed-1",
      medium: "mdi:fan-speed-2",
      high: "mdi:fan-speed-3",
      turbo: "mdi:fan-speed-3",
      manual: "mdi:fan",
    };
    return map[preset] || "mdi:fan";
  }

  _renderPopup() {
    const p = this._popup;
    if (!p) return;
    const fan = this._hass.states[this.entity];
    if (!fan) return;
    const attrs = fan.attributes || {};
    const steps = this._getModeSteps(attrs);
    const activeIdx = this._getCurrentStepIndex(steps, attrs);
    const name = attrs.friendly_name || this.entity;

    const ACTIVE = "var(--primary-color, #03a9f4)";
    const IDLE_BG = "rgba(var(--rgb-secondary-text-color, 155,155,155), 0.12)";

    // HA'nın ikonlu seçim butonları: kare, yuvarlak köşe, seçili olan
    // dolu primary renk.
    const tile = (act, data, icon, label, active) => `<button data-act="${act}" ${data} title="${this._esc(label)}" style="
        cursor:pointer; border:none; border-radius:18px; width:64px; height:60px; padding:0;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
        background:${active ? ACTIVE : IDLE_BG}; color:${active ? "#fff" : "var(--secondary-text-color)"}; font:inherit;">
        <ha-icon icon="${icon}" style="--mdc-icon-size:24px; display:flex;"></ha-icon>
        <span style="font-size:10px; max-width:56px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this._esc(label)}</span>
      </button>`;
    // HA'nın ha-control-select görünümü: tek parça yuvarlak çubuk içinde
    // eşit genişlikte metin seçenekleri.
    const segmented = (act, items) => `<div style="display:flex; background:color-mix(in srgb, var(--primary-text-color, #e1e1e1) 12%, transparent); border-radius:25px; padding:4px; gap:2px;">${items
      .map(([dataAttr, label, active]) => `<button data-act="${act}" ${dataAttr} style="
        flex:1; cursor:pointer; border:none; border-radius:21px; padding:10px 4px; font:inherit; font-size:13px; font-weight:500; white-space:nowrap;
        background:${active ? "var(--primary-color, #03a9f4)" : "transparent"}; color:${active ? "var(--text-primary-color, #fff)" : "var(--primary-text-color)"};">${this._esc(label)}</button>`)
      .join("")}</div>`;
    const section = (title, body) =>
      `<div style="margin-top:12px;"><div style="font-size:12px; color:var(--secondary-text-color); margin-bottom:6px;">${this._esc(title)}</div>${body}</div>`;
    // xiaomi-vacuum-map-card'ın mod seçiminden uyarlanan iki görünüm:
    // 1) pillRow: hap biçimli kapta 50px yuvarlak ikon butonları, seçili
    //    olan dolu. 2) dropdownList: dikey liste, satırda 50px ikon +
    //    mod adı, seçili satır tam genişlikte dolu hap.
    const BIG = "25px";
    const PRIMARY = "var(--primary-color, #03a9f4)";
    const SECONDARY = "color-mix(in srgb, var(--primary-text-color, #e1e1e1) 12%, transparent)";
    const ON_PRIMARY = "var(--text-primary-color, #fff)";
    const pillRow = () => `<div style="display:flex; flex-wrap:wrap; justify-content:center; border-radius:${BIG}; overflow:hidden; background:${SECONDARY};">${steps
      .map((st, i) => `<button data-act="step" data-i="${i}" title="${this._esc(this._stepLabel(st))}" style="
          cursor:pointer; border:none; padding:0; width:50px; height:50px; display:flex; align-items:center; justify-content:center;
          border-radius:${BIG}; background:${i === activeIdx ? PRIMARY : "transparent"}; color:${i === activeIdx ? ON_PRIMARY : "var(--primary-text-color)"};">
          <ha-icon icon="${this._stepIcon(st)}" style="--mdc-icon-size:24px; display:flex;"></ha-icon></button>`)
      .join("")}</div>`;
    const dropdownList = () => `<div style="display:flex; flex-direction:column;">${steps
      .map((st, i) => {
        const sel = i === activeIdx;
        const first = i === 0;
        const last = i === steps.length - 1;
        const cellRadius = sel ? `${BIG} 0 0 ${BIG}` : `${first ? BIG : "0"} ${first ? BIG : "0"} ${last ? BIG : "0"} ${last ? BIG : "0"}`;
        return `<button data-act="step" data-i="${i}" style="
            cursor:pointer; border:none; padding:0; display:flex; align-items:center; text-align:left; font:inherit; height:50px;
            border-radius:${sel ? BIG : "0"}; background:${sel ? PRIMARY : "transparent"}; color:${sel ? ON_PRIMARY : "var(--primary-text-color)"};">
            <span style="width:50px; height:50px; flex:none; display:flex; align-items:center; justify-content:center; border-radius:${cellRadius}; background:${sel ? PRIMARY : SECONDARY};">
              <ha-icon icon="${this._stepIcon(st)}" style="--mdc-icon-size:24px; display:flex;"></ha-icon></span>
            <span style="padding:0 18px 0 10px; white-space:nowrap;">${this._esc(this._stepLabel(st))}</span></button>`;
      })
      .join("")}</div>`;
    const activeLabel = activeIdx >= 0 && steps[activeIdx] ? this._stepLabel(steps[activeIdx]) : "";

    let body = "";
    if (p.kind === "modes") {
      body = dropdownList();
    } else {
      const pm = this._readValue(this.pm25Entity, attrs.pm25 || attrs.aqi || attrs.air_quality, "µg/m³");
      const t = this._readValue(this.temperatureEntity, attrs.temperature ?? attrs.temp, "°C");
      const h = this._readValue(this.humidityEntity, attrs.humidity, "%");
      const rows = [
        pm.value !== "--" && { label: "PM2.5", value: `${pm.value} ${pm.unit}`, color: this._getPMColor(pm.value) },
        this._sensorRow("PM10", this.pm10Entity, "µg/m³"),
        this._sensorRow("CO₂", this.co2Entity, "ppm"),
        this._sensorRow("TVOC", this.tvocEntity, ""),
        t.value !== "--" && { label: this._s("temperature"), value: `${t.value}${t.unit}` },
        h.value !== "--" && { label: this._s("humidity"), value: `${h.value}${h.unit}` },
      ].filter(Boolean);
      const life = this._getFilterLife(attrs);
      body += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px;">${rows
        .map((r) => `<div><div style="font-size:12px; color:var(--secondary-text-color);">${this._esc(r.label)}</div><div style="font-size:17px; font-weight:500; white-space:nowrap; ${r.color ? `color:${r.color};` : ""}">${this._esc(r.value)}</div></div>`)
        .join("")}</div>`;
      if (life !== null) {
        body += section(
          `${this._s("filter")} · ${Math.round(life)}%`,
          `<div style="height:8px; border-radius:4px; background:${IDLE_BG}; overflow:hidden;"><div style="height:100%; width:${life}%; background:${this._filterColor(life)}; border-radius:4px;"></div></div>`
        );
      }
      if (typeof attrs.percentage === "number") {
        const stepSize = attrs.percentage_step > 0 ? attrs.percentage_step : 1;
        const val = Math.round(attrs.percentage);
        // HA ha-control-slider görünümü: kalın, yuvarlak, dolgulu çubuk
        // ve ucunda ince tutamaç.
        body += section(
          `${this._s("speed")} · ${val}%`,
          `<div data-act="slider" data-step="${stepSize}" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${val}"
              style="position:relative; height:44px; border-radius:22px; background:color-mix(in srgb, ${ACTIVE} 20%, transparent); overflow:hidden; cursor:pointer; touch-action:none; outline:none;">
              <div class="xap-slider-fill" style="position:absolute; inset:0 auto 0 0; width:${val}%; background:${ACTIVE}; border-radius:22px 0 0 22px;"></div>
              <div class="xap-slider-handle" style="position:absolute; top:50%; left:calc(${val}% - 10px); width:4px; height:24px; margin-top:-12px; border-radius:2px; background:#fff; ${val <= 0 ? "display:none;" : ""}"></div>
           </div>`
        );
      }
      if (steps.length) {
        body += section(`${this._s("mode")}${activeLabel ? " · " + activeLabel : ""}`, pillRow());
      }
      if (this.timerEntity) {
        const cur = Number(this._hass.states[this.timerEntity]?.state);
        body += section(
          this._s("timer"),
          segmented(
            "timer",
            [0, 30, 60, 120, 240].map((m) => [
              `data-v="${m}"`,
              m === 0 ? this._s("timer_off") : m < 60 ? `${m}m` : `${m / 60}h`,
              cur === m,
            ])
          )
        );
      }
      if (this.controls.length) {
        body += section(
          this._s("controls"),
          `<div style="display:flex; flex-wrap:wrap; gap:8px;">${this.controls
            .map((eid) => {
              const st = this._hass.states[eid];
              if (!st) return "";
              const on = st.state === "on" || st.state === "locked";
              const isLock = eid.startsWith("lock.");
              const icon =
                st.attributes?.icon ||
                (isLock ? (on ? "mdi:lock" : "mdi:lock-open-variant") : on ? "mdi:toggle-switch" : "mdi:toggle-switch-off");
              return tile("control", `data-e="${this._esc(eid)}"`, icon, st.attributes?.friendly_name || eid, on);
            })
            .join("")}</div>`
        );
      }
    }

    if (p.kind === "modes") {
      p.panel.style.padding = "0";
      p.panel.style.borderRadius = "25px";
      p.panel.innerHTML = body;
      p._activeIdx = Math.max(0, activeIdx);
    } else {
      p.panel.style.padding = "16px";
      p.panel.style.borderRadius = "var(--ha-card-border-radius, 12px)";
      p.panel.innerHTML = `<div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="font-size:18px; font-weight:500;">${this._esc(name)}</div>
        <button data-act="close" style="cursor:pointer; border:none; background:transparent; color:var(--secondary-text-color); font-size:22px; line-height:1;">×</button>
      </div>${body}`;
    }
    this._positionPopup();
  }

  // Kaydırıcıda parmağın/imlecin konumunu yüzdeye çevirir ve çubuğu
  // anında günceller. Servis çağrısı sadece bırakınca yapılır.
  _sliderUpdate(clientX) {
    const el = this._popup?.panel.querySelector('[data-act="slider"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const step = Number(el.dataset.step) || 1;
    let v = Math.round(((clientX - r.left) / r.width) * 100 / step) * step;
    v = Math.max(0, Math.min(100, v));
    el.querySelector(".xap-slider-fill").style.width = `${v}%`;
    const handle = el.querySelector(".xap-slider-handle");
    handle.style.left = `calc(${v}% - 10px)`;
    handle.style.display = v <= 0 ? "none" : "";
    el.setAttribute("aria-valuenow", String(v));
    this._sliderValue = v;
    return v;
  }

  _sliderCommit() {
    if (this._sliderValue === null || this._sliderValue === undefined) return;
    this._hass.callService("fan", "set_percentage", {
      entity_id: this.entity,
      percentage: this._sliderValue,
    });
    this._sliderValue = null;
  }

  _popupPointerDown(e) {
    const el = e.target.closest?.('[data-act="slider"]');
    if (!el) return;
    this._dragging = true;
    el.setPointerCapture?.(e.pointerId);
    this._sliderUpdate(e.clientX);
  }

  _popupPointerMove(e) {
    if (this._dragging) this._sliderUpdate(e.clientX);
  }

  _popupPointerUp() {
    if (!this._dragging) return;
    this._dragging = false;
    this._sliderCommit();
  }

  _popupKeyDown(e) {
    const el = e.target.closest?.('[data-act="slider"]');
    if (!el) return;
    const step = Number(el.dataset.step) || 1;
    const cur = Number(el.getAttribute("aria-valuenow")) || 0;
    let v = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") v = cur + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v = cur - step;
    if (v === null) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    this._sliderUpdate(r.left + (Math.max(0, Math.min(100, v)) / 100) * r.width);
    this._sliderCommit();
  }

  _popupClick(e) {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") return this._closePopup();
    if (act === "step") {
      const attrs = this._hass.states[this.entity]?.attributes || {};
      const steps = this._getModeSteps(attrs);
      const i = Number(btn.dataset.i);
      if (steps[i]) this._applyStep(steps[i], i);
      if (this._popup?.kind === "modes") this._closePopup();
    } else if (act === "timer") {
      const domain = this.timerEntity.split(".")[0];
      this._hass.callService(domain, "set_value", {
        entity_id: this.timerEntity,
        value: Number(btn.dataset.v),
      });
    } else if (act === "control") {
      const eid = btn.dataset.e;
      const domain = eid.split(".")[0];
      if (domain === "lock") {
        const locked = this._hass.states[eid]?.state === "locked";
        this._hass.callService("lock", locked ? "unlock" : "lock", { entity_id: eid });
      } else {
        this._hass.callService("homeassistant", "toggle", { entity_id: eid });
      }
    }
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
    this._closePopup();
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
      Icon: { tr: "İkon" },
      Card: { tr: "Kart" },
      "Content layout": { tr: "İçerik düzeni" },
      Horizontal: { tr: "Yatay" },
      Vertical: { tr: "Dikey" },
      "Tap behavior": { tr: "Dokunma davranışı" },
      "Hold behavior": { tr: "Basılı tutma davranışı" },
      "Double tap behavior": { tr: "Çift dokunma davranışı" },
      "PM2.5 sensor": { tr: "PM2.5 sensörü" },
      "Temperature sensor": { tr: "Sıcaklık sensörü" },
      "Humidity sensor": { tr: "Nem sensörü" },
      "Connectivity sensor": { tr: "Bağlantı sensörü (otomatik algılanır, override için)" },
      Extras: { tr: "Ek özellikler" },
      "Filter life sensor": { tr: "Filtre ömrü sensörü" },
      "PM10 sensor": { tr: "PM10 sensörü" },
      "CO2 sensor": { tr: "CO₂ sensörü" },
      "TVOC sensor": { tr: "TVOC sensörü" },
      "Timer (number, minutes)": { tr: "Zamanlayıcı (number, dakika)" },
      "Extra controls (child lock, LED, buzzer...)": { tr: "Ek kontroller (çocuk kilidi, LED, ses...)" },
      "Filter ring": { tr: "Filtre halkası" },
      "Always": { tr: "Her zaman" },
      "Only when low": { tr: "Sadece düşükken" },
      "Hidden": { tr: "Gizli" },
      "Show air quality label": { tr: "Hava kalitesi etiketini göster" },
      "Dust particles animation": { tr: "Toz parçacığı animasyonu" },
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

      // SENSÖRLER paneli — fan'in PM2.5 / sıcaklık / nem yardımcı sensörleri
      // ve opsiyonel bağlantı/offline sensörü (örn. RPM). Fan seçildiğinde
      // pm25/temp/humidity otomatik tespit edilip boş alanlara yazılır.
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
          {
            name: "offline_entity",
            selector: { entity: {} },
          },
        ],
      },

      // EK ÖZELLİKLER paneli — filtre halkası, detay penceresindeki ek
      // sensörler, zamanlayıcı ve ek kontroller.
      {
        type: "expandable",
        name: "",
        title: this._t(null, "Extras"),
        iconPath:
          "M12,2L4.5,20.29L5.21,21L12,18L18.79,21L19.5,20.29L12,2Z",
        schema: [
          { name: "filter_life_entity", selector: { entity: { domain: ["sensor"] } } },
          { name: "pm10_entity", selector: { entity: { domain: ["sensor"] } } },
          { name: "co2_entity", selector: { entity: { domain: ["sensor"] } } },
          { name: "tvoc_entity", selector: { entity: { domain: ["sensor"] } } },
          { name: "timer_entity", selector: { entity: { domain: ["number", "input_number"] } } },
          {
            name: "controls",
            selector: { entity: { multiple: true, domain: ["switch", "input_boolean", "lock"] } },
          },
          {
            name: "filter_ring",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "always", label: this._t(null, "Always") },
                  { value: "low", label: this._t(null, "Only when low") },
                  { value: "off", label: this._t(null, "Hidden") },
                ],
              },
            },
          },
          { name: "air_quality_label", selector: { boolean: {} } },
          { name: "particles", selector: { boolean: {} } },
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

      // ETKİLEŞİM paneli — HA Tile card mantığıyla iki alt panele
      // bölündü: "İkon" (fan ikonu/güç düğmesi) ve "Kart" (geri kalan
      // alan). Her birinde tap / hold / double-tap için ui_action
      // selector. Varsayılanlar (toggle/more-info/none) selector'ün
      // kendi `default_action` parametresiyle gösteriliyor; YAML'a
      // yazılmıyor — _valueChanged temizliyor.
      {
        type: "expandable",
        name: "",
        title: this._t(null, "Interactions"),
        iconPath:
          "M11,16.5L5.5,11L7,9.5L11,13.5L17,7.5L18.5,9L11,16.5Z",
        schema: [
          {
            type: "expandable",
            name: "",
            title: this._t(null, "Icon"),
            iconPath:
              "M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M15.5,8A1.5,1.5 0 0,0 14,9.5A1.5,1.5 0 0,0 15.5,11A1.5,1.5 0 0,0 17,9.5A1.5,1.5 0 0,0 15.5,8M8.5,8A1.5,1.5 0 0,0 7,9.5A1.5,1.5 0 0,0 8.5,11A1.5,1.5 0 0,0 10,9.5A1.5,1.5 0 0,0 8.5,8M12,17.5C14.33,17.5 16.31,16.04 17.11,14H6.89C7.69,16.04 9.67,17.5 12,17.5Z",
            schema: [
              {
                name: "icon_tap_action",
                selector: { ui_action: { default_action: "toggle" } },
              },
              {
                name: "icon_hold_action",
                selector: { ui_action: { default_action: "none" } },
              },
              {
                name: "icon_double_tap_action",
                selector: { ui_action: { default_action: "none" } },
              },
            ],
          },
          {
            type: "expandable",
            name: "",
            title: this._t(null, "Card"),
            iconPath:
              "M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,5V19H5V5H19Z",
            schema: [
              {
                name: "tap_action",
                selector: { ui_action: { default_action: "more-info" } },
              },
              {
                name: "hold_action",
                selector: { ui_action: { default_action: "none" } },
              },
              {
                name: "double_tap_action",
                selector: { ui_action: { default_action: "none" } },
              },
            ],
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
      case "offline_entity":
        return this._t(null, "Connectivity sensor");
      case "filter_life_entity":
        return this._t(null, "Filter life sensor");
      case "pm10_entity":
        return this._t(null, "PM10 sensor");
      case "co2_entity":
        return this._t(null, "CO2 sensor");
      case "tvoc_entity":
        return this._t(null, "TVOC sensor");
      case "timer_entity":
        return this._t(null, "Timer (number, minutes)");
      case "controls":
        return this._t(null, "Extra controls (child lock, LED, buzzer...)");
      case "filter_ring":
        return this._t(null, "Filter ring");
      case "air_quality_label":
        return this._t(null, "Show air quality label");
      case "particles":
        return this._t(null, "Dust particles animation");
      case "layout":
        return this._t(
          "ui.panel.lovelace.editor.card.tile.content_layout",
          "Content layout"
        );
      case "tap_action":
      case "icon_tap_action":
        return this._t(
          "ui.panel.lovelace.editor.card.generic.tap_action",
          "Tap behavior"
        );
      case "hold_action":
      case "icon_hold_action":
        return this._t(
          "ui.panel.lovelace.editor.card.generic.hold_action",
          "Hold behavior"
        );
      case "double_tap_action":
      case "icon_double_tap_action":
        return this._t(
          "ui.panel.lovelace.editor.card.generic.double_tap_action",
          "Double tap behavior"
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
    if (!data.hold_action) data.hold_action = { action: "none" };
    if (!data.double_tap_action) data.double_tap_action = { action: "none" };
    if (!data.icon_tap_action) data.icon_tap_action = { action: "toggle" };
    if (!data.icon_hold_action) data.icon_hold_action = { action: "none" };
    if (!data.icon_double_tap_action)
      data.icon_double_tap_action = { action: "none" };
    // Layout config'te tutulmasa bile (varsayılan = horizontal, YAML'da
    // gerekmiyor) ha-form kutucuğunun seçili görünmesi için burada
    // doldur. _valueChanged'da horizontal hâlâ siliniyor, böylece YAML
    // çıktısı temiz kalır ama UI'da kutu hep seçili görünür.
    if (!data.layout) {
      data.layout = "horizontal";
    }
    if (!data.filter_ring) data.filter_ring = "always";
    if (data.particles === undefined) data.particles = true;

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

    // tap_action sadeleştirme: 6 action alanı için ayrı ayrı varsayılan
    // ile karşılaştır. Yalnızca varsayılan-dışında bir ayar varsa YAML'a
    // yazıyoruz; aksi halde alan kaldırılır ve config temiz kalır.
    const isDefaultAction = (a, defaultAction) => {
      if (!a) return true;
      if (a.action !== defaultAction) return false;
      // Action tipi varsayılansa ama ek parametre varsa (örn. entity,
      // service vb.) yine de tutmamız gerek.
      const keys = Object.keys(a).filter((k) => k !== "action");
      for (const k of keys) {
        const v = a[k];
        if (v !== undefined && v !== null && v !== "" &&
            !(typeof v === "object" && Object.keys(v).length === 0)) {
          return false;
        }
      }
      return true;
    };
    if (isDefaultAction(incoming.tap_action, "more-info"))
      delete incoming.tap_action;
    if (isDefaultAction(incoming.hold_action, "none"))
      delete incoming.hold_action;
    if (isDefaultAction(incoming.double_tap_action, "none"))
      delete incoming.double_tap_action;
    if (isDefaultAction(incoming.icon_tap_action, "toggle"))
      delete incoming.icon_tap_action;
    if (isDefaultAction(incoming.icon_hold_action, "none"))
      delete incoming.icon_hold_action;
    if (isDefaultAction(incoming.icon_double_tap_action, "none"))
      delete incoming.icon_double_tap_action;

    // Boş string'leri temizle (ha-form bazı alanlarda boş string emit eder).
    for (const k of Object.keys(incoming)) {
      if (incoming[k] === "" || incoming[k] === null) delete incoming[k];
    }
    // layout: horizontal varsayılan olduğu için config'e yazmaya gerek yok.
    if (incoming.layout === "horizontal") delete incoming.layout;
    if (incoming.filter_ring === "always") delete incoming.filter_ring;
    if (incoming.particles === true) delete incoming.particles;
    if (incoming.air_quality_label === false) delete incoming.air_quality_label;
    if (Array.isArray(incoming.controls) && !incoming.controls.length)
      delete incoming.controls;

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
