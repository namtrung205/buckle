import { describe, it, expect } from 'vitest';
import { deriveHookedDevelopment } from '../anchorage';

describe('§25.4.3.1 — hooked development length', () => {
  it('the formula term governs for a typical bar: ldh = 0,24·fy/√f\'c·db', () => {
    // Ø20, fy 420, f'c 25: 0.24·420/5·20 = 403,2 mm > 8db = 160 > 150.
    const r = deriveHookedDevelopment({ diameterMm: 20, fy: 420, fc: 25, edition: '2025' });
    expect(r.ldhM).toBeCloseTo(0.4032, 6);
    expect(r.governedBy).toBe('formula');
  });

  it('floors at 150 mm for small bars and low grades', () => {
    // Ø10, fy 250, f'c 25: 0.24·250/5·10 = 120 mm < 150 → (c) governs.
    const r = deriveHookedDevelopment({ diameterMm: 10, fy: 250, fc: 25, edition: '2025' });
    expect(r.ldhM).toBeCloseTo(0.150, 9);
    expect(r.governedBy).toBe('150mm');
  });

  it('floors at 8·db where that exceeds both the formula and 150 mm', () => {
    // Ø25, fy 250, f'c 40: 0.24·250/√40·25 = 237 mm < 8·25 = 200? No — 237 > 200.
    // Ø14, fy 250, f'c 40: 0.24·250/√40·14 = 132,8 → max(132.8, 112, 150) = 150.
    // Need 8db > formula AND 8db > 150: Ø20+ with low fy/high fc.
    // Ø20, fy 250, f'c 60: 0.24·250/√60·20 = 154,9 < 160 = 8db → (b) governs.
    const r = deriveHookedDevelopment({ diameterMm: 20, fy: 250, fc: 60, edition: '2025' });
    expect(r.ldhM).toBeCloseTo(0.160, 6);
    expect(r.governedBy).toBe('8db');
  });

  it('grows with the lightweight factor λ', () => {
    const normal = deriveHookedDevelopment({ diameterMm: 20, fy: 420, fc: 25, edition: '2025' });
    const light = deriveHookedDevelopment({ diameterMm: 20, fy: 420, fc: 25, lambda: 0.75, edition: '2025' });
    expect(light.ldhM).toBeCloseTo(normal.ldhM / 0.75, 6);
  });

  it('cites §25.4.3.1', () => {
    const r = deriveHookedDevelopment({ diameterMm: 20, fy: 420, fc: 25, edition: '2025' });
    expect(r.refs.some((c) => c.clause === '25.4.3.1')).toBe(true);
  });
});
