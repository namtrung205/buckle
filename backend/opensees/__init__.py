"""OpenSeesPy structural analysis module.

The heavy solver (``.main``, which imports ``openseespy``) is imported lazily so
that the light sub-packages (``.sections``, ``.materials``) can be imported and
unit-tested without the solver dependency installed.
"""

__all__ = ['run_analysis']


def __getattr__(name):
    if name == 'run_analysis':
        from .main import run_analysis
        return run_analysis
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")