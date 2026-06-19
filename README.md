# Xiaomi Air Purifier Card

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/animation.gif" width="550" alt="animation">

A minimalist, single-row air purifier / fan card for Home Assistant. It packs power state, PM2.5, temperature, humidity, and mode into one compact card, with a look inspired by Xiaomi's own app.

<img src="https://raw.githubusercontent.com/Korkuttum/xiaomi_air_purifier_card/main/images/purifier.png" width="600" alt="compact">

## Features

- **Single-row layout**: Power button — PM2.5 — Temperature/Humidity — Mode button, all in one compact card
- **PM2.5 readout**: Displayed like the device's own screen — 3-digit, zero-padded format (e.g. `015`, `112`) — with color coding based on air quality (green → yellow → orange → red → purple)
- **Animated fan icon**: Spins while the device is on, with rotation speed tied to the actual fan percentage
- **Dust particle effect**: Small particles flow from the edges of the card toward the fan icon while running, with density scaling to the current PM2.5 level
- **One-button mode cycling**: Tap a single button to step through modes (Auto, Sleep, Manual levels, Favorite, etc.)
- **Flexible data sources**: PM2.5 / temperature / humidity can be read either from the fan entity's own attributes or from separate sensor entities
- **Grid/Sections friendly**: In Home Assistant's sections view, all spacing scales proportionally when you change the column count
- **Visual config editor**: No-YAML setup via entity pickers in the Add Card → Edit screen

## Installation

1. HACS → Frontend → three-dot menu → **Custom repositories**
2. Add `https://github.com/Korkuttum/xiaomi_air_purifier_card` and select **Dashboard** as the category
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
```

| Option | Required | Description |
|---|---|---|
| `entity` | ✅ | An entity from the `fan` domain (the air purifier) |
| `pm25_entity` | — | If omitted, the `pm25` / `aqi` / `air_quality` attribute is read from the fan entity instead |
| `temperature_entity` | — | If omitted, the `temperature` / `temp` attribute is read from the fan entity instead |
| `humidity_entity` | — | If omitted, the `humidity` attribute is read from the fan entity instead |
| `mode_order` | — | The list of `preset_modes` the mode button cycles through, in order. If omitted, the entity's own order is used. A mode named `Manual` is automatically split into sub-levels (Manual 1, Manual 2, ...) if the entity exposes a `speed_list` or `percentage_step` attribute |

> If you don't want to pick separate PM2.5/temperature/humidity sensors, you can leave those fields empty — some integrations already expose this data directly on the fan entity's attributes.

### Configuring via the visual editor

If you'd rather not write YAML, click **Edit** (pencil icon) on the card after adding it to open a form where you can:

- Select the fan / air purifier entity
- (Optional) Select PM2.5, temperature, and humidity sensors
- (Optional) Enter the mode cycle order as a comma-separated list (e.g. `Auto, Sleep, Manual, Favorite`)

## License

MIT
