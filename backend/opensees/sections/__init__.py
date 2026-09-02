"""
Sections Module

Provides analytic geometric properties for common structural cross-sections
(I/H, rectangular, circular, hollow circular, rectangular hollow/box, channel,
angle, tee). All computations are closed-form (see ``properties.py``) and have
no third-party mesh dependency.
"""

from .ISection import ISection
from .HollowCircularSection import HollowCircularSection
from .RectangularSection import RectangularSection
from . import properties

__all__ = [
    'ISection',
    'HollowCircularSection',
    'RectangularSection',
    'properties',
]