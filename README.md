# trailer-route

Plan routes that fit your vehicle + trailer, and open them on your phone: **<https://eddojansen.github.io/trailer-route/pwa/>**

## Apple Maps Trailer Route Search Plugin

A comprehensive plugin for searching routes with trailer dimension restrictions using Apple Maps integration.

### Features

- 🚛 Search routes based on trailer weight, height, and width restrictions
- 🌍 Support for both metric and imperial units
- 🛣️ Route optimization options (avoid tolls, highways)
- ⚠️ Automatic detection of height, width, and weight restrictions
- 🎯 Demo mode for testing without API keys
- 📊 JSON and human-readable output formats
- 🐍 Python API and CLI interface
- 🔧 Ansible playbook integration

### Quick Start

#### Install Dependencies

```bash
pip install -r requirements.txt
```

#### Search for a Route (CLI)

```bash
python3 -m plugins.apple_maps_trailer.cli \
  --origin "San Francisco, CA" \
  --destination "Los Angeles, CA" \
  --weight 25000 \
  --height 4.0 \
  --width 2.4 \
  --units metric
```

#### Run Examples

```bash
python3 plugins/apple_maps_trailer/example.py
```

#### Run Ansible Playbook

```bash
cd playbooks
ansible-playbook route_search_example.yml
```

### Use it on your phone (PWA)

`pwa/` is a self-contained web app that can be installed on your phone. It finds real truck routes that respect your vehicle + trailer **weight, height, width and length**, using [Valhalla](https://valhalla.github.io/valhalla/) truck routing on OpenStreetMap data. Then it hands the trip to Apple Maps for navigation.

It's static files only, with no backend or API key, but it must be served over HTTPS to be installable. Options:

- **GitHub Pages** (how the link above is hosted): in the repo, go to *Settings → Pages* and deploy from branch `master`, folder `/ (root)`. The app is then at `https://<user>.github.io/trailer-route/pwa/`.
- **Netlify Drop**: drag the `pwa/` folder onto <https://app.netlify.com/drop>.
- **Local test**: `cd pwa && python3 -m http.server 8000`, then open <http://localhost:8000>.

Install it:
- **iPhone (Safari)**: Share → *Add to Home Screen*.
- **Android (Chrome)**: ⋮ menu → *Install app*.

How it decides which roads fit:
1. Valhalla's truck routing skips every road whose mapped OpenStreetMap limits (`maxheight`, `maxwidth`, `maxlength`, `maxweight`, `hgv=no`, `hazmat=no`) your vehicle exceeds. You can pick from up to 3 alternative routes.
2. To show the details, the app asks Valhalla which OSM roads the route uses, then reads their tags from the OpenStreetMap API. It lists the lowest limit of each kind on the route and flags close fits.
3. A coloured verdict sits at the top of the results, covering all alternatives:
   - **Good route**: every mapped limit clears with room to spare.
   - **Possible, but check** / **No really good route**: close fits, truck access rules, a ferry, or a long detour.
   - **No safe route**: a part isn't allowed, or the route can't reach your start or destination.

   Each problem names the road, the limit, your size, and where it is (for example "340 m before your destination"). Tap it to see it on the map.
4. It also plans a car's route and lists the limits on it that your vehicle breaks. That's what the truck route avoided. If no route fits at all, the same check shows what's blocking it.

**My vehicles:** save your trucks and trailers under a name (the "My vehicles" button, or "Save these sizes" under the vehicle list) and pick them from the vehicle list. They're stored on the phone only. Use **Back up** to save a file, and **Restore** after reinstalling the app or on a new phone.

Notes:
- Apple Maps doesn't accept vehicle dimensions, so it may choose different roads than the ones shown in the app. Check that it follows the highlighted route.
- Restrictions are only as good as OpenStreetMap's data. Always obey road signs.
- After the first visit, the app opens offline and shows your last route. Searching needs a connection.
- If you change files in `pwa/`, bump `CACHE` in `pwa/sw.js` so installed copies update.

### Documentation

- **Plugin Documentation**: [plugins/apple_maps_trailer/README.md](plugins/apple_maps_trailer/README.md)
- **Configuration**: [config/trailer_config.json](config/trailer_config.json)
- **Ansible Playbook**: [playbooks/route_search_example.yml](playbooks/route_search_example.yml)

### Project Structure

```
trailer-route/
├── pwa/                        # Installable phone app (PWA)
├── plugins/
│   └── apple_maps_trailer/      # Apple Maps trailer route plugin
│       ├── __init__.py
│       ├── route_search.py      # Core routing logic
│       ├── cli.py              # CLI interface
│       ├── example.py          # Usage examples
│       └── README.md           # Plugin documentation
├── config/
│   └── trailer_config.json     # Trailer configurations
├── playbooks/
│   └── route_search_example.yml # Ansible playbook
├── requirements.txt            # Python dependencies
└── README.md                   # This file
```

### Usage Example (Python API)

```python
from plugins.apple_maps_trailer import AppleMapsTrailerRouter
from plugins.apple_maps_trailer.route_search import (
    TrailerDimensions, RouteRequest, UnitSystem
)

# Define trailer dimensions
trailer = TrailerDimensions(
    weight=25000,  # kg
    height=4.0,    # meters
    width=2.4,     # meters
    unit_system=UnitSystem.METRIC
)

# Create route request
request = RouteRequest(
    origin="Paris, France",
    destination="Lyon, France",
    trailer_dimensions=trailer
)

# Search for route
router = AppleMapsTrailerRouter(demo_mode=True)
response = router.search_route(request)

# Display results
print(router.format_route_summary(response))
```

### License

MIT License