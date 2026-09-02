import { describe, it, expect } from 'vitest';
import { releaseLabel } from '../excel';

describe('Excel export - release labeling', () => {
  it('should return empty string for undefined release', () => {
    expect(releaseLabel(undefined)).toBe('');
  });

  it('should return empty string for all-false release', () => {
    expect(releaseLabel({ my: false, mz: false, t: false })).toBe('');
  });

  it('should show My+T for mixed release', () => {
    expect(releaseLabel({ my: true, mz: false, t: true })).toBe('My+T');
  });

  it('should show Mz for mz-only release', () => {
    expect(releaseLabel({ my: false, mz: true, t: false })).toBe('Mz');
  });

  it('should show My for my-only release', () => {
    expect(releaseLabel({ my: true, mz: false, t: false })).toBe('My');
  });

  it('should show T for t-only release', () => {
    expect(releaseLabel({ my: false, mz: false, t: true })).toBe('T');
  });

  it('should show My+Mz for biaxial bending release', () => {
    expect(releaseLabel({ my: true, mz: true, t: false })).toBe('My+Mz');
  });

  it('should show My+Mz+T for all-released release', () => {
    expect(releaseLabel({ my: true, mz: true, t: true })).toBe('My+Mz+T');
  });

  it('should show Mz+T for mz+t release', () => {
    expect(releaseLabel({ my: false, mz: true, t: true })).toBe('Mz+T');
  });
});
