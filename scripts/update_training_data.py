import xml.etree.ElementTree as ET
import json
import os
import sys
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict

# ==============================================================
# STRAVA CONFIG — fill these in before running
# Get from https://www.strava.com/settings/api
# ==============================================================
STRAVA_CLIENT_ID     = "204319"
STRAVA_CLIENT_SECRET = "66844af6ac07e710933bbda9968673f763198ad9"
STRAVA_REFRESH_TOKEN = "55a4a924231e2e254fc5dd4d69e27b7a3b1c5570"

# Only include workouts on or after this date
FILTER_FROM_YEAR = 2026

# How close (seconds) Apple Health start time must be to Strava
# start time to count as the same workout
MATCH_TOLERANCE_SEC = 300  # 5 minutes

# Charlotte approx coordinates (used for weather fallback)
LAT = 35.227
LON = -80.843

# Strava sport types that get mile splits (distance-based activities only)
MILE_SPLIT_SPORT_TYPES = {"Run", "TrailRun", "Walk", "Hike"}

# ==============================================================
# APPLE HEALTH CONFIG
# ==============================================================
INTERESTING_TYPES = {
    # Universal
    'HKQuantityTypeIdentifierStepCount',
    'HKQuantityTypeIdentifierHeartRate',
    'HKQuantityTypeIdentifierActiveEnergyBurned',
    'HKQuantityTypeIdentifierElevationAscended',
    'HKQuantityTypeIdentifierElevationDescended',
    'HKQuantityTypeIdentifierVO2Max',
    # Running / walking
    'HKQuantityTypeIdentifierDistanceWalkingRunning',
    'HKQuantityTypeIdentifierRunningHeartRate',
    'HKQuantityTypeIdentifierRunningPower',
    'HKQuantityTypeIdentifierRunningSpeed',
    'HKQuantityTypeIdentifierRunningCadence',
    'HKQuantityTypeIdentifierRunningVerticalOscillation',
    'HKQuantityTypeIdentifierRunningGroundContactTime',
    'HKQuantityTypeIdentifierRunningStrideLength',
    # Cycling
    'HKQuantityTypeIdentifierDistanceCycling',
    'HKQuantityTypeIdentifierCyclingPower',
    'HKQuantityTypeIdentifierCyclingSpeed',
    'HKQuantityTypeIdentifierCyclingCadence',
    'HKQuantityTypeIdentifierCyclingFunctionalThresholdPower',
    # Swimming
    'HKQuantityTypeIdentifierDistanceSwimming',
    'HKQuantityTypeIdentifierSwimmingStrokeCount',
}

ADDITIVE_TYPES = {
    'HKQuantityTypeIdentifierStepCount',
    'HKQuantityTypeIdentifierDistanceWalkingRunning',
    'HKQuantityTypeIdentifierDistanceCycling',
    'HKQuantityTypeIdentifierDistanceSwimming',
    'HKQuantityTypeIdentifierSwimmingStrokeCount',
    'HKQuantityTypeIdentifierActiveEnergyBurned',
    'HKQuantityTypeIdentifierElevationAscended',
    'HKQuantityTypeIdentifierElevationDescended',
}

WEATHER_KEYS = {
    'HKMetadataKeyWeatherCondition': 'condition',
    'HKMetadataKeyWeatherTemperature': 'temperature',
    'HKMetadataKeyWeatherHumidity': 'humidity',
}


# ==============================================================
# STRAVA HELPERS
# ==============================================================

def get_strava_access_token() -> str:
    """Exchange refresh token for a fresh access token."""
    resp = requests.post(
        "https://www.strava.com/oauth/token",
        data={
            "client_id":     STRAVA_CLIENT_ID,
            "client_secret": STRAVA_CLIENT_SECRET,
            "refresh_token": STRAVA_REFRESH_TOKEN,
            "grant_type":    "refresh_token",
        },
        timeout=15,
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise ValueError(f"No access_token in Strava response: {resp.json()}")
    print("✅ Strava access token obtained")
    return token


def fetch_strava_activities(access_token: str, per_page: int = 200) -> list[dict]:
    """
    Fetch all activities from Strava from FILTER_FROM_YEAR onwards.
    Paginates automatically until the API returns an empty page.
    Returns a list of activity summary dicts (not streams).
    """
    after = int(datetime(FILTER_FROM_YEAR, 1, 1, tzinfo=timezone.utc).timestamp())

    activities = []
    page = 1
    headers = {"Authorization": f"Bearer {access_token}"}

    while True:
        resp = requests.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers=headers,
            params={"per_page": per_page, "page": page, "after": after},
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        activities.extend(batch)
        print(f"   Fetched page {page}: {len(batch)} activities (cumulative {len(activities)})")
        if len(batch) < per_page:
            break
        page += 1

    print(f"✅ Total Strava activities fetched ({FILTER_FROM_YEAR}+): {len(activities)}")
    return activities


def fetch_strava_mile_splits(activity_id: int, access_token: str) -> list[dict]:
    """
    Fetch the laps for a Strava activity and return mile-boundary timestamps.

    Strava's /activities/{id} endpoint returns `splits_standard` (imperial)
    which is exactly one entry per mile. Each entry has:
      - elapsed_time (seconds for that mile)
      - distance (meters, should be ~1609m per full mile)
      - moving_time
      - average_speed (m/s)
      - average_heartrate
      - average_cadence
      - average_watts
      - pace_zone

    We reconstruct the wall-clock start/end of each mile from the activity
    start_date + cumulative elapsed time.
    """
    resp = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()

    splits = data.get("splits_standard", [])  # imperial = miles
    if not splits:
        return []

    # activity start in UTC
    start_dt = datetime.fromisoformat(data["start_date"].replace("Z", "+00:00"))

    mile_splits = []
    cumulative_elapsed = 0

    for i, s in enumerate(splits):
        mile_start_dt = start_dt + timedelta(seconds=cumulative_elapsed)
        elapsed       = s.get("elapsed_time", 0)
        cumulative_elapsed += elapsed
        mile_end_dt   = start_dt + timedelta(seconds=cumulative_elapsed)

        mile_splits.append({
            "mile":            i + 1,
            "start":           mile_start_dt.isoformat(),
            "end":             mile_end_dt.isoformat(),
            "elapsed_sec":     elapsed,
            "moving_sec":      s.get("moving_time"),
            "distance_m":      round(s.get("distance", 0), 1),
            "distance_miles":  round(s.get("distance", 0) / 1609.344, 4),
            "avg_speed_ms":    s.get("average_speed"),
            # pace in min/mile
            "pace_min_per_mile": round(elapsed / 60 / (s.get("distance", 1) / 1609.344), 2)
                                  if s.get("distance") else None,
            "avg_hr":          s.get("average_heartrate"),
            "avg_cadence":     round(s.get("average_cadence", 0) * 2, 1)
                               if s.get("average_cadence") else None,  # Strava cadence = steps/min one foot → *2
            "avg_watts":       s.get("average_watts"),
            "pace_zone":       s.get("pace_zone"),
        })

    return mile_splits


def build_strava_index(activities: list[dict]) -> dict:
    """
    Build a dict keyed by UTC start datetime for fast lookup.
    Value: the activity summary dict (id, name, distance, etc.)
    """
    index = {}
    for a in activities:
        try:
            dt = datetime.fromisoformat(a["start_date"].replace("Z", "+00:00"))
            index[dt] = a
        except Exception:
            pass
    return index


def find_matching_strava_activity(apple_start: datetime, strava_index: dict) -> dict | None:
    """
    Find the Strava activity whose start time is closest to apple_start
    and within MATCH_TOLERANCE_SEC. Returns the activity dict or None.
    """
    # Normalise apple_start to UTC
    if apple_start.tzinfo is None:
        apple_start = apple_start.replace(tzinfo=timezone.utc)
    apple_utc = apple_start.astimezone(timezone.utc)

    best = None
    best_delta = timedelta(seconds=MATCH_TOLERANCE_SEC + 1)

    for strava_dt, activity in strava_index.items():
        delta = abs(apple_utc - strava_dt)
        if delta < best_delta:
            best_delta = delta
            best = activity

    return best if best_delta.total_seconds() <= MATCH_TOLERANCE_SEC else None


# ==============================================================
# APPLE HEALTH HELPERS  (unchanged from original)
# ==============================================================

def parse_apple_date(date_str: str) -> datetime:
    return datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S %z")


def extract_weather_from_metadata(metadata_list):
    weather = {}
    for entry in metadata_list:
        key   = entry.get('key')
        value = entry.get('value')
        if key in WEATHER_KEYS:
            short_key = WEATHER_KEYS[key]
            if short_key in ('temperature', 'humidity'):
                try:
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
    events    = workout.get('events', [])
    wk_start  = parse_apple_date(workout['start_date'])
    wk_end    = parse_apple_date(workout['end_date'])
    pauses    = []

    for e in events:
        if e['type'] == 'HKWorkoutEventTypePause':
            pauses.append(parse_apple_date(e['date']))
        elif e['type'] == 'HKWorkoutEventTypeResume':
            pauses.append(parse_apple_date(e['date']))

    if not pauses:
        return [(wk_start, wk_end)]

    pause_events  = sorted([(t, 'pause' if i % 2 == 0 else 'resume')
                             for i, t in enumerate(pauses)])
    current_start = wk_start
    new_segments  = []

    for t, action in pause_events:
        if action == 'pause' and current_start < t:
            new_segments.append((current_start, t))
        elif action == 'resume':
            current_start = t

    if current_start < wk_end:
        new_segments.append((current_start, wk_end))

    return [seg for seg in new_segments if seg[1] > seg[0]]


def compute_splits(workout):
    """Store active segments; mile splits come from Strava later."""
    workout['_active_segments'] = get_active_intervals(workout)
    workout['_samples']         = defaultdict(list)
    return workout


def sample_overlaps_active(sample_start, sample_end, active_segments):
    for a_start, a_end in active_segments:
        if sample_start <= a_end and sample_end >= a_start:
            return True
    return False


def get_weather_for_workout(start_date_str: str) -> dict | None:
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
        target_hour = start_dt.hour
        times  = data["hourly"]["time"]
        temps  = data["hourly"]["temperature_2m"]
        humids = data["hourly"]["relative_humidity_2m"]
        hours  = [int(t.split('T')[1][:2]) for t in times]
        idx    = min(range(len(hours)), key=lambda i: abs(hours[i] - target_hour))
        return {
            "temperature":  round(temps[idx] * 9/5 + 32, 1),
            "temp_unit":    "°F",
            "humidity":     round(humids[idx], 1),
            "humid_unit":   "%",
            "source":       "Open-Meteo Historical",
            "query_time":   times[idx],
        }
    except Exception as e:
        print(f"Weather fetch failed for {start_date_str}: {e}")
        return None


# ==============================================================
# MILE SPLIT AGGREGATION
# ==============================================================

def aggregate_hk_metrics_into_mile_splits(mile_splits: list[dict], samples: dict) -> list[dict]:
    """
    For each mile split (which has 'start' and 'end' ISO strings from Strava),
    average every Apple Health sample that falls within that window.
    Merges the result back into the mile split dict.
    """
    # Combine both HR types
    combined_hr = []
    for rtype in ['HKQuantityTypeIdentifierHeartRate', 'HKQuantityTypeIdentifierRunningHeartRate']:
        combined_hr.extend(samples.get(rtype, []))
    if combined_hr:
        samples = dict(samples)  # don't mutate caller's dict
        samples['HeartRate'] = sorted(combined_hr, key=lambda x: x[0])

    enriched = []
    for mile in mile_splits:
        m_start = datetime.fromisoformat(mile['start'])
        m_end   = datetime.fromisoformat(mile['end'])

        # Normalise to aware datetimes if needed
        if m_start.tzinfo is None:
            m_start = m_start.replace(tzinfo=timezone.utc)
        if m_end.tzinfo is None:
            m_end = m_end.replace(tzinfo=timezone.utc)

        hk_metrics = {}
        for rtype, vals in samples.items():
            # vals are (midpoint datetime, value float, duration_sec float)
            in_mile = []
            for mid, v, _ in vals:
                mid_aware = mid if mid.tzinfo else mid.replace(tzinfo=timezone.utc)
                if m_start <= mid_aware < m_end:
                    in_mile.append(v)

            if not in_mile:
                continue

            m = {
                'avg': round(sum(in_mile) / len(in_mile), 3),
                'min': round(min(in_mile), 3),
                'max': round(max(in_mile), 3),
            }
            if rtype in ADDITIVE_TYPES:
                m['sum'] = round(sum(in_mile), 3)

            # Shorten key names for readability
            short = (rtype
                     .replace('HKQuantityTypeIdentifier', '')
                     .replace('Running', ''))
            hk_metrics[short] = m

        enriched.append({**mile, "apple_health": hk_metrics})

    return enriched


# ==============================================================
# MAIN
# ==============================================================

def convert_xml_to_json():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    xml_file   = os.path.join(script_dir, 'export.xml')
    json_file  = os.path.join(script_dir, 'health_workouts_enhanced.json')

    if not os.path.exists(xml_file):
        print(f"❌ 'export.xml' not found in {script_dir}")
        return

    # ----------------------------------------------------------
    # STRAVA: authenticate + fetch all activities up front
    # ----------------------------------------------------------
    print("🔐 Authenticating with Strava...")
    try:
        access_token     = get_strava_access_token()
        strava_activities = fetch_strava_activities(access_token)
        strava_index     = build_strava_index(strava_activities)
    except Exception as e:
        print(f"⚠️  Strava fetch failed: {e}")
        print("   Continuing without Strava data — mile splits will be empty.")
        access_token  = None
        strava_index  = {}

    # ----------------------------------------------------------
    # PASS 1: Extract Apple Health running workouts + VO2Max
    # ----------------------------------------------------------
    print("🔄 Pass 1: Extracting running workouts + VO2Max records...")
    workouts      = []
    vo2max_records = []
    context       = ET.iterparse(xml_file, events=('end',))

    cutoff_dt = datetime(FILTER_FROM_YEAR, 1, 1, tzinfo=timezone.utc)

    for _, elem in context:
        if elem.tag == 'Workout':
            # Skip workouts before the cutoff year
            start_str = elem.get('startDate')
            if start_str:
                try:
                    wk_start = parse_apple_date(start_str)
                    if wk_start.astimezone(timezone.utc) < cutoff_dt:
                        elem.clear()
                        continue
                except Exception:
                    pass

            workout = {
                "activity_type":       elem.get('workoutActivityType'),
                "duration":            elem.get('duration'),
                "duration_unit":       elem.get('durationUnit'),
                "total_distance":      elem.get('totalDistance'),
                "distance_unit":       elem.get('totalDistanceUnit'),
                "total_energy_burned": elem.get('totalEnergyBurned'),
                "energy_unit":         elem.get('totalEnergyBurnedUnit'),
                "start_date":          elem.get('startDate'),
                "end_date":            elem.get('endDate'),
                "events":              [],
                "statistics":          [],
                "metadata":            [],
            }

            for child in elem:
                if child.tag == 'WorkoutEvent':
                    workout["events"].append({
                        "type":     child.get('type'),
                        "date":     child.get('date'),
                        "endDate":  child.get('endDate', None),
                        "duration": child.get('duration', None),
                    })
                elif child.tag == 'WorkoutStatistics':
                    stat = {"type": child.get('type'), "unit": child.get('unit')}
                    for attr in ('average', 'minimum', 'maximum', 'sum'):
                        if child.get(attr):
                            stat[attr] = float(child.get(attr))
                    workout["statistics"].append(stat)
                elif child.tag == 'MetadataEntry':
                    workout["metadata"].append({
                        "key":   child.get('key'),
                        "value": child.get('value'),
                    })

            workout['weather'] = extract_weather_from_metadata(workout["metadata"])
            workouts.append(compute_splits(workout))
            elem.clear()

        elif elem.tag == 'Record' and elem.get('type') == 'HKQuantityTypeIdentifierVO2Max':
            vo2max_records.append({
                "start_date":    elem.get('startDate'),
                "end_date":      elem.get('endDate'),
                "value":         float(elem.get('value')),
                "unit":          elem.get('unit'),
                "source_name":   elem.get('sourceName'),
                "creation_date": elem.get('creationDate'),
            })
            elem.clear()

    print(f"✅ Extracted {len(workouts)} workouts ({FILTER_FROM_YEAR}+)")
    print(f"   Found {len(vo2max_records)} VO₂ Max estimates")

    # ----------------------------------------------------------
    # PASS 2: Load Apple Health samples into each workout
    # ----------------------------------------------------------
    print("🔄 Pass 2: Assigning HK records to workouts...")
    context = ET.iterparse(xml_file, events=('end',))

    for _, elem in context:
        if elem.tag == 'Record':
            rec_type = elem.get('type')
            if rec_type not in INTERESTING_TYPES or rec_type == 'HKQuantityTypeIdentifierVO2Max':
                elem.clear()
                continue
            try:
                value     = float(elem.get('value'))
                start_str = elem.get('startDate')
                end_str   = elem.get('endDate')
                if not (start_str and end_str):
                    continue
                start_dt     = parse_apple_date(start_str)
                end_dt       = parse_apple_date(end_str)
                duration_sec = (end_dt - start_dt).total_seconds()
                if duration_sec < 0:
                    continue
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

    # ----------------------------------------------------------
    # PASS 3: Match each workout to Strava, get mile splits,
    #         then attach Apple Health metrics to each mile
    # ----------------------------------------------------------
    print("🔄 Pass 3: Matching workouts to Strava + building mile splits...")
    matched_count   = 0
    unmatched_count = 0

    for wk in workouts:
        samples = wk.pop('_samples', {})
        wk.pop('_active_segments', None)

        apple_start = parse_apple_date(wk['start_date'])
        strava_act  = find_matching_strava_activity(apple_start, strava_index) if strava_index else None

        if strava_act:
            matched_count += 1
            sport_type = strava_act.get('sport_type') or strava_act.get('type', '')
            wk['strava_id']        = strava_act['id']
            wk['strava_name']      = strava_act.get('name')
            wk['strava_sport_type'] = sport_type

            # Mile splits only make sense for distance-based activities (runs, walks, hikes)
            if sport_type in MILE_SPLIT_SPORT_TYPES:
                try:
                    raw_mile_splits = fetch_strava_mile_splits(strava_act['id'], access_token)
                except Exception as e:
                    print(f"   ⚠️  Could not fetch mile splits for activity {strava_act['id']}: {e}")
                    raw_mile_splits = []
                wk['mile_splits'] = aggregate_hk_metrics_into_mile_splits(raw_mile_splits, samples)
            else:
                wk['mile_splits'] = []  # cycling, swimming, etc. don't use mile splits
        else:
            unmatched_count += 1
            wk['strava_id']        = None
            wk['strava_name']      = None
            wk['strava_sport_type'] = None
            wk['mile_splits']      = []  # no Strava match → no mile splits

        # Clean any remaining temp keys
        for k in list(wk):
            if k.startswith('_'):
                del wk[k]

    print(f"   Matched: {matched_count} | Unmatched (no Strava): {unmatched_count}")

    # ----------------------------------------------------------
    # PASS 4: Weather enrichment
    # ----------------------------------------------------------
    print("🔄 Pass 4: Enriching with external weather data...")
    for wk in workouts:
        wk['enriched_weather'] = get_weather_for_workout(wk["start_date"])

    # ----------------------------------------------------------
    # OUTPUT
    # ----------------------------------------------------------
    output = {
        "workouts":        workouts,
        "vo2max_estimates": sorted(vo2max_records, key=lambda x: x.get("start_date", "")),
    }

    print(f"📊 Final: {len(workouts)} workouts | {matched_count} with Strava mile splits | "
          f"{len(vo2max_records)} VO₂ Max entries")

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