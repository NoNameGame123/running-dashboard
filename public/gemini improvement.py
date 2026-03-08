import xml.etree.ElementTree as ET
import json
import os
import sys
import requests
from datetime import datetime, timedelta
from collections import defaultdict

# Expanded list — added VO2Max
INTERESTING_TYPES = {
    'HKQuantityTypeIdentifierStepCount',
    'HKQuantityTypeIdentifierDistanceWalkingRunning',
    'HKQuantityTypeIdentifierHeartRate',
    'HKQuantityTypeIdentifierRunningHeartRate',
    'HKQuantityTypeIdentifierActiveEnergyBurned',
    'HKQuantityTypeIdentifierRunningPower',
    'HKQuantityTypeIdentifierRunningSpeed',
    'HKQuantityTypeIdentifierRunningCadence',
    'HKQuantityTypeIdentifierRunningVerticalOscillation',
    'HKQuantityTypeIdentifierRunningGroundContactTime',
    'HKQuantityTypeIdentifierRunningStrideLength',
    'HKQuantityTypeIdentifierElevationAscended',
    'HKQuantityTypeIdentifierElevationDescended',
    'HKQuantityTypeIdentifierVO2Max',           # added
}

ADDITIVE_TYPES = {
    'HKQuantityTypeIdentifierStepCount',
    'HKQuantityTypeIdentifierDistanceWalkingRunning',
    'HKQuantityTypeIdentifierActiveEnergyBurned',
    'HKQuantityTypeIdentifierElevationAscended',
    'HKQuantityTypeIdentifierElevationDescended',
}

# Weather metadata keys (only relevant for Workouts)
WEATHER_KEYS = {
    'HKMetadataKeyWeatherCondition': 'condition',
    'HKMetadataKeyWeatherTemperature': 'temperature',
    'HKMetadataKeyWeatherHumidity': 'humidity',
}

# Charlotte approx coordinates (adjust if needed)
LAT = 35.227
LON = -80.843

def parse_apple_date(date_str: str) -> datetime:
    """Parse Apple Health date: '2023-01-15 14:30:00 -0500'"""
    return datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S %z")

def extract_weather_from_metadata(metadata_list):
    """Extract weather info from MetadataEntry list"""
    weather = {}
    for entry in metadata_list:
        key = entry.get('key')
        value = entry.get('value')
        if key in WEATHER_KEYS:
            short_key = WEATHER_KEYS[key]
            if short_key == 'temperature' or short_key == 'humidity':
                try:
                    # value like "72 °F" or "45 %"
                    if ' ' in value:
                        num_part, unit_part = value.split(maxsplit=1)
                        weather[short_key] = float(num_part.strip())
                        weather[f"{short_key}_unit"] = unit_part.strip()
                    else:
                        weather[short_key] = float(value)
                        weather[f"{short_key}_unit"] = "unknown"
                except ValueError:
                    weather[short_key] = value
            else:
                weather[short_key] = value
    return weather if weather else None

def get_active_intervals(workout):
    events = workout.get('events', [])
    wk_start = parse_apple_date(workout['start_date'])
    wk_end   = parse_apple_date(workout['end_date'])

    active_segments = [(wk_start, wk_end)]
    pauses = []

    for e in events:
        if e['type'] == 'HKWorkoutEventTypePause':
            pauses.append(parse_apple_date(e['date']))
        elif e['type'] == 'HKWorkoutEventTypeResume':
            pauses.append(parse_apple_date(e['date']))

    if not pauses:
        return active_segments

    pause_events = sorted([(t, 'pause' if i % 2 == 0 else 'resume') 
                           for i, t in enumerate(pauses)])

    current_start = wk_start
    new_segments = []

    for t, action in pause_events:
        if action == 'pause' and current_start < t:
            new_segments.append((current_start, t))
        elif action == 'resume':
            current_start = t

    if current_start < wk_end:
        new_segments.append((current_start, wk_end))

    return [seg for seg in new_segments if seg[1] > seg[0]]

def compute_splits(workout):
    wk_start = parse_apple_date(workout['start_date'])
    wk_end   = parse_apple_date(workout['end_date'])

    lap_ends = sorted([
        parse_apple_date(e['date'])
        for e in workout.get('events', [])
        if e['type'] == 'HKWorkoutEventTypeLap'
    ])

    split_intervals = []
    current = wk_start
    for end in lap_ends:
        if end > current:
            split_intervals.append((current, end))
        current = end
    if current < wk_end:
        split_intervals.append((current, wk_end))

    workout['_split_intervals'] = split_intervals
    workout['_active_segments'] = get_active_intervals(workout)
    workout['_samples'] = defaultdict(list)

    return workout

def sample_overlaps_active(sample_start, sample_end, active_segments):
    for a_start, a_end in active_segments:
        # Inclusive overlap check
        if sample_start <= a_end and sample_end >= a_start:
            return True
    return False

def get_weather_for_workout(start_date_str: str) -> dict | None:
    """Query Open-Meteo for temp & humidity at workout start hour"""
    try:
        start_dt = parse_apple_date(start_date_str)
        date_str = start_dt.strftime("%Y-%m-%d")
        
        url = (
            f"https://archive-api.open-meteo.com/v1/archive"
            f"?latitude={LAT}&longitude={LON}"
            f"&start_date={date_str}&end_date={date_str}"
            f"&hourly=temperature_2m,relative_humidity_2m"
            f"&timezone=America%2FNew_York"
        )
        
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        
        if "hourly" not in data or not data["hourly"]["time"]:
            return None
        
        # Find closest hour to workout start
        target_hour = start_dt.hour
        times = data["hourly"]["time"]
        temps = data["hourly"]["temperature_2m"]
        humids = data["hourly"]["relative_humidity_2m"]
        
        # Extract hours from times (e.g., '2026-01-02T14:00')
        hours = [int(t.split('T')[1][:2]) for t in times]
        closest_idx = min(range(len(hours)), key=lambda i: abs(hours[i] - target_hour))
        
        temp_c = temps[closest_idx]
        humid = humids[closest_idx]
        
        return {
            "temperature": round(temp_c * 9/5 + 32, 1),  # °F
            "temp_unit": "°F",
            "humidity": round(humid, 1),
            "humid_unit": "%",
            "source": "Open-Meteo Historical",
            "query_time": times[closest_idx]
        }
    except Exception as e:
        print(f"Weather fetch failed for {start_date_str}: {e}")
        return None

def convert_xml_to_json():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    xml_file = os.path.join(script_dir, 'export.xml')
    json_file = os.path.join(script_dir, 'health_workouts_enhanced.json')

    if not os.path.exists(xml_file):
        print(f"❌ 'export.xml' not found in {script_dir}")
        return

    print("🔄 Pass 1: Extracting running workouts + VO2Max records...")
    workouts = []
    vo2max_records = []           
    context = ET.iterparse(xml_file, events=('end',))

    for _, elem in context:
        if elem.tag == 'Workout' and elem.get('workoutActivityType') == 'HKWorkoutActivityTypeRunning':
            workout = {
                "activity_type": elem.get('workoutActivityType'),
                "duration": elem.get('duration'),
                "duration_unit": elem.get('durationUnit'),
                "total_distance": elem.get('totalDistance'),
                "distance_unit": elem.get('totalDistanceUnit'),
                "total_energy_burned": elem.get('totalEnergyBurned'),
                "energy_unit": elem.get('totalEnergyBurnedUnit'),
                "start_date": elem.get('startDate'),
                "end_date": elem.get('endDate'),
                "events": [],
                "statistics": [],
                "metadata": [],
            }

            for child in elem:
                if child.tag == 'WorkoutEvent':
                    workout["events"].append({
                        "type": child.get('type'),
                        "date": child.get('date'),
                        "endDate": child.get('endDate', None),
                        "duration": child.get('duration', None)
                    })
                elif child.tag == 'WorkoutStatistics':
                    stat = {
                        "type": child.get('type'),
                        "unit": child.get('unit')
                    }
                    if child.get('average'):
                        stat["average"] = float(child.get('average'))
                    if child.get('minimum'):
                        stat["minimum"] = float(child.get('minimum'))
                    if child.get('maximum'):
                        stat["maximum"] = float(child.get('maximum'))
                    if child.get('sum'):
                        stat["sum"] = float(child.get('sum'))
                    workout["statistics"].append(stat)
                elif child.tag == 'MetadataEntry':
                    workout["metadata"].append({
                        "key": child.get('key'),
                        "value": child.get('value')
                    })

            # Extract weather from metadata (if present)
            workout['weather'] = extract_weather_from_metadata(workout["metadata"])

            workouts.append(compute_splits(workout))
            elem.clear()

        elif elem.tag == 'Record' and elem.get('type') == 'HKQuantityTypeIdentifierVO2Max':
            vo2 = {
                "start_date": elem.get('startDate'),
                "end_date": elem.get('endDate'),
                "value": float(elem.get('value')),
                "unit": elem.get('unit'),
                "source_name": elem.get('sourceName'),
                "creation_date": elem.get('creationDate'),
            }
            vo2max_records.append(vo2)
            elem.clear()

    print(f"✅ Extracted {len(workouts)} running workouts")
    print(f"   Found {len(vo2max_records)} VO₂ Max estimates")

    # Pass 2: samples for workouts
    print("🔄 Pass 2: Assigning relevant records to workouts...")
    context = ET.iterparse(xml_file, events=('end',))

    for _, elem in context:
        if elem.tag == 'Record':
            rec_type = elem.get('type')
            if rec_type not in INTERESTING_TYPES or rec_type == 'HKQuantityTypeIdentifierVO2Max':
                elem.clear()
                continue

            try:
                value = float(elem.get('value'))
                start_str = elem.get('startDate')
                end_str   = elem.get('endDate')
                if not (start_str and end_str):
                    continue

                start_dt = parse_apple_date(start_str)
                end_dt   = parse_apple_date(end_str)
                duration_sec = (end_dt - start_dt).total_seconds()
                if duration_sec < 0:
                    continue  # Skip invalid negative durations

                # For zero-duration (point samples), use start as midpoint
                midpoint = start_dt + timedelta(seconds=duration_sec / 2)

                for wk in workouts:
                    wk_start = parse_apple_date(wk['start_date'])
                    wk_end   = parse_apple_date(wk['end_date'])
                    if start_dt >= wk_end or end_dt <= wk_start:
                        continue

                    if sample_overlaps_active(start_dt, end_dt, wk['_active_segments']):
                        wk['_samples'][rec_type].append((midpoint, value, duration_sec))
                        break

            except (ValueError, TypeError, KeyError):
                pass

            elem.clear()

    print("🔄 Aggregating per-split metrics...")
    for wk in workouts:
        wk['splits'] = []
        samples = wk.pop('_samples', {})
        active_segments = wk.pop('_active_segments', [])

        # Combine heart rate types into a single 'HeartRate' metric
        combined_hr = []
        for rtype in ['HKQuantityTypeIdentifierHeartRate', 'HKQuantityTypeIdentifierRunningHeartRate']:
            combined_hr.extend(samples.get(rtype, []))
        if combined_hr:
            samples['HeartRate'] = sorted(combined_hr)  # Sort by midpoint if needed

        for s_start, s_end in wk['_split_intervals']:
            split = {
                'start': s_start.isoformat(),
                'end': s_end.isoformat(),
                'metrics': {}
            }

            for rtype, vals in samples.items():
                in_split = [v for mid, v, _ in vals if s_start <= mid < s_end]
                if not in_split:
                    continue

                m = {
                    'avg': round(sum(in_split) / len(in_split), 3) if in_split else None,
                    'min': round(min(in_split), 3) if in_split else None,
                    'max': round(max(in_split), 3) if in_split else None,
                }
                if rtype in ADDITIVE_TYPES:
                    m['sum'] = round(sum(in_split), 3)

                split['metrics'][rtype] = m

            if split['metrics']:
                wk['splits'].append(split)

        # Clean temp fields
        for k in list(wk):
            if k.startswith('_'):
                del wk[k]

    print("🔄 Enriching with external weather data...")
    for wk in workouts:
        enriched_weather = get_weather_for_workout(wk["start_date"])
        wk['enriched_weather'] = enriched_weather

    output = {
        "workouts": workouts,
        "vo2max_estimates": sorted(vo2max_records, key=lambda x: x.get("start_date", ""))  # chronological
    }

    print(f"📊 Final: {len(workouts)} workouts with splits + {len(vo2max_records)} VO₂ Max entries")

    try:
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=None, separators=(',', ':'))
        print(f"💾 Saved compact JSON → {json_file}")
    except Exception as e:
        print(f"❌ Error writing JSON: {e}")

if __name__ == "__main__":
    try:
        convert_xml_to_json()
    except KeyboardInterrupt:
        print("\n🛑 Stopped by user.")
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)