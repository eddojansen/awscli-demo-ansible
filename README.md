# awscli-demo-ansible

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

### Documentation

- **Plugin Documentation**: [plugins/apple_maps_trailer/README.md](plugins/apple_maps_trailer/README.md)
- **Configuration**: [config/trailer_config.json](config/trailer_config.json)
- **Ansible Playbook**: [playbooks/route_search_example.yml](playbooks/route_search_example.yml)

### Project Structure

```
awscli-demo-ansible/
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