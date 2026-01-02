#!/usr/bin/env python3
"""
Command-line interface for Apple Maps Trailer Route Search
"""

import argparse
import json
import sys
from typing import Optional

from .route_search import (
    AppleMapsTrailerRouter,
    TrailerDimensions,
    RouteRequest,
    UnitSystem
)


def parse_args():
    """Parse command-line arguments"""
    parser = argparse.ArgumentParser(
        description='Search for routes with trailer dimension restrictions using Apple Maps'
    )

    # Route parameters
    parser.add_argument(
        '--origin',
        required=True,
        help='Starting location (address or coordinates)'
    )
    parser.add_argument(
        '--destination',
        required=True,
        help='Destination location (address or coordinates)'
    )

    # Trailer dimensions
    parser.add_argument(
        '--weight',
        type=float,
        required=True,
        help='Maximum trailer weight (kg for metric, lbs for imperial)'
    )
    parser.add_argument(
        '--height',
        type=float,
        required=True,
        help='Maximum trailer height (meters for metric, feet for imperial)'
    )
    parser.add_argument(
        '--width',
        type=float,
        required=True,
        help='Maximum trailer width (meters for metric, feet for imperial)'
    )
    parser.add_argument(
        '--length',
        type=float,
        help='Optional trailer length (meters for metric, feet for imperial)'
    )

    # Unit system
    parser.add_argument(
        '--units',
        choices=['metric', 'imperial'],
        default='metric',
        help='Unit system for measurements (default: metric)'
    )

    # Route preferences
    parser.add_argument(
        '--avoid-tolls',
        action='store_true',
        help='Avoid toll roads'
    )
    parser.add_argument(
        '--avoid-highways',
        action='store_true',
        help='Avoid highways'
    )

    # API settings
    parser.add_argument(
        '--api-key',
        help='Apple Maps API key (optional for demo mode)'
    )
    parser.add_argument(
        '--production',
        action='store_true',
        help='Use production API (requires API key)'
    )

    # Output format
    parser.add_argument(
        '--json',
        action='store_true',
        help='Output as JSON instead of formatted text'
    )

    return parser.parse_args()


def main():
    """Main CLI entry point"""
    args = parse_args()

    # Create trailer dimensions
    unit_system = UnitSystem.METRIC if args.units == 'metric' else UnitSystem.IMPERIAL
    trailer_dims = TrailerDimensions(
        weight=args.weight,
        height=args.height,
        width=args.width,
        length=args.length,
        unit_system=unit_system
    )

    # Create route request
    request = RouteRequest(
        origin=args.origin,
        destination=args.destination,
        trailer_dimensions=trailer_dims,
        avoid_tolls=args.avoid_tolls,
        avoid_highways=args.avoid_highways
    )

    # Initialize router
    demo_mode = not args.production
    router = AppleMapsTrailerRouter(
        api_key=args.api_key,
        demo_mode=demo_mode
    )

    # Search for route
    response = router.search_route(request)

    # Output results
    if args.json:
        print(json.dumps(response.to_dict(), indent=2))
    else:
        print(router.format_route_summary(response))

    # Exit with appropriate code
    sys.exit(0 if response.route_found else 1)


if __name__ == '__main__':
    main()
