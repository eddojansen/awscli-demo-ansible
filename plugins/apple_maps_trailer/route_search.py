"""
Apple Maps Trailer Route Search Module

Provides route searching capabilities with trailer dimension constraints.
"""

import json
import requests
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class UnitSystem(Enum):
    """Unit system for measurements"""
    METRIC = "metric"
    IMPERIAL = "imperial"


@dataclass
class TrailerDimensions:
    """
    Trailer dimension specifications

    Attributes:
        weight: Maximum weight (kg for metric, lbs for imperial)
        height: Maximum height (meters for metric, feet for imperial)
        width: Maximum width (meters for metric, feet for imperial)
        length: Optional vehicle length (meters for metric, feet for imperial)
        unit_system: Unit system being used
    """
    weight: float
    height: float
    width: float
    length: Optional[float] = None
    unit_system: UnitSystem = UnitSystem.METRIC

    def to_dict(self) -> Dict:
        """Convert dimensions to dictionary"""
        data = {
            'weight': self.weight,
            'height': self.height,
            'width': self.width,
            'unit_system': self.unit_system.value
        }
        if self.length:
            data['length'] = self.length
        return data

    def validate(self) -> Tuple[bool, Optional[str]]:
        """
        Validate trailer dimensions

        Returns:
            Tuple of (is_valid, error_message)
        """
        if self.weight <= 0:
            return False, "Weight must be positive"
        if self.height <= 0:
            return False, "Height must be positive"
        if self.width <= 0:
            return False, "Width must be positive"
        if self.length is not None and self.length <= 0:
            return False, "Length must be positive"

        # Check reasonable maximum values
        if self.unit_system == UnitSystem.METRIC:
            if self.weight > 100000:  # 100 tons
                return False, "Weight exceeds maximum (100000 kg)"
            if self.height > 10:  # 10 meters
                return False, "Height exceeds maximum (10 m)"
            if self.width > 5:  # 5 meters
                return False, "Width exceeds maximum (5 m)"
        else:  # Imperial
            if self.weight > 220000:  # ~100 tons
                return False, "Weight exceeds maximum (220000 lbs)"
            if self.height > 32:  # ~10 meters
                return False, "Height exceeds maximum (32 ft)"
            if self.width > 16:  # ~5 meters
                return False, "Width exceeds maximum (16 ft)"

        return True, None


@dataclass
class RouteRequest:
    """
    Route search request parameters

    Attributes:
        origin: Starting location (address or coordinates)
        destination: Ending location (address or coordinates)
        trailer_dimensions: Trailer dimension constraints
        avoid_tolls: Whether to avoid toll roads
        avoid_highways: Whether to avoid highways
    """
    origin: str
    destination: str
    trailer_dimensions: TrailerDimensions
    avoid_tolls: bool = False
    avoid_highways: bool = False

    def to_dict(self) -> Dict:
        """Convert request to dictionary"""
        return {
            'origin': self.origin,
            'destination': self.destination,
            'trailer_dimensions': self.trailer_dimensions.to_dict(),
            'avoid_tolls': self.avoid_tolls,
            'avoid_highways': self.avoid_highways
        }


@dataclass
class RouteSegment:
    """Individual route segment information"""
    instruction: str
    distance: float
    duration: float  # in minutes
    restrictions: List[str]

    def to_dict(self) -> Dict:
        return {
            'instruction': self.instruction,
            'distance': self.distance,
            'duration': self.duration,
            'restrictions': self.restrictions
        }


@dataclass
class RouteResponse:
    """
    Route search response

    Attributes:
        route_found: Whether a valid route was found
        total_distance: Total route distance
        total_duration: Total route duration in minutes
        segments: List of route segments
        warnings: Any warnings about the route
        restrictions_encountered: List of restrictions on the route
    """
    route_found: bool
    total_distance: float
    total_duration: float
    segments: List[RouteSegment]
    warnings: List[str]
    restrictions_encountered: List[str]

    def to_dict(self) -> Dict:
        return {
            'route_found': self.route_found,
            'total_distance': self.total_distance,
            'total_duration': self.total_duration,
            'segments': [s.to_dict() for s in self.segments],
            'warnings': self.warnings,
            'restrictions_encountered': self.restrictions_encountered
        }


class AppleMapsTrailerRouter:
    """
    Apple Maps Trailer Route Search Client

    This class provides an interface for searching routes with trailer
    dimension constraints using Apple Maps API.

    Note: This is a demonstration implementation. For production use,
    you would need to integrate with Apple MapKit JS or Apple Maps Server API
    with proper authentication.
    """

    def __init__(self, api_key: Optional[str] = None, demo_mode: bool = True):
        """
        Initialize the router

        Args:
            api_key: Apple Maps API key (required for production)
            demo_mode: If True, uses simulated responses
        """
        self.api_key = api_key
        self.demo_mode = demo_mode
        self.base_url = "https://maps-api.apple.com/v1"

    def search_route(self, request: RouteRequest) -> RouteResponse:
        """
        Search for a route with trailer restrictions

        Args:
            request: Route search request

        Returns:
            RouteResponse with route details or error information
        """
        # Validate trailer dimensions
        is_valid, error_msg = request.trailer_dimensions.validate()
        if not is_valid:
            return RouteResponse(
                route_found=False,
                total_distance=0,
                total_duration=0,
                segments=[],
                warnings=[f"Invalid dimensions: {error_msg}"],
                restrictions_encountered=[]
            )

        if self.demo_mode:
            return self._generate_demo_route(request)
        else:
            return self._query_apple_maps_api(request)

    def _generate_demo_route(self, request: RouteRequest) -> RouteResponse:
        """
        Generate a simulated route response for demonstration

        Args:
            request: Route search request

        Returns:
            Simulated RouteResponse
        """
        # Simulate route calculation
        warnings = []
        restrictions = []

        # Check for potential restrictions based on dimensions
        dims = request.trailer_dimensions

        if dims.unit_system == UnitSystem.METRIC:
            if dims.height > 4.2:
                warnings.append("Height restriction: Some tunnels and overpasses may be impassable")
                restrictions.append("Height restriction on Route 1, km 45-52")
            if dims.width > 2.5:
                warnings.append("Width restriction: Some narrow roads may be impassable")
                restrictions.append("Width restriction on Bridge Street")
            if dims.weight > 20000:
                warnings.append("Weight restriction: Some bridges may have weight limits")
                restrictions.append("Weight limit on Old County Bridge")
        else:  # Imperial
            if dims.height > 13.5:
                warnings.append("Height restriction: Some tunnels and overpasses may be impassable")
                restrictions.append("Height restriction on Highway 101, mile 28-32")
            if dims.width > 8.2:
                warnings.append("Width restriction: Some narrow roads may be impassable")
                restrictions.append("Width restriction on Main Street Bridge")
            if dims.weight > 44000:
                warnings.append("Weight restriction: Some bridges may have weight limits")
                restrictions.append("Weight limit on River Crossing")

        # Generate demo segments
        segments = [
            RouteSegment(
                instruction=f"Start at {request.origin}",
                distance=0,
                duration=0,
                restrictions=[]
            ),
            RouteSegment(
                instruction="Take Highway 1 North",
                distance=25.5,
                duration=30,
                restrictions=["Height clearance: 4.5m" if dims.unit_system == UnitSystem.METRIC else "Height clearance: 14.5ft"]
            ),
            RouteSegment(
                instruction="Merge onto Interstate 5",
                distance=120.3,
                duration=90,
                restrictions=[]
            ),
            RouteSegment(
                instruction=f"Arrive at {request.destination}",
                distance=0,
                duration=0,
                restrictions=[]
            )
        ]

        total_distance = sum(s.distance for s in segments)
        total_duration = sum(s.duration for s in segments)

        return RouteResponse(
            route_found=True,
            total_distance=total_distance,
            total_duration=total_duration,
            segments=segments,
            warnings=warnings,
            restrictions_encountered=restrictions
        )

    def _query_apple_maps_api(self, request: RouteRequest) -> RouteResponse:
        """
        Query the actual Apple Maps API

        Args:
            request: Route search request

        Returns:
            RouteResponse from Apple Maps API

        Note: This requires proper Apple Maps API credentials and setup
        """
        if not self.api_key:
            return RouteResponse(
                route_found=False,
                total_distance=0,
                total_duration=0,
                segments=[],
                warnings=["API key required for production use. Use demo_mode=True for testing."],
                restrictions_encountered=[]
            )

        # Construct API request
        # Note: This is a simplified example. Actual Apple Maps API
        # may have different endpoints and parameters
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        payload = {
            'origin': request.origin,
            'destination': request.destination,
            'transportType': 'automobile',
            'vehicleSpecifications': {
                'weight': request.trailer_dimensions.weight,
                'height': request.trailer_dimensions.height,
                'width': request.trailer_dimensions.width,
            },
            'avoid': []
        }

        if request.trailer_dimensions.length:
            payload['vehicleSpecifications']['length'] = request.trailer_dimensions.length

        if request.avoid_tolls:
            payload['avoid'].append('tolls')
        if request.avoid_highways:
            payload['avoid'].append('highways')

        try:
            # Note: Actual endpoint would be different
            response = requests.post(
                f"{self.base_url}/directions",
                headers=headers,
                json=payload,
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                # Parse response and create RouteResponse
                # This would need to be adapted to actual API response format
                return self._parse_api_response(data)
            else:
                return RouteResponse(
                    route_found=False,
                    total_distance=0,
                    total_duration=0,
                    segments=[],
                    warnings=[f"API Error: {response.status_code} - {response.text}"],
                    restrictions_encountered=[]
                )
        except Exception as e:
            return RouteResponse(
                route_found=False,
                total_distance=0,
                total_duration=0,
                segments=[],
                warnings=[f"Request failed: {str(e)}"],
                restrictions_encountered=[]
            )

    def _parse_api_response(self, data: Dict) -> RouteResponse:
        """
        Parse Apple Maps API response

        Args:
            data: API response data

        Returns:
            Parsed RouteResponse
        """
        # This would need to be implemented based on actual API response format
        # Placeholder implementation
        return RouteResponse(
            route_found=True,
            total_distance=data.get('distance', 0),
            total_duration=data.get('duration', 0),
            segments=[],
            warnings=data.get('warnings', []),
            restrictions_encountered=data.get('restrictions', [])
        )

    def format_route_summary(self, response: RouteResponse) -> str:
        """
        Format route response as human-readable summary

        Args:
            response: Route response to format

        Returns:
            Formatted string summary
        """
        if not response.route_found:
            summary = "❌ No route found\n"
            summary += "\nWarnings:\n"
            for warning in response.warnings:
                summary += f"  - {warning}\n"
            return summary

        summary = "✓ Route found\n"
        summary += f"Total Distance: {response.total_distance:.1f} km\n"
        summary += f"Estimated Duration: {response.total_duration:.0f} minutes ({response.total_duration/60:.1f} hours)\n"

        if response.warnings:
            summary += "\n⚠️  Warnings:\n"
            for warning in response.warnings:
                summary += f"  - {warning}\n"

        if response.restrictions_encountered:
            summary += "\n🚧 Restrictions Encountered:\n"
            for restriction in response.restrictions_encountered:
                summary += f"  - {restriction}\n"

        summary += f"\n📍 Route Segments ({len(response.segments)} steps):\n"
        for i, segment in enumerate(response.segments, 1):
            summary += f"  {i}. {segment.instruction}"
            if segment.distance > 0:
                summary += f" ({segment.distance:.1f} km, {segment.duration:.0f} min)"
            if segment.restrictions:
                summary += f"\n     Restrictions: {', '.join(segment.restrictions)}"
            summary += "\n"

        return summary
