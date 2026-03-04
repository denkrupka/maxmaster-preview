/**
 * DXF Units — $INSUNITS normalization and conversion
 * Based on AutoCAD INSUNITS system variable values
 */
import type { IDxf } from 'dxf-parser';

/** AutoCAD INSUNITS values */
export enum InsUnits {
  Unitless = 0,
  Inches = 1,
  Feet = 2,
  Miles = 3,
  Millimeters = 4,
  Centimeters = 5,
  Meters = 6,
  Kilometers = 7,
  Microinches = 8,
  Mils = 9,
  Yards = 10,
  Angstroms = 11,
  Nanometers = 12,
  Microns = 13,
  Decimeters = 14,
  Decameters = 15,
  Hectometers = 16,
  Gigameters = 17,
  AstronomicalUnits = 18,
  LightYears = 19,
  Parsecs = 20,
}

/** Conversion factor from each unit to meters */
const TO_METERS: Record<number, number> = {
  [InsUnits.Unitless]: 1,
  [InsUnits.Inches]: 0.0254,
  [InsUnits.Feet]: 0.3048,
  [InsUnits.Miles]: 1609.344,
  [InsUnits.Millimeters]: 0.001,
  [InsUnits.Centimeters]: 0.01,
  [InsUnits.Meters]: 1,
  [InsUnits.Kilometers]: 1000,
  [InsUnits.Microinches]: 0.0000000254,
  [InsUnits.Mils]: 0.0000254,
  [InsUnits.Yards]: 0.9144,
  [InsUnits.Angstroms]: 1e-10,
  [InsUnits.Nanometers]: 1e-9,
  [InsUnits.Microns]: 1e-6,
  [InsUnits.Decimeters]: 0.1,
  [InsUnits.Decameters]: 10,
  [InsUnits.Hectometers]: 100,
  [InsUnits.Gigameters]: 1e9,
  [InsUnits.AstronomicalUnits]: 1.496e11,
  [InsUnits.LightYears]: 9.461e15,
  [InsUnits.Parsecs]: 3.086e16,
};

/** Unit abbreviations */
const UNIT_ABBR: Record<number, string> = {
  [InsUnits.Unitless]: '',
  [InsUnits.Inches]: 'in',
  [InsUnits.Feet]: 'ft',
  [InsUnits.Miles]: 'mi',
  [InsUnits.Millimeters]: 'mm',
  [InsUnits.Centimeters]: 'cm',
  [InsUnits.Meters]: 'm',
  [InsUnits.Kilometers]: 'km',
  [InsUnits.Microinches]: 'µin',
  [InsUnits.Mils]: 'mil',
  [InsUnits.Yards]: 'yd',
  [InsUnits.Angstroms]: 'Å',
  [InsUnits.Nanometers]: 'nm',
  [InsUnits.Microns]: 'µm',
  [InsUnits.Decimeters]: 'dm',
  [InsUnits.Decameters]: 'dam',
  [InsUnits.Hectometers]: 'hm',
  [InsUnits.Gigameters]: 'Gm',
};

/** Unit full names (Polish) */
const UNIT_NAMES: Record<number, string> = {
  [InsUnits.Unitless]: 'Bez jednostki',
  [InsUnits.Inches]: 'Cale',
  [InsUnits.Feet]: 'Stopy',
  [InsUnits.Miles]: 'Mile',
  [InsUnits.Millimeters]: 'Milimetry',
  [InsUnits.Centimeters]: 'Centymetry',
  [InsUnits.Meters]: 'Metry',
  [InsUnits.Kilometers]: 'Kilometry',
  [InsUnits.Yards]: 'Jardy',
  [InsUnits.Decimeters]: 'Decymetry',
};

/** Extract $INSUNITS from DXF header */
export function getInsUnits(dxf: IDxf): InsUnits {
  const header = (dxf as any).header;
  if (!header) return InsUnits.Unitless;
  const val = header['$INSUNITS'];
  if (val == null) return InsUnits.Unitless;
  const num = typeof val === 'number' ? val : parseInt(String(val));
  if (isNaN(num) || TO_METERS[num] === undefined) return InsUnits.Unitless;
  return num as InsUnits;
}

/** Convert a value from DXF units to meters */
export function toMeters(value: number, insUnits: InsUnits): number {
  return value * (TO_METERS[insUnits] ?? 1);
}

/** Convert a value from meters to DXF units */
export function fromMeters(value: number, insUnits: InsUnits): number {
  const factor = TO_METERS[insUnits] ?? 1;
  return factor === 0 ? 0 : value / factor;
}

/** Convert between two unit systems */
export function convertUnits(value: number, fromUnits: InsUnits, toUnits: InsUnits): number {
  return fromMeters(toMeters(value, fromUnits), toUnits);
}

/** Get unit abbreviation */
export function getUnitAbbr(insUnits: InsUnits): string {
  return UNIT_ABBR[insUnits] || '';
}

/** Get unit full name (Polish) */
export function getUnitName(insUnits: InsUnits): string {
  return UNIT_NAMES[insUnits] || `Jednostka ${insUnits}`;
}

/** Format a value with its unit abbreviation */
export function formatWithUnit(value: number, insUnits: InsUnits, decimals: number = 2): string {
  const abbr = getUnitAbbr(insUnits);
  const formatted = value.toFixed(decimals);
  return abbr ? `${formatted} ${abbr}` : formatted;
}

/** Guess units from drawing extent if INSUNITS is not set */
export function guessUnits(extent: { width: number; height: number }): InsUnits {
  const maxDim = Math.max(extent.width, extent.height);
  // Typical A1 sheet: ~841mm x 594mm → if max > 100 likely mm
  // If extent is small (< 50) likely meters
  // If > 10000 likely mm
  if (maxDim > 10000) return InsUnits.Millimeters;
  if (maxDim > 100) return InsUnits.Millimeters;
  if (maxDim > 1) return InsUnits.Meters;
  return InsUnits.Meters;
}

/** Get conversion factor to square meters for area calculations */
export function areaToSqMeters(area: number, insUnits: InsUnits): number {
  const linearFactor = TO_METERS[insUnits] ?? 1;
  return area * linearFactor * linearFactor;
}
