"""Versioned transport contract for Buckle structural models.

The API coordinate system is engineering Z-up. Coordinates are metres, section
dimensions are millimetres, material stiffness/strength values are pascals, and
loads use kN, kN/m, or kN/m² according to their type.
"""

from enum import Enum
from math import isclose
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SCHEMA_VERSION = "1.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Vector3(StrictModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class Node(StrictModel):
    id: int = Field(..., ge=1, description="Stable node ID")
    name: Optional[str] = None
    x: float = Field(..., description="X coordinate (m)")
    y: float = Field(..., description="Y coordinate (m)")
    z: float = Field(..., description="Z coordinate (m, vertical)")


class MemberCreate(StrictModel):
    """Normalized member mutation payload used by MCP/WebSocket tools."""

    id: int = Field(..., ge=1)
    label: Optional[str] = None
    nodei: int = Field(..., ge=1, description="Start node ID")
    nodej: int = Field(..., ge=1, description="End node ID")
    section: int = Field(..., ge=1, description="Referenced section ID")
    vecxz: Optional[list[float]] = Field(None, min_length=3, max_length=3)
    gamma: float = Field(0.0, description="Section rotation (degrees)")
    release: str = ""

    @model_validator(mode="after")
    def validate_endpoints(self) -> "MemberCreate":
        if self.nodei == self.nodej:
            raise ValueError("member endpoints must reference different nodes")
        return self


class MemberEndpoint(Node):
    """Denormalized endpoint retained for the v1 analysis transport contract."""


class Member(StrictModel):
    id: int = Field(..., ge=1, description="Stable member ID")
    label: Optional[str] = None
    nodei: MemberEndpoint
    nodej: MemberEndpoint
    section: int = Field(..., ge=1, description="Referenced section ID")
    vecxz: Optional[list[float]] = Field(None, min_length=3, max_length=3)
    gamma: float = Field(0.0, description="Section rotation (degrees)")
    release: str = ""

    @model_validator(mode="after")
    def validate_geometry(self) -> "Member":
        if self.nodei.id == self.nodej.id:
            raise ValueError("member endpoints must reference different nodes")
        distance_sq = sum(
            (a - b) ** 2
            for a, b in zip(
                (self.nodei.x, self.nodei.y, self.nodei.z),
                (self.nodej.x, self.nodej.y, self.nodej.z),
            )
        )
        if distance_sq <= 1e-18:
            raise ValueError("member must have non-zero length")
        return self


class Material(StrictModel):
    id: int = Field(..., ge=1)
    name: str
    category: Optional[str] = None
    code: Optional[str] = None
    E: float = Field(..., gt=0, description="Young's modulus (Pa)")
    nu: float = Field(..., gt=-1.0, lt=0.5)
    rho: Optional[float] = Field(None, ge=0, description="Mass density (kg/m³)")
    alpha: Optional[float] = None
    fy: Optional[float] = Field(None, gt=0)
    fc: Optional[float] = Field(None, gt=0)
    fu: Optional[float] = Field(None, gt=0)
    ft: Optional[float] = Field(None, gt=0)
    grade: Optional[str] = None
    preset: Optional[str] = None


SECTION_TYPE_ALIASES = {
    "i": "I",
    "isection": "I",
    "rectangular": "Rectangular",
    "circular": "Circular",
    "hollowcircular": "HollowCircular",
    "hollow_circular": "HollowCircular",
    "rectangularhollow": "RectangularHollow",
    "rectangular_hollow": "RectangularHollow",
    "channel": "Channel",
    "angle": "Angle",
    "tee": "Tee",
    "ipn": "IPN",
    "upn": "UPN",
}
SectionType = Literal[
    "I",
    "Rectangular",
    "Circular",
    "HollowCircular",
    "RectangularHollow",
    "Channel",
    "Angle",
    "Tee",
    "IPN",
    "UPN",
]


class Section(StrictModel):
    id: int = Field(..., ge=1)
    name: str = ""
    type: SectionType
    material: Material
    depth: Optional[float] = Field(None, gt=0, description="Depth (mm)")
    height: Optional[float] = Field(None, gt=0, description="Height (mm)")
    width: Optional[float] = Field(None, gt=0, description="Width (mm)")
    tw: Optional[float] = Field(None, gt=0, description="Web thickness (mm)")
    tf: Optional[float] = Field(None, gt=0, description="Flange thickness (mm)")
    diameter: Optional[float] = Field(None, gt=0, description="Diameter (mm)")
    thickness: Optional[float] = Field(None, gt=0, description="Thickness (mm)")
    r: Optional[float] = Field(None, ge=0, description="Root radius (mm)")
    ri: Optional[float] = Field(None, ge=0, description="Inner radius (mm)")
    properties: Optional[dict[str, float]] = None

    @field_validator("type", mode="before")
    @classmethod
    def canonical_type(cls, value: Any) -> Any:
        if isinstance(value, str):
            key = value.replace("-", "").replace("_", "").lower()
            return SECTION_TYPE_ALIASES.get(key, value)
        return value

    @model_validator(mode="after")
    def validate_dimensions(self) -> "Section":
        required = {
            "I": ("depth", "width", "tw", "tf"),
            "IPN": ("depth", "width", "tw", "tf"),
            "UPN": ("depth", "width", "tw", "tf"),
            "Channel": ("depth", "width", "tw", "tf"),
            "Tee": ("depth", "width", "tw", "tf"),
            "Rectangular": ("width", "height"),
            "Circular": ("diameter",),
            "HollowCircular": ("diameter", "thickness"),
            "RectangularHollow": ("width", "height", "thickness"),
            "Angle": ("width", "thickness"),
        }[self.type]
        missing = [name for name in required if getattr(self, name) is None]
        if missing:
            raise ValueError(f"section {self.type} requires: {', '.join(missing)}")
        return self


class SupportType(str, Enum):
    FIXED = "fixed"
    PINNED = "pinned"
    ROLLER = "roller"
    ROLLER_X = "roller-x"
    ROLLER_Y = "roller-y"
    CUSTOM = "custom"
    ELASTIC = "elastic"


class BoundaryCondition(StrictModel):
    id: int = Field(..., ge=1)
    targets: list[int] = Field(..., min_length=1)
    type: SupportType
    name: Optional[str] = None
    dx: float = 0.0
    dy: float = 0.0
    dz: float = 0.0
    rx: float = 0.0
    ry: float = 0.0
    rz: float = 0.0
    rotation: float = 0.0

    @model_validator(mode="after")
    def validate_dofs(self) -> "BoundaryCondition":
        values = (self.dx, self.dy, self.dz, self.rx, self.ry, self.rz)
        if self.type == SupportType.ELASTIC:
            if any(value < 0 for value in values):
                raise ValueError("elastic support stiffness must be non-negative")
        elif any(value not in (0, 1) for value in values):
            raise ValueError("rigid support DOF flags must be 0 or 1")
        return self


LoadType = Literal["nodal", "linear", "area", "pressure"]


class Load(StrictModel):
    id: int = Field(..., ge=1)
    targets: list[int] = Field(..., min_length=1)
    type: LoadType
    value: Vector3 = Field(default_factory=Vector3)
    magnitude: Optional[float] = None
    name: Optional[str] = None


class LinearLoad(Load):
    type: Literal["linear"] = "linear"


class Shell(StrictModel):
    id: int = Field(..., ge=1)
    name: Optional[str] = None
    nodes: list[int] = Field(..., min_length=4, max_length=4)
    thickness: float = Field(..., gt=0, description="Shell thickness (m)")
    material: Material

    @field_validator("nodes")
    @classmethod
    def unique_nodes(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("shell nodes must be unique")
        return value


class ModelMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")
    exportDate: Optional[str] = None
    modelName: str = "FEM Model"
    version: str = SCHEMA_VERSION


class Model(StrictModel):
    schemaVersion: Literal["1.0"]
    nodes: list[Node]
    members: list[Member]
    materials: list[Material] = Field(default_factory=list)
    sections: list[Section]
    loads: list[Load] = Field(default_factory=list)
    boundary_conditions: list[BoundaryCondition] = Field(default_factory=list)
    shells: list[Shell] = Field(default_factory=list)
    metadata: Optional[ModelMetadata] = None

    @model_validator(mode="after")
    def validate_references(self) -> "Model":
        node_by_id = self._unique(self.nodes, "node")
        section_by_id = self._unique(self.sections, "section")
        self._unique(self.members, "member")
        self._unique(self.loads, "load")
        self._unique(self.boundary_conditions, "boundary condition")
        self._unique(self.shells, "shell")

        for member in self.members:
            for endpoint_name, endpoint in (("nodei", member.nodei), ("nodej", member.nodej)):
                canonical = node_by_id.get(endpoint.id)
                if canonical is None:
                    raise ValueError(f"member {member.id} {endpoint_name} references missing node {endpoint.id}")
                if not all(
                    isclose(a, b, rel_tol=0.0, abs_tol=1e-9)
                    for a, b in zip(
                        (endpoint.x, endpoint.y, endpoint.z),
                        (canonical.x, canonical.y, canonical.z),
                    )
                ):
                    raise ValueError(
                        f"member {member.id} {endpoint_name} coordinates do not match node {endpoint.id}"
                    )
            if member.section not in section_by_id:
                raise ValueError(f"member {member.id} references missing section {member.section}")

        member_ids = {item.id for item in self.members}
        shell_ids = {item.id for item in self.shells}
        node_ids = set(node_by_id)
        for shell in self.shells:
            missing = set(shell.nodes) - node_ids
            if missing:
                raise ValueError(f"shell {shell.id} references missing nodes {sorted(missing)}")
        for condition in self.boundary_conditions:
            missing = set(condition.targets) - node_ids
            if missing:
                raise ValueError(
                    f"boundary condition {condition.id} references missing nodes {sorted(missing)}"
                )
        for load in self.loads:
            allowed = (
                node_ids
                if load.type == "nodal"
                else shell_ids
                if load.type in ("area", "pressure")
                else member_ids
            )
            missing = set(load.targets) - allowed
            if missing:
                raise ValueError(f"load {load.id} references missing {load.type} targets {sorted(missing)}")
        return self

    @staticmethod
    def _unique(items: list[Any], label: str) -> dict[int, Any]:
        by_id: dict[int, Any] = {}
        for item in items:
            if item.id in by_id:
                raise ValueError(f"duplicate {label} id {item.id}")
            by_id[item.id] = item
        return by_id


class AnalysisResponse(StrictModel):
    status: str
    output: dict[str, Any]


class ClientResponse(StrictModel):
    id: str
    message: str
    success: bool
