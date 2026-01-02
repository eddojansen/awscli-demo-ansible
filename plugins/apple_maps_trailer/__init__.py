"""
Apple Maps Trailer Route Search Plugin

This plugin provides functionality to search for routes using Apple Maps
with trailer dimension restrictions (weight, height, width).
"""

__version__ = "1.0.0"
__author__ = "awscli-demo-ansible"

from .route_search import AppleMapsTrailerRouter

__all__ = ['AppleMapsTrailerRouter']
