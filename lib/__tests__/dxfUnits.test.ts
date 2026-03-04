import { describe, it, expect } from 'vitest';
import {
  getInsUnits, toMeters, fromMeters, convertUnits,
  getUnitAbbr, getUnitName, formatWithUnit, guessUnits, areaToSqMeters, InsUnits
} from '../dxfUnits';

describe('dxfUnits', () => {
  describe('getInsUnits', () => {
    it('returns Unitless when no header', () => {
      expect(getInsUnits({} as any)).toBe(InsUnits.Unitless);
    });

    it('returns Unitless when $INSUNITS not set', () => {
      expect(getInsUnits({ header: {} } as any)).toBe(InsUnits.Unitless);
    });

    it('extracts $INSUNITS correctly', () => {
      expect(getInsUnits({ header: { '$INSUNITS': 4 } } as any)).toBe(InsUnits.Millimeters);
      expect(getInsUnits({ header: { '$INSUNITS': 6 } } as any)).toBe(InsUnits.Meters);
      expect(getInsUnits({ header: { '$INSUNITS': 1 } } as any)).toBe(InsUnits.Inches);
    });
  });

  describe('toMeters', () => {
    it('converts mm to meters', () => {
      expect(toMeters(1000, InsUnits.Millimeters)).toBeCloseTo(1, 5);
    });

    it('converts cm to meters', () => {
      expect(toMeters(100, InsUnits.Centimeters)).toBeCloseTo(1, 5);
    });

    it('converts inches to meters', () => {
      expect(toMeters(1, InsUnits.Inches)).toBeCloseTo(0.0254, 5);
    });

    it('meters to meters is identity', () => {
      expect(toMeters(5.5, InsUnits.Meters)).toBe(5.5);
    });

    it('unitless is treated as 1:1', () => {
      expect(toMeters(42, InsUnits.Unitless)).toBe(42);
    });
  });

  describe('fromMeters', () => {
    it('converts meters to mm', () => {
      expect(fromMeters(1, InsUnits.Millimeters)).toBeCloseTo(1000, 5);
    });

    it('converts meters to feet', () => {
      expect(fromMeters(1, InsUnits.Feet)).toBeCloseTo(3.28084, 3);
    });

    it('round-trips correctly', () => {
      const val = 123.456;
      expect(fromMeters(toMeters(val, InsUnits.Centimeters), InsUnits.Centimeters)).toBeCloseTo(val, 5);
    });
  });

  describe('convertUnits', () => {
    it('converts mm to cm', () => {
      expect(convertUnits(100, InsUnits.Millimeters, InsUnits.Centimeters)).toBeCloseTo(10, 5);
    });

    it('converts feet to meters', () => {
      expect(convertUnits(1, InsUnits.Feet, InsUnits.Meters)).toBeCloseTo(0.3048, 5);
    });
  });

  describe('getUnitAbbr', () => {
    it('returns correct abbreviations', () => {
      expect(getUnitAbbr(InsUnits.Millimeters)).toBe('mm');
      expect(getUnitAbbr(InsUnits.Meters)).toBe('m');
      expect(getUnitAbbr(InsUnits.Inches)).toBe('in');
      expect(getUnitAbbr(InsUnits.Unitless)).toBe('');
    });
  });

  describe('getUnitName', () => {
    it('returns Polish unit names', () => {
      expect(getUnitName(InsUnits.Millimeters)).toBe('Milimetry');
      expect(getUnitName(InsUnits.Meters)).toBe('Metry');
    });
  });

  describe('formatWithUnit', () => {
    it('formats value with unit', () => {
      expect(formatWithUnit(123.456, InsUnits.Millimeters, 2)).toBe('123.46 mm');
    });

    it('formats unitless without suffix', () => {
      expect(formatWithUnit(42, InsUnits.Unitless, 0)).toBe('42');
    });
  });

  describe('guessUnits', () => {
    it('guesses mm for large drawings', () => {
      expect(guessUnits({ width: 50000, height: 30000 })).toBe(InsUnits.Millimeters);
    });

    it('guesses meters for small drawings', () => {
      expect(guessUnits({ width: 15, height: 10 })).toBe(InsUnits.Meters);
    });
  });

  describe('areaToSqMeters', () => {
    it('converts mm² to m²', () => {
      expect(areaToSqMeters(1000000, InsUnits.Millimeters)).toBeCloseTo(1, 5);
    });

    it('m² to m² is identity', () => {
      expect(areaToSqMeters(25, InsUnits.Meters)).toBe(25);
    });
  });
});
