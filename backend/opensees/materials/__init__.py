"""
Materials Module

Standard material libraries (concrete, steel, aluminum, timber, reinforcement)
compliant with European and American design codes, plus helpers to resolve
material records into elastic constants.
"""

from .library import (
    MATERIAL_LIBRARY,
    MATERIAL_CATEGORIES,
    get_material_preset,
    resolve_elastic_moduli,
)

__all__ = [
    'MATERIAL_LIBRARY',
    'MATERIAL_CATEGORIES',
    'get_material_preset',
    'resolve_elastic_moduli',
]