# Xiaomi Air Purifier Card

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/animation2.gif" width="550" alt="animation">

A minimalist, single-row air purifier / fan card for Home Assistant. It packs power state, PM2.5, temperature, humidity, and mode into one compact card, with a look inspired by Xiaomi's own app.

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/purifier.png" width="600" alt="compact">

## Features

- **Single-row layout**: Power button — PM2.5 — Temperature/Humidity — Mode button, all in one compact card
- **PM2.5 readout**: Displayed like the device's own screen — 3-digit, zero-padded format (e.g. `015`, `112`) — with color coding based on air quality (green → yellow → orange → red → purple)
- **Animated fan icon**: Spins while the device is on, with rotation speed tied to the actual fan percentage
- **Dust particle effect**: Small particles flow from the edges of the card toward the fan icon while running, with density scaling to the current PM2.5 level
- **One-button mode cycling**: Tap a single button to step through modes (Auto, Sleep, Manual levels, Favorite, etc.)
- **Automatic offline detection**: Detects when the physical device has actually lost connectivity, even if the integration keeps reporting stale "last known" data (fan still shown spinning, sensors still showing old values). For Xiaomi Miot integration devices this works out of the box with zero configuration — see [Offline detection](#offline-detection) below
- **Flexible data sources**: PM2.5 / temperature / humidity can be read either from the fan entity's own attributes or from separate sensor entities
- **Grid/Sections friendly**: In Home Assistant's sections view, all spacing scales proportionally when you change the column count
- **Filter life ring**: A progress ring around the fan icon shows the remaining filter life, turning orange and then red as it runs low — see [Filter life ring](#filter-life-ring)
- **Details popup**: Tap the PM2.5 value to open a popup attached to the card with extra sensors (PM10, CO₂, TVOC), fan speed slider, mode selection, a timer and extra controls — see [Details popup](#details-popup)
- **Mode menu**: Long-press the mode button for an icon + label list of all modes — see [Mode menu](#mode-menu)
- **Air quality label**: Optional "Good / Moderate / Poor / Unhealthy / Hazardous" text under the PM2.5 value, with configurable thresholds
- **Vertical layout**: A compact vertical card for narrow columns (`layout: vertical`)
- **Visual config editor**: No-YAML setup via entity pickers in the Add Card → Edit screen
- **Translated**: Card texts and the visual editor in English, Turkish, German, French and Spanish (follows your Home Assistant language)

## Filter life ring

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/filter-ring.png" width="560" alt="Filter life ring at 82%, 15% and 6%">

A thin ring around the fan icon shows how much filter life is left. It takes no extra space and stays still while the fan spins.

| Filter life | Ring color |
|---|---|
| above 20% | green |
| 11–20% | orange |
| 10% or less | red |

The value is read from `filter_life_entity` if you set it, otherwise from the fan entity's `filter_life_level`, `filter_life_remaining` or `filter_life` attribute. If no value is found, no ring is drawn. Use `filter_ring: low` to show the ring only when the filter is at 20% or below, or `filter_ring: off` to hide it.

## Details popup

Tap the **PM2.5 value** to open a popup that grows out of the card. Tap the value again, tap anywhere outside, or press `Esc` to close it.

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/popup.png" width="340" alt="Details popup opened above the card">

It follows your Home Assistant language, here in Turkish:

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/popup-tr.png" width="340" alt="Details popup in Turkish">

What it shows (only what is available for your device):

- PM2.5, PM10 (`pm10_entity`), CO₂ (`co2_entity`), TVOC (`tvoc_entity`), temperature and humidity
- Filter life bar
- Fan speed slider
- All modes as icons — tap one to switch
- A timer (`timer_entity`): Off / 30m / 1h / 2h / 4h, written to a `number` or `input_number` entity in minutes
- Extra controls (`controls`): toggles for entities such as a child lock, LED or buzzer (`switch`, `input_boolean` or `lock`)

Values and names are shortcuts to the entity behind them. Tap **PM2.5, PM10, CO₂, TVOC, temperature or humidity**, the **Filter**, **Fan speed**, **Mode** and **timer** titles, the **device name** at the top, or the **name of a control** to open that entity's details. The popup closes first, so the two windows never stack. When a value is read from the fan's own attributes (no separate sensor set), the fan entity opens. Tapping the control button itself still toggles it.

The popup takes its background, border and text color from the card itself, so it matches your theme, including translucent "glass" styles. The dust particles keep flowing inside it, toward the fan.

On a narrow card (for example the vertical layout in a 3-column section) the popup does not have to squeeze into the card's width. It opens as a 300 px panel that sits on the card in a "T" shape, with rounded joints where the two meet, above the card or below it, whichever has room:

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/popup-vertical.png" width="300" alt="Details popup attached to the vertical layout">

If the card is too close to the edge of the screen for the joints to fit, the panel floats just next to the card instead.

## Mode menu

A normal tap on the mode button still steps through the modes. **Long-press** it to open a menu that lists every mode with its icon and name, with the active one highlighted over the button. The same icons are used in the details popup.

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/mode-menu.png" width="360" alt="Mode menu">

Mode icons: Auto, Sleep, Favorite and Silent have their own icons; `Manual` levels (and `Low` / `Medium` / `High`) use fan-speed icons; any other mode gets a fan icon.

## Installation

1. HACS → Frontend → three-dot menu → **Custom repositories**
2. Add ```https://github.com/Korkuttum/xiaomi_air_purifier_card``` and select **Dashboard** as the category
3. Search for "Xiaomi Air Purifier Card" in HACS and install it
4. Restart Home Assistant or clear your browser cache

## Usage

You can search for **"Xiaomi Air Purifier Card"** when adding a card to your Lovelace dashboard, or add it directly in YAML mode:

```yaml
type: custom:xiaomi-air-purifier-card
entity: fan.xiaomi_air_purifier
```

### All configuration options

```yaml
type: custom:xiaomi-air-purifier-card
entity: fan.xiaomi_air_purifier        # required — the fan entity
pm25_entity: sensor.pm25                # optional — separate PM2.5 sensor
temperature_entity: sensor.temperature  # optional — separate temperature sensor
humidity_entity: sensor.humidity        # optional — separate humidity sensor
mode_order:                             # optional — mode cycle order
  - Auto
  - Sleep
  - Manual
  - Favorite
offline_entity: button.device_info      # optional — manual override, see below
stale_minutes: 15                       # optional — see below
layout: horizontal                      # optional — horizontal (default) or vertical
filter_life_entity: sensor.filter_life  # optional — filter life in %, see Filter life ring
filter_ring: always                     # optional — always (default), low or off
pm10_entity: sensor.pm10                # optional — shown in the details popup
co2_entity: sensor.co2                  # optional — shown in the details popup
tvoc_entity: sensor.tvoc                # optional — shown in the details popup
timer_entity: number.timer              # optional — number / input_number in minutes
controls:                               # optional — toggles in the details popup
  - switch.child_lock
  - switch.buzzer
air_quality_label: true                 # optional — show Good / Moderate / ... under PM2.5
pm25_thresholds: [12, 35, 55, 150]      # optional — color / label limits in µg/m³
particles: true                         # optional — set false to turn off the dust particles
```

| Option | Required | Description |
|---|---|---|
| `entity` | ✅ | An entity from the `fan` domain (the air purifier) |
| `pm25_entity` | — | If omitted, the `pm25` / `aqi` / `air_quality` attribute is read from the fan entity instead |
| `temperature_entity` | — | If omitted, the `temperature` / `temp` attribute is read from the fan entity instead |
| `humidity_entity` | — | If omitted, the `humidity` attribute is read from the fan entity instead |
| `mode_order` | — | The list of `preset_modes` the mode button cycles through, in order. If omitted, the entity's own order is used. A mode named `Manual` is automatically split into sub-levels (Manual 1, Manual 2, ...) if the entity exposes a `speed_list` or `percentage_step` attribute |
| `offline_entity` | — | Manually override the entity used for connectivity detection. Only needed if auto-detection (see below) doesn't apply to your integration |
| `stale_minutes` | — | Fallback staleness threshold in minutes, default `15`. Only used when no connectivity entity is found or configured — see below |
| `layout` | — | `horizontal` (default, single row) or `vertical` (compact column) |
| `filter_life_entity` | — | A sensor with the remaining filter life in percent. If omitted, the `filter_life_level` / `filter_life_remaining` / `filter_life` attribute of the fan entity is used. See [Filter life ring](#filter-life-ring) |
| `filter_ring` | — | `always` (default), `low` (only at 20% or below) or `off` |
| `pm10_entity`, `co2_entity`, `tvoc_entity` | — | Extra sensors shown in the [details popup](#details-popup) |
| `timer_entity` | — | A `number` or `input_number` entity that takes minutes. Adds a timer row (Off / 30m / 1h / 2h / 4h) to the popup |
| `controls` | — | A list of `switch`, `input_boolean` or `lock` entities shown as toggles in the popup (child lock, LED, buzzer, ...) |
| `air_quality_label` | — | `true` shows a localized "Good / Moderate / Poor / Unhealthy / Hazardous" text instead of the unit under the PM2.5 value. Default `false` |
| `pm25_thresholds` | — | Four numbers, the upper limits for green, yellow, orange and red; anything above is purple. Default `[12, 35, 55, 150]`. Also drives the label. Also available in the visual editor as four number fields |
| `particles` | — | `false` turns off the dust particle animation, on the card and in the popup. Default `true` |

> If you don't want to pick separate PM2.5/temperature/humidity sensors, you can leave those fields empty — some integrations already expose this data directly on the fan entity's attributes.

### Offline detection

Some integrations keep reporting the last known state from the cloud even after the physical device has lost connectivity — the card would otherwise keep the fan spinning and show old sensor values indefinitely.

For devices set up through the **Xiaomi Miot** integration, this works automatically: every Xiaomi Miot device has a paired diagnostic `button.*_info` entity, and the card locates it on its own (matched via the same device), then watches its attributes. If any attribute name ends in `.error`, or any attribute value contains `timeout` or `offline` (covering the different Xiaomi error codes, e.g. `Device operation timeout`, `Device offline`), the card marks the device as offline — regardless of what the fan entity's own `state` still says.

When offline, the card shows a centered "Offline" / "Çevrimdışı" badge (localized to the Home Assistant UI language), dims the card, and stops the fan animation.

If you're not using Xiaomi Miot, or auto-detection picks the wrong entity, set `offline_entity` manually to any entity that reliably goes `unavailable`/`unknown` when the device disconnects. If no connectivity entity is available at all, the card falls back to comparing the fan entity's `last_updated` timestamp against `stale_minutes` (default 15 minutes).

### Configuring via the visual editor

If you'd rather not write YAML, click **Edit** (pencil icon) on the card after adding it to open a form where you can:

- Select the fan / air purifier entity
- (Optional) Select PM2.5, temperature, and humidity sensors
- (Optional) Select a connectivity entity to override offline auto-detection (usually not needed — see [Offline detection](#offline-detection))
- (Optional) Enter the mode cycle order as a comma-separated list (e.g. `Auto, Sleep, Manual, Favorite`)
- (Optional) In the **Extras** panel: filter life sensor, PM10 / CO₂ / TVOC sensors, timer entity, extra controls, filter ring mode, air quality label, the four PM2.5 color limits and the particle animation

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
