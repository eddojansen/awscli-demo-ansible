#!/usr/bin/env python3
"""
Example usage of the Apple Maps Trailer Route Search plugin
"""

from route_search import (
    AppleMapsTrailerRouter,
    TrailerDimensions,
    RouteRequest,
    UnitSystem
)


def example_metric_route():
    """Example using metric units"""
    print("=" * 60)
    print("Example 1: Metric Units - Standard Semi Trailer")
    print("=" * 60)

    # Create trailer dimensions (metric)
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
        avoid_tolls=False,
        avoid_highways=False
    )

    # Initialize router in demo mode
    router = AppleMapsTrailerRouter(demo_mode=True)

    # Search for route
    response = router.search_route(request)

    # Display results
    print(router.format_route_summary(response))
    print()


def example_imperial_route():
    """Example using imperial units"""
    print("=" * 60)
    print("Example 2: Imperial Units - Heavy Load")
    print("=" * 60)

    # Create trailer dimensions (imperial)
    trailer = TrailerDimensions(
        weight=55000,  # lbs
        height=13.5,   # feet
        width=8.5,     # feet
        length=45,     # feet
        unit_system=UnitSystem.IMPERIAL
    )

    # Create route request
    request = RouteRequest(
        origin="Los Angeles, CA",
        destination="San Francisco, CA",
        trailer_dimensions=trailer,
        avoid_tolls=True,
        avoid_highways=False
    )

    # Initialize router in demo mode
    router = AppleMapsTrailerRouter(demo_mode=True)

    # Search for route
    response = router.search_route(request)

    # Display results
    print(router.format_route_summary(response))
    print()


def example_oversized_load():
    """Example with oversized load triggering warnings"""
    print("=" * 60)
    print("Example 3: Oversized Load with Restrictions")
    print("=" * 60)

    # Create oversized trailer dimensions
    trailer = TrailerDimensions(
        weight=45000,  # kg
        height=4.8,    # meters (tall!)
        width=3.2,     # meters (wide!)
        length=20.0,   # meters (long!)
        unit_system=UnitSystem.METRIC
    )

    # Create route request
    request = RouteRequest(
        origin="Berlin, Germany",
        destination="Munich, Germany",
        trailer_dimensions=trailer,
        avoid_tolls=False,
        avoid_highways=False
    )

    # Initialize router in demo mode
    router = AppleMapsTrailerRouter(demo_mode=True)

    # Search for route
    response = router.search_route(request)

    # Display results
    print(router.format_route_summary(response))
    print()


def example_invalid_dimensions():
    """Example with invalid dimensions"""
    print("=" * 60)
    print("Example 4: Invalid Dimensions - Error Handling")
    print("=" * 60)

    # Create invalid trailer dimensions
    trailer = TrailerDimensions(
        weight=-1000,  # Invalid: negative weight
        height=4.0,
        width=2.4,
        unit_system=UnitSystem.METRIC
    )

    # Create route request
    request = RouteRequest(
        origin="London, UK",
        destination="Manchester, UK",
        trailer_dimensions=trailer
    )

    # Initialize router
    router = AppleMapsTrailerRouter(demo_mode=True)

    # Search for route
    response = router.search_route(request)

    # Display results
    print(router.format_route_summary(response))
    print()


def example_json_output():
    """Example showing JSON output"""
    print("=" * 60)
    print("Example 5: JSON Output Format")
    print("=" * 60)

    import json

    # Create trailer dimensions
    trailer = TrailerDimensions(
        weight=30000,
        height=4.2,
        width=2.5,
        unit_system=UnitSystem.METRIC
    )

    # Create route request
    request = RouteRequest(
        origin="Amsterdam, Netherlands",
        destination="Brussels, Belgium",
        trailer_dimensions=trailer
    )

    # Initialize router
    router = AppleMapsTrailerRouter(demo_mode=True)

    # Search for route
    response = router.search_route(request)

    # Display as JSON
    print(json.dumps(response.to_dict(), indent=2))
    print()


if __name__ == '__main__':
    print("\n")
    print("╔" + "=" * 58 + "╗")
    print("║" + " " * 58 + "║")
    print("║" + "  Apple Maps Trailer Route Search - Example Usage".center(58) + "║")
    print("║" + " " * 58 + "║")
    print("╚" + "=" * 58 + "╝")
    print("\n")

    # Run all examples
    example_metric_route()
    example_imperial_route()
    example_oversized_load()
    example_invalid_dimensions()
    example_json_output()

    print("=" * 60)
    print("All examples completed!")
    print("=" * 60)
