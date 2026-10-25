"""Normalize Porsche PPA trip summaries; never estimate from battery percentages."""
import math

TRIP_MEASUREMENTS = {
    'TRIP_STATISTICS_SHORT_TERM': 'shortTerm',
    'TRIP_STATISTICS_LONG_TERM': 'longTerm',
    'TRIP_STATISTICS_CYCLIC': 'sinceCharge',
}


def metric(value, minimum=0, maximum=9_007_199_254_740_991):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if minimum <= value <= maximum and math.isfinite(value) else None


def normalize_trips(raw, fetched_at):
    from .provider import timestamp
    periods = {key: None for key in TRIP_MEASUREMENTS.values()}
    measurements = raw.get('measurements') if isinstance(raw, dict) else None
    if not isinstance(measurements, list):
        return {'status': 'error', 'fetchedAt': fetched_at, 'periods': periods}
    for item in measurements:
        if not isinstance(item, dict) or item.get('key') not in TRIP_MEASUREMENTS:
            continue
        if not isinstance(item.get('status'), dict) or item['status'].get('isEnabled') is not True:
            continue
        value = item.get('value')
        if not isinstance(value, dict):
            continue
        # Explicit field names carry their units. Do not infer units from generic values.
        row = {
            'distanceKm': metric(value.get('distanceKm')),
            'averageConsumptionKwhPer100Km': metric(value.get('avgKwhPerHundredKm'), -1000, 1000),
            'drivingTimeMinutes': metric(value.get('drivingTimeMinutes')),
            'averageSpeedKmh': metric(value.get('avgSpeedKmh')),
            'tripEndTime': timestamp(value.get('tripEndTime')),
        }
        if any(row[key] is not None for key in ('distanceKm', 'averageConsumptionKwhPer100Km', 'drivingTimeMinutes', 'averageSpeedKmh')):
            periods[TRIP_MEASUREMENTS[item['key']]] = row
    return {'status': 'available' if any(periods.values()) else 'unavailable',
            'fetchedAt': fetched_at, 'periods': periods}
