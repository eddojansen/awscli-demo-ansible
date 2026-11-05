# Apple Maps Trailer Route Search Plugin

A comprehensive plugin for searching routes with trailer dimension restrictions using Apple Maps integration.

## Features

- 🚛 **Trailer Dimension Support**: Weight, height, width, and length constraints
- 🌍 **Dual Unit Systems**: Both metric and imperial measurements
- 🛣️ **Route Optimization**: Avoid tolls and highways options
- ⚠️ **Restriction Detection**: Identifies height, width, and weight restrictions on routes
- 🎯 **Demo Mode**: Built-in simulation for testing without API keys
- 📊 **Multiple Output Formats**: Human-readable text and JSON output
- 🔧 **CLI Interface**: Easy-to-use command-line tool
- 🐍 **Python API**: Programmable interface for integration

## Installation

### Prerequisites

- Python 3.6 or higher
- pip package manager

### Install Dependencies

```bash
pip install -r requirements.txt
```

## Usage

### Command Line Interface

#### Basic Usage

```bash
python3 -m plugins.apple_maps_trailer.cli \
  --origin "San Francisco, CA" \
  --destination "Los Angeles, CA" \
  --weight 25000 \
  --height 4.0 \
  --width 2.4 \
  --units metric
```

#### With All Options

```bash
python3 -m plugins.apple_maps_trailer.cli \
  --origin "New York, NY" \
  --destination "Boston, MA" \
  --weight 55000 \
  --height 13.5 \
  --width 8.5 \
  --length 45 \
  --units imperial \
  --avoid-tolls \
  --avoid-highways \
  --json
```

#### CLI Options

| Option | Description | Required |
|--------|-------------|----------|
| `--origin` | Starting location (address or coordinates) | Yes |
| `--destination` | Ending location (address or coordinates) | Yes |
| `--weight` | Max trailer weight (kg/lbs) | Yes |
| `--height` | Max trailer height (m/ft) | Yes |
| `--width` | Max trailer width (m/ft) | Yes |
| `--length` | Trailer length (m/ft) | No |
| `--units` | Unit system: `metric` or `imperial` | No (default: metric) |
| `--avoid-tolls` | Avoid toll roads | No |
| `--avoid-highways` | Avoid highways | No |
| `--api-key` | Apple Maps API key | No (demo mode) |
| `--production` | Use production API (requires key) | No |
| `--json` | Output as JSON | No |

### Python API

#### Basic Example

```python
from plugins.apple_maps_trailer import AppleMapsTrailerRouter
from plugins.apple_maps_trailer.route_search import (
    TrailerDimensions,
    RouteRequest,
    UnitSystem
)

# Create trailer specifications
trailer = TrailerDimensions(
    weight=25000,  # kg
    height=4.0,    # meters
    width=2.4,     # meters
    length=13.6,   # meters
    unit_system=UnitSystem.METRIC
)

# Create route request
request = RouteRequest(
    origin="Paris, France",
    destination="Lyon, France",
    trailer_dimensions=trailer,
    avoid_tolls=False
)

# Initialize router
router = AppleMapsTrailerRouter(demo_mode=True)

# Search for route
response = router.search_route(request)

# Display results
print(router.format_route_summary(response))
```

#### Advanced Example

```python
# Using imperial units with restrictions
trailer = TrailerDimensions(
    weight=55000,  # lbs
    height=13.5,   # feet
    width=8.5,     # feet
    unit_system=UnitSystem.IMPERIAL
)

request = RouteRequest(
    origin="Los Angeles, CA",
    destination="San Francisco, CA",
    trailer_dimensions=trailer,
    avoid_tolls=True,
    avoid_highways=False
)

router = AppleMapsTrailerRouter(demo_mode=True)
response = router.search_route(request)

# Process results
if response.route_found:
    print(f"Distance: {response.total_distance} km")
    print(f"Duration: {response.total_duration} minutes")

    for warning in response.warnings:
        print(f"Warning: {warning}")

    for restriction in response.restrictions_encountered:
        print(f"Restriction: {restriction}")
```

### Running Examples

The package includes several example scripts:

```bash
cd plugins/apple_maps_trailer
python3 example.py
```

This will run 5 different examples demonstrating:
1. Metric units with standard semi-trailer
2. Imperial units with heavy load
3. Oversized load with restrictions
4. Invalid dimensions error handling
5. JSON output format

## Configuration

### Trailer Configuration File

The `config/trailer_config.json` file contains predefined trailer specifications:

- **Standard Semi**: Common semi-trailer dimensions
- **Double Trailer**: Larger dual-trailer configuration
- **Oversized Load**: Heavy/oversized transport specifications

You can customize these or add your own configurations.

### Common Trailer Types

#### Standard Semi-Trailer (Metric)
- Weight: 25,000 kg
- Height: 4.0 m
- Width: 2.4 m
- Length: 13.6 m

#### Standard Semi-Trailer (Imperial)
- Weight: 55,000 lbs
- Height: 13.5 ft
- Width: 8.5 ft
- Length: 45 ft

## Ansible Integration

### Running the Playbook

```bash
cd playbooks
ansible-playbook route_search_example.yml
```

### Playbook Features

The included Ansible playbook (`playbooks/route_search_example.yml`) demonstrates:

- Installing Python dependencies
- Loading trailer configurations
- Searching multiple routes
- Generating summary reports
- Saving results to files

### Custom Playbook

```yaml
- name: Search Custom Route
  hosts: localhost
  tasks:
    - name: Search route with trailer restrictions
      shell: |
        python3 -m plugins.apple_maps_trailer.cli \
          --origin "{{ origin }}" \
          --destination "{{ destination }}" \
          --weight {{ trailer_weight }} \
          --height {{ trailer_height }} \
          --width {{ trailer_width }} \
          --units metric \
          --json
      register: route_result

    - name: Display results
      debug:
        var: route_result.stdout | from_json
```

## API Integration

### Demo Mode vs Production

The plugin supports two modes:

#### Demo Mode (Default)
- No API key required
- Simulates route calculations
- Useful for testing and development
- Returns realistic example data

```python
router = AppleMapsTrailerRouter(demo_mode=True)
```

#### Production Mode
- Requires Apple Maps API key
- Makes actual API calls
- Real route data

```python
router = AppleMapsTrailerRouter(
    api_key="your-api-key-here",
    demo_mode=False
)
```

### Getting an Apple Maps API Key

1. Sign up for Apple Developer Program
2. Create an Apple Maps API key in the developer console
3. Enable MapKit JS or Apple Maps Server API
4. Pass the key to the router

## Response Format

### RouteResponse Object

```python
@dataclass
class RouteResponse:
    route_found: bool              # Whether a valid route was found
    total_distance: float          # Total distance in km
    total_duration: float          # Total duration in minutes
    segments: List[RouteSegment]   # Individual route segments
    warnings: List[str]            # Warning messages
    restrictions_encountered: List[str]  # Encountered restrictions
```

### RouteSegment Object

```python
@dataclass
class RouteSegment:
    instruction: str      # Turn-by-turn instruction
    distance: float       # Segment distance
    duration: float       # Segment duration in minutes
    restrictions: List[str]  # Restrictions on this segment
```

### JSON Output Example

```json
{
  "route_found": true,
  "total_distance": 145.8,
  "total_duration": 120,
  "segments": [
    {
      "instruction": "Start at San Francisco, CA",
      "distance": 0,
      "duration": 0,
      "restrictions": []
    },
    {
      "instruction": "Take Highway 1 North",
      "distance": 25.5,
      "duration": 30,
      "restrictions": ["Height clearance: 4.5m"]
    }
  ],
  "warnings": [
    "Height restriction: Some tunnels may be impassable"
  ],
  "restrictions_encountered": [
    "Height restriction on Route 1, km 45-52"
  ]
}
```

## Validation

### Dimension Limits

The plugin validates trailer dimensions against reasonable limits:

#### Metric Limits
- Weight: 0 - 100,000 kg
- Height: 0 - 10 m
- Width: 0 - 5 m

#### Imperial Limits
- Weight: 0 - 220,000 lbs
- Height: 0 - 32 ft
- Width: 0 - 16 ft

Invalid dimensions will return an error response with appropriate warnings.

## Error Handling

The plugin handles various error scenarios:

- Invalid trailer dimensions
- Missing API credentials (in production mode)
- Network failures
- API errors
- Invalid locations

All errors are returned in the `RouteResponse` with appropriate warning messages.

## Development

### Running Tests

```bash
# Run example script
python3 plugins/apple_maps_trailer/example.py

# Test CLI
python3 -m plugins.apple_maps_trailer.cli --help
```

### Project Structure

```
plugins/apple_maps_trailer/
├── __init__.py          # Package initialization
├── route_search.py      # Core routing logic
├── cli.py              # Command-line interface
├── example.py          # Usage examples
└── README.md           # This file

config/
└── trailer_config.json  # Trailer configurations

playbooks/
└── route_search_example.yml  # Ansible playbook example
```

## Contributing

Contributions are welcome! Areas for improvement:

- [ ] Real Apple Maps API integration
- [ ] Additional route optimization options
- [ ] Waypoint support
- [ ] Alternative route suggestions
- [ ] Route export (GPX, KML)
- [ ] Integration with other mapping services
- [ ] Route history and caching
- [ ] Web interface

## License

This project is part of the trailer-route repository.

## Support

For issues and questions, please open an issue in the repository.

## Acknowledgments

- Apple MapKit for mapping services
- Ansible for automation capabilities
