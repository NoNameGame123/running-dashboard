import { useState, useMemo, useEffect, useCallback } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, BarChart, Bar, Cell, LabelList,
  Area, ComposedChart
} from "recharts";

/* ─── Viewport meta (mobile) ─────────────────────────────────────────────── */
(() => {
  if (!document.head.querySelector('meta[name="viewport"]')) {
    const m = document.createElement("meta");
    m.name = "viewport";
    m.content = "width=device-width, initial-scale=1, maximum-scale=1";
    document.head.appendChild(m);
  }
})();

/* ─── Roboto font ───────────────────────────────────────────────────────── */
(() => {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700;900&display=swap";
  if (!document.head.querySelector(`link[href="${l.href}"]`)) document.head.appendChild(l);
})();
const F = "'Roboto', sans-serif";

/* ─── Mobile hook ────────────────────────────────────────────────────────── */
function useIsMobile() {
  const [mob, setMob] = useState(() => window.innerWidth < 600);
  useEffect(() => {
    const fn = () => setMob(window.innerWidth < 600);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mob;
}

/* ─── Official BofA / Chicago Marathon logo URLs ───────────────────────── */
const BOA_HORIZONTAL = "https://assets-chicagomarathon-com.s3.amazonaws.com/wp-content/uploads/2019/03/BofA-logo-450x53.jpg";
const CHI_LOGO_SVG   = "https://www.chicagomarathon.com/wp-content/themes/cm/images/logo.svg?v=2";
const CHICAGO_BG     = "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=2000&q=80";

/* ─── Palette ─────────────────────────────────────────────────────────────── */
const C = {
  red:      "#E31837",
  darkRed:  "#B01229",
  navy:     "#012169",
  navyMid:  "#0a2d7a",
  white:    "#FFFFFF",
  offWhite: "#F7F8FA",
  light:    "#EEF0F5",
  border:   "#D4D8E2",
  midGray:  "#6B7280",
  darkGray: "#1F2937",
  green:    "#007A3D",
  amber:    "#C75000",
  bofaBlue: "#005EB8",
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const kmToMi = km => +(km * 0.621371).toFixed(2);
const mToFt  = m  => Math.round(m * 3.28084);

function paceToSec(p) {
  if (!p || p === "N/A") return null;
  const [m, s] = p.split(":").map(Number);
  return m * 60 + s;
}

function paceSecToLabel(sec) {
  if (sec == null) return "N/A";
  return `${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,"0")}`;
}

function fmtDate(dateStr) {
  const d  = new Date(dateStr + "T12:00:00");
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${mo[d.getMonth()]} ${d.getDate()}`;
}

function linReg(pts) {
  const n = pts.length;
  if (n < 2) return null;
  const sx  = pts.reduce((a,p) => a+p.x, 0), sy  = pts.reduce((a,p) => a+p.y, 0);
  const sxy = pts.reduce((a,p) => a+p.x*p.y, 0), sx2 = pts.reduce((a,p) => a+p.x*p.x, 0);
  const slope = (n*sxy - sx*sy) / (n*sx2 - sx*sx);
  const intercept = (sy - slope*sx) / n;
  const yMean = sy/n;
  const ssTot = pts.reduce((a,p) => a+Math.pow(p.y-yMean,2), 0);
  const ssRes = pts.reduce((a,p) => a+Math.pow(p.y-(slope*p.x+intercept),2), 0);
  return { slope, intercept, r2: ssTot===0 ? 0 : 1 - ssRes/ssTot };
}

function getMondayOf(dateStr) {
  const d   = new Date(dateStr + "T12:00:00");
  const dow = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() + (dow===0 ? -6 : 1-dow));
  return mon.toISOString().slice(0,10);
}

function buildWeekly(data) {
  const map = {};
  data.filter(d => d.type==="Run" || d.type==="Indoor Run").forEach(d => {
    const mon = getMondayOf(d.date);
    if (!map[mon]) map[mon] = { miles:0, runs:0, elev:0 };
    map[mon].miles += kmToMi(d.dist);
    map[mon].runs++;
    map[mon].elev += mToFt(d.elev);
  });
  return Object.entries(map).sort(([a],[b]) => a.localeCompare(b)).map(([mon, v]) => {
    const monD = new Date(mon+"T12:00:00");
    const endD = new Date(monD); endD.setDate(monD.getDate()+6);
    return {
      monDate:   mon,
      label:     fmtDate(mon),
      fullRange: `${fmtDate(mon)} – ${fmtDate(endD.toISOString().slice(0,10))}`,
      miles:     +v.miles.toFixed(1),
      runs:      v.runs,
      elev:      v.elev,
    };
  });
}

/* ─── Data extraction helpers (adapted for new JSON) ────────────────────── */
function extractPaceFromWorkout(w) {
  const distStat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierDistanceWalkingRunning');
  let distMi = 0;
  if (distStat) {
    distMi = parseFloat(distStat.sum ?? distStat.value);
    if (distStat.unit === 'km') distMi *= 0.621371;
  }
  const durationMin = parseFloat(w.duration || 0);
  if (distMi > 0 && durationMin > 0) {
    const paceMinPerMile = durationMin / distMi;
    const minutes = Math.floor(paceMinPerMile);
    let seconds = Math.round((paceMinPerMile - minutes) * 60);
    if (seconds === 60) {
      seconds = 0;
      return `${minutes + 1}:00`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  const speedStat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierRunningSpeed');
  let speedMph = 0;
  if (speedStat) {
    speedMph = parseFloat(speedStat.average ?? speedStat.value);
    if (speedStat.unit === 'km/hr') speedMph *= 0.621371;
  }
  if (speedMph > 0) {
    const paceMinPerMile = 60 / speedMph;
    const minutes = Math.floor(paceMinPerMile);
    let seconds = Math.round((paceMinPerMile - minutes) * 60);
    if (seconds === 60) {
      seconds = 0;
      return `${minutes + 1}:00`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  return "N/A";
}

function extractAvgHR(w) {
  const hrStat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierHeartRate');
  if (hrStat) return parseFloat(hrStat.average ?? hrStat.value);
  return null;
}

function extractMaxHR(w) {
  const hrStat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierHeartRate');
  if (hrStat && hrStat.maximum != null) return parseFloat(hrStat.maximum);
  return null;
}

function extractCadence(w) {
  const stepStat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierStepCount');
  const totalSteps = stepStat ? parseFloat(stepStat.sum ?? stepStat.value ?? 0) : 0;
  const durationMin = parseFloat(w.duration);
  if (durationMin > 0) return totalSteps / durationMin;
  return null;
}

function extractCalories(w) {
  const energyStat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierActiveEnergyBurned');
  if (energyStat) return parseFloat(energyStat.sum ?? energyStat.value);
  return null;
}

function extractElevation(w) {
  const elevMeta = w.metadata?.find(m => m.key === 'HKElevationAscended');
  if (elevMeta) {
    const valStr = elevMeta.value;
    const num = parseFloat(valStr);
    const unit = valStr.replace(/[0-9.\s]/g, '');
    if (unit === 'cm') return num / 100;
    if (unit === 'm') return num;
    return num;
  }
  return 0;
}

function extractRunningPower(w) {
  const powerStat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierRunningPower');
  if (powerStat) return parseFloat(powerStat.average ?? powerStat.value);
  return null;
}

function extractGroundContactTime(w) {
  const stat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierRunningGroundContactTime');
  return stat ? parseFloat(stat.average ?? stat.value) : null;
}

function extractVerticalOscillation(w) {
  const stat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierRunningVerticalOscillation');
  return stat ? parseFloat(stat.average ?? stat.value) : null;
}

function extractStrideLength(w) {
  const stat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierRunningStrideLength');
  return stat ? parseFloat(stat.average ?? stat.value) : null;
}

function createMileSplits(w) {
  // New format: mile_splits from Strava with apple_health metrics fused in
  if (Array.isArray(w.mile_splits) && w.mile_splits.length > 0) {
    return w.mile_splits.map(ms => {
      const ah  = ms.apple_health        || {};
      const hr  = ah.HeartRate           || {};
      const pwr = ah.Power               || {};
      const gct = ah.GroundContactTime   || {};
      const vo  = ah.VerticalOscillation || {};
      const sl  = ah.StrideLength        || {};
      const movingSec = ms.moving_sec ?? ms.elapsed_sec ?? 0;
      return {
        mile:         ms.mile,
        distMiles:    ms.distance_miles ?? null,
        distKm:       ms.distance_m ? ms.distance_m / 1000 : null,
        movingTimeSec: movingSec,
        elapsedSec:   ms.elapsed_sec ?? null,
        // pace from moving time so pauses don't inflate it
        paceSec:      (ms.distance_m && movingSec > 0)
                        ? movingSec / (ms.distance_m / 1609.344)
                        : null,
        // Prefer Strava avg_hr (top-level), fall back to apple_health.HeartRate.avg
        avgHR:    ms.avg_hr  != null ? ms.avg_hr  : (hr.avg  ?? null),
        maxHR:    hr.max  ?? null,
        minHR:    hr.min  ?? null,
        avgPower: pwr.avg ?? null,
        avgGCT:   gct.avg ?? null,
        avgVO:    vo.avg  ?? null,
        avgStride: sl.avg ?? null,
        paceZone: ms.pace_zone ?? null,
      };
    });
  }
  // Legacy fallback: old lap-based splits from apple health only
  if (Array.isArray(w.splits) && w.splits.length > 0) {
    return w.splits.map((split, idx) => {
      const metrics = split.metrics || {};
      const hrData  = metrics.HKQuantityTypeIdentifierHeartRate || metrics.HeartRate || {};
      return {
        mile: idx + 1, distMiles: null,
        distKm: metrics.HKQuantityTypeIdentifierDistanceWalkingRunning?.sum || 0,
        movingTimeSec: (new Date(split.end) - new Date(split.start)) / 1000,
        elapsedSec: null, paceSec: null,
        avgHR: hrData.avg || null, maxHR: hrData.max || null, minHR: hrData.min || null,
        avgPower: null, avgGCT: null, avgVO: null, avgStride: null, paceZone: null,
      };
    });
  }
  return [];
}
// Keep old name as alias for any callers
function createSplitsFromHeartRateData(w, distKm) { return createMileSplits(w); }

/* ─── Activity type label map ────────────────────────────────────────────── */
function sportLabel(actType) {
  const MAP = {
    HKWorkoutActivityTypeRunning:       "Run",
    HKWorkoutActivityTypeCycling:       "Cycling",
    HKWorkoutActivityTypeSwimming:      "Swimming",
    HKWorkoutActivityTypeWalking:       "Walking",
    HKWorkoutActivityTypeHiking:        "Hiking",
    HKWorkoutActivityTypeStrengthTraining: "Strength",
    HKWorkoutActivityTypeYoga:          "Yoga",
    HKWorkoutActivityTypeCoreTraining:  "Core",
    HKWorkoutActivityTypeFunctionalStrengthTraining: "Strength",
    HKWorkoutActivityTypeCrossTraining: "Cross-Training",
    HKWorkoutActivityTypeElliptical:    "Elliptical",
    HKWorkoutActivityTypeRowing:        "Rowing",
  };
  return MAP[actType] ?? actType?.replace("HKWorkoutActivityType","") ?? "Workout";
}

// Safari-safe date parse for Apple Health format "2026-01-02 08:19:19 -0400"
function parseAppleDate(ds) {
  if (!ds) return new Date();
  let s = ds.trim().replace(' ', 'T').replace(/ ([+-]\d{4})$/, '$1');
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

const RUNNING_TYPES_SET = new Set([
  "HKWorkoutActivityTypeRunning", "running", "Running", "RUNNING",
]);

function transformAppleHealthData(json, debugCallback) {
  if (!json?.workouts?.length) return [];

  // Log activity type distribution for debugging
  const typeCounts = {};
  json.workouts.forEach(w => {
    const t = w.activity_type ?? "(missing)";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  if (debugCallback) debugCallback(`Activity types in JSON: ${JSON.stringify(typeCounts)}`, "info");

  const runs = [], crossTraining = [];

  json.workouts.forEach(w => {
    const actType = w.activity_type ?? "";
    const isRun   = RUNNING_TYPES_SET.has(actType);
    try {
      // ── Robust Safari-safe date parse ─────────────────────────────────────
      const startDate   = parseAppleDate(w.start_date);
      const dateStr     = startDate.toISOString().slice(0, 10);
      const durationMin = parseFloat(w.duration) || 0;
      const durationSec = durationMin * 60;
      if (durationSec < 60) return;

      // ── Non-runs: minimal context for AI only, never shown on dashboard ───
      if (!isRun) {
        crossTraining.push({
          date:        dateStr,
          type:        sportLabel(actType),
          durationMin: Math.round(durationMin),
          calories:    extractCalories(w) != null ? Math.round(extractCalories(w)) : null,
          avgHR:       extractAvgHR(w)    != null ? +extractAvgHR(w).toFixed(1)    : null,
        });
        return;
      }

      // ── Runs ──────────────────────────────────────────────────────────────
      const distStat = w.statistics?.find(s => s.type === 'HKQuantityTypeIdentifierDistanceWalkingRunning');
      let distMi = distStat ? parseFloat(distStat.sum ?? distStat.value) : 0;
      // Some HK versions populate total_distance directly
      if (!distMi && w.total_distance) distMi = parseFloat(w.total_distance);
      const distKm = distMi * 1.60934;
      if (distKm < 0.1 || durationSec < 60) return;

      const mileSplits = createMileSplits(w);

      // Prefer median moving pace from Strava mile splits over AH-calculated pace
      // (AH uses total duration including pauses; Strava uses moving time)
      let pace = extractPaceFromWorkout(w);
      if (mileSplits.length >= 2) {
        const fullMiles = mileSplits.filter(ms => ms.distMiles != null && ms.distMiles >= 0.85 && ms.paceSec);
        if (fullMiles.length >= 2) {
          const sorted = [...fullMiles].sort((a, b) => a.paceSec - b.paceSec);
          const med = sorted[Math.floor(sorted.length / 2)];
          if (med?.paceSec) pace = paceSecToLabel(Math.round(med.paceSec));
        }
      }

      const avgHR             = extractAvgHR(w);
      const maxHR             = extractMaxHR(w);
      const avgCadence        = extractCadence(w);
      const calories          = extractCalories(w);
      const elevM             = extractElevation(w);
      const runningPower      = extractRunningPower(w);
      const groundContactTime = extractGroundContactTime(w);
      const vertOsc           = extractVerticalOscillation(w);
      const strideLen         = extractStrideLength(w);

      const indoorMeta = w.metadata?.find(m => m.key === 'HKIndoorWorkout');
      const isIndoor   = indoorMeta?.value === '1';
      const type       = isIndoor ? "Indoor Run" : "Run";
      const startHour  = startDate.getHours();
      const timeOfDay  = startHour < 9  ? "morning"
                       : startHour < 12 ? "late-morning"
                       : startHour < 15 ? "midday"
                       : startHour < 18 ? "afternoon"
                       : "evening";
      const ew = w.enriched_weather;

      runs.push({
        id:           `run-${startDate.toISOString()}-${runs.length}`,
        date:         dateStr,
        displayTime:  `${dateStr.slice(5)} ${String(startHour).padStart(2,"0")}:${String(startDate.getMinutes()).padStart(2,"0")}`,
        title:        w.strava_name || sportLabel(actType),
        type,
        dist:         distKm,
        pace,
        paceSec:      paceToSec(pace),
        elev:         elevM,
        movingTimeSec:  durationSec,
        elapsedTimeSec: durationSec,
        avgHR:        avgHR  != null ? +avgHR.toFixed(1)   : null,
        maxHR:        maxHR  != null ? +maxHR.toFixed(1)   : null,
        avgCadence:   avgCadence != null ? +avgCadence.toFixed(1) : null,
        calories:     calories != null ? Math.round(calories) : null,
        avgPower:     runningPower != null ? Math.round(runningPower) : null,
        avgGroundContactTime:   groundContactTime != null ? +groundContactTime.toFixed(1)  : null,
        avgVerticalOscillation: vertOsc != null           ? +vertOsc.toFixed(2)            : null,
        avgStrideLength:        strideLen != null          ? +strideLen.toFixed(2)          : null,
        avgSpeedKmh:  durationSec > 0 ? distKm / (durationSec / 3600) : 0,
        indoor:       isIndoor,
        startHour,
        timeOfDay,
        splits:       mileSplits,
        temperature:  ew?.temperature ?? null,
        humidity:     ew?.humidity    ?? null,
        stravaId:     w.strava_id   ?? null,
        stravaName:   w.strava_name ?? null,
      });
    } catch (err) {
      console.warn("Error processing workout:", err, w);
    }
  });

  if (debugCallback) {
    debugCallback(`Runs: ${runs.length} | Cross-training: ${crossTraining.length}`, runs.length > 0 ? "ok" : "warn");
  }
  // Stash cross-training on the function object so the component can read it
  transformAppleHealthData._crossTraining = crossTraining.sort((a, b) => a.date.localeCompare(b.date));
  return runs.sort((a, b) => a.date.localeCompare(b.date));
}

function extractVO2MaxData(json) {
  if (!json?.vo2max_estimates?.length) return [];
  const all = json.vo2max_estimates
    .sort((a,b) => a.start_date.localeCompare(b.start_date))
    .map(d => ({
      date: new Date(d.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      vo2max: d.value,
    }));
  return all.slice(5); // Skip first 5 (Apple Watch calibration noise)
}

/* ─── Motivational Quotes ────────────────────────────────── */
const MARATHON_QUOTES = [
  { q:"26.2 miles is just 1 mile done 26 times, plus 0.2 miles. You've run a mile before probably.", a:"Definitely a Coach" },
  { q:"The human body was not designed to run a marathon, but here we are I guess.", a:"A Doctor, Probably" },
  { q:"Running is just falling forward repeatedly for several hours. Gravity is doing most of the work.", a:"Physics" },
  { q:"If God wanted us to run 26 miles he would have made the finish line closer.", a:"Someone Sensible" },
  { q:"You miss 100% of the naps you don't take. But also you need to run today.", a:"Wayne Gretzky (adapted)" },
  { q:"Some people run marathons. Other people have hobbies they enjoy. Both are valid.", a:"A Therapist" },
  { q:"Chicago has deep dish pizza. You are running 26.2 miles to a city full of deep dish pizza. Keep going.", a:"Your Stomach" },
  { q:"Chafing is just your body's way of telling you it was involved.", a:"Your Thighs" },
  { q:"You trained in January. You trained in February. You are going to finish this race and then eat an unreasonable amount of food.", a:"The Training Plan" },
  { q:"Every mile you run is a mile you have run. That is simply true.", a:"Philosophy" },
  { q:"The hard part isn't the marathon. The hard part is explaining to people why you're doing a marathon.", a:"Every Marathon Dinner Party" },
  { q:"Nobody has ever regretted finishing a long run. Many people have regretted starting one but that's different.", a:"Running Logic" },
  { q:"Your legs will forgive you. Eventually. Probably by Thursday.", a:"Recovery Science" },
  { q:"A marathon is just a long run. A long run is just a medium run but longer. A medium run is just a short run but more. You see where this is going.", a:"Reductionism" },
  { q:"The toenail situation is temporary. The finishing medal is forever.", a:"Marathon Economics" },
];
function getTodayQuote() {
  return MARATHON_QUOTES[Math.floor(Date.now()/864e5) % MARATHON_QUOTES.length];
}

/* ─── Weekly Summary AI ──────────────────────────────────── */
const WEEKLY_LS_KEY = "weeklySummaryCache_v3";
function loadWeeklyCache() { try { return JSON.parse(localStorage.getItem(WEEKLY_LS_KEY)||"{}"); } catch { return {}; } }
function saveWeeklyCache(c) { try { localStorage.setItem(WEEKLY_LS_KEY,JSON.stringify(c)); } catch {} }

function WeeklySummaryAI({ weekData, allData }) {
  const [cache, setCache] = useState(() => loadWeeklyCache());
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const quote = useMemo(() => getTodayQuote(), []);

  const todayDate = new Date().toISOString().slice(0,10);
  const weekKey = `${weekData?.monDate || getMondayOf(new Date().toISOString().slice(0,10))}_${todayDate}`;
  const cached  = cache[weekKey];

  useEffect(() => {
    if (!weekData || cache[weekKey] || loading) return;
    const {
      thisWeekMi, thisWeekRuns, weekAvgHR, weekAvgPace, weekElev,
      weekMiChangePct, weekMiChange, prevCompletedMiles,
      trendDir, effTrend, acwr, weekInProgress, projectedMi,
      easyPct, weeksToRace, avgHRAll30, totalMi, runsCount,
    } = allData;
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const trainingPhase = weeksToRace > 20 ? "Base Building" : weeksToRace > 12 ? "Aerobic Development" : weeksToRace > 8 ? "Race-Specific" : "Taper";
    const phaseDesc = weeksToRace > 20
      ? "building aerobic infrastructure — easy volume is the entire job right now"
      : weeksToRace > 12
      ? "aerobic engine is developing — long run progression is the priority"
      : weeksToRace > 8
      ? "marathon-specific phase — quality over quantity, race-pace work begins"
      : "taper — protect the fitness already banked, trust the process";
    const prompt = `You are a marathon training coach. Write a 4-5 sentence training summary for a runner preparing for the Bank of America Chicago Marathon on October 11, 2026. Be direct and specific — use the actual numbers. Reference where they are in their training cycle (${trainingPhase} phase, ${weeksToRace} weeks out). Focus on the 2-3 most important observations: load vs last week, intensity quality (easy %), and any risk signals. Frame everything relative to what matters at this stage of Chicago prep: ${phaseDesc}. No generic motivation. Second person. Return ONLY the paragraph.\n\nToday: ${today} | Race: Oct 11 2026 (${weeksToRace} wks out) | Phase: ${trainingPhase}\n${weekInProgress?"Week in progress ("+thisWeekMi+" mi so far, proj "+projectedMi+")":"Week complete: "+thisWeekMi+" mi"} | Runs: ${thisWeekRuns} | Avg HR: ${weekAvgHR??'n/a'} bpm | Pace: ${weekAvgPace??'n/a'}/mi | Elev: ${weekElev} ft\nvs last week: ${weekMiChangePct!=null?(weekMiChangePct>0?"+":"")+weekMiChangePct+"% ("+(weekMiChange>0?"+":"")+weekMiChange+" mi from "+prevCompletedMiles+" mi)":"n/a"}\n4-wk trend: ${trendDir||"unknown"} | Efficiency: ${effTrend||"unknown"} | ACWR: ${acwr?acwr.ratio+" ("+acwr.zone+")":"unknown"} | Easy%: ${easyPct??'n/a'}%\nHR zones: easy <152, moderate 152-165, hard 165+. Easy runs in the 140s bpm = normal for this athlete.`;

    setLoading(true); setError(null);
    const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
    fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${GROQ_API_KEY}`},
      body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:220,messages:[{role:"user",content:prompt}]}),
    })
      .then(r=>r.json())
      .then(d=>{
        if(d.error) throw new Error(d.error.message||JSON.stringify(d.error));
        const text=(d.choices?.[0]?.message?.content||"").trim();
        if(!text) throw new Error("Empty response");
        const entry={text,timestamp:new Date().toISOString()};
        setCache(prev=>{const n={...prev,[weekKey]:entry};saveWeeklyCache(n);return n;});
      })
      .catch(e=>{console.error("WeeklySummaryAI:",e);setError(e.message);})
      .finally(()=>setLoading(false));
  },[weekKey,weekData]);

  return (
    <div>
      <div style={{borderLeft:`3px solid ${C.red}`,paddingLeft:14,marginBottom:14}}>
        <p style={{color:C.darkGray,fontSize:15,lineHeight:1.7,fontStyle:"italic",margin:"0 0 2px"}}>"{quote.q}"</p>
        <p style={{color:C.midGray,fontSize:13,margin:0}}>— {quote.a}</p>
      </div>
      {loading ? (
        <div>
          {[96,88,74].map((w,i)=>(
            <div key={i} style={{height:12,background:C.light,borderRadius:3,marginBottom:6,width:w+"%",animation:"pulse 1.5s ease-in-out infinite"}} />
          ))}
        </div>
      ) : error||!cached ? (
        <p style={{color:C.midGray,fontSize:15,lineHeight:1.75,margin:0,fontStyle:"italic"}}>
          {error?"Summary unavailable — check your Groq API key.":"Generating summary…"}
        </p>
      ) : (
        <div>
          <p style={{color:C.darkGray,fontSize:16,lineHeight:1.85,margin:"0 0 5px"}}>{cached.text}</p>
          <p style={{color:C.midGray,fontSize:13,margin:0}}>Generated {new Date(cached.timestamp).toLocaleDateString("en-US",{month:"short",day:"numeric"})} · refreshes daily</p>
        </div>
      )}
    </div>
  );
}

const RACE_DATE = new Date("2026-10-11T07:30:00");
const TRAINING_START = new Date("2026-01-19T00:00:00");

/* ─── Training Summary Utility ───────────────────────────────────────────── */
function summarizeTrainingData(runs, computed) {
  const {
    acwr, weeklyPolarized, weeksToRace, effReg, longRuns,
    avgHR, thisWeekMi, thisWeekRuns, avgPaceFmt30, totalMi,
    trainingMonotony, runs: allRuns, weekly, longRunTrend,
    hrTimeReg, firstRunDate, criticalPaceData, longRuns90Min,
    acwrHistory, crossTraining,
  } = computed;

  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const phase = weeksToRace > 20
    ? "base-building"
    : weeksToRace > 12
    ? "aerobic-development"
    : weeksToRace > 8
    ? "race-specific"
    : "taper";

    const easyPct150 = (() => {
      let easyMin = 0, totalMin = 0;
      let splitRunsUsed = 0;
      let fallbackRunsUsed = 0;
    
      allRuns.forEach(r => {
        const splits = r.splits || [];
        const hasGoodSplits = splits.length >= 2 && splits.some(s => s.avgHR && s.movingTimeSec);
    
        if (hasGoodSplits) {
          splitRunsUsed++;
          splits.forEach(s => {
            if (s.avgHR && s.movingTimeSec) {
              totalMin += s.movingTimeSec / 60;
              if (s.avgHR < 152) easyMin += s.movingTimeSec / 60;
            }
          });
        } else if (r.avgHR != null) {
          fallbackRunsUsed++;
          const min = r.movingTimeSec ? r.movingTimeSec / 60 : (r.paceSec && r.dist ? r.dist * r.paceSec / 60 : 0);
          totalMin += min;
          if (r.avgHR < 152) easyMin += min;
        }
      });
    
      const pct = totalMin > 0 ? +(easyMin / totalMin * 100).toFixed(1) : null;
    
      // ── DEBUG OUTPUT ──
      console.log("=== EASY PCT150 SPLIT DEBUG ===");
      console.log(`Total runs: ${allRuns.length}`);
      console.log(`✅ Using mile-level HR: ${splitRunsUsed} runs`);
      console.log(`⚠️  Using whole-run fallback: ${fallbackRunsUsed} runs`);
      console.log(`NEW Easy % for Coach's Report: ${pct}%`);
      console.log("=================================");
    
      return pct;
    })();

  const last4Weeks = weekly ? weekly.slice(-4).map(w => ({ week: w.label, miles: w.miles, runs: w.runs })) : [];

  const recentLongRuns = longRuns ? longRuns.slice(-5).map(r => ({
    date: r.date,
    miles: +r.miles.toFixed(1),
    avgHR: r.avgHR ? Math.round(r.avgHR) : null,
    pace: r.paceLabel,
    paceFadeSec: r.paceFadeSec != null ? +r.paceFadeSec.toFixed(1) : null,
    splitConsistencySec: r.splitConsistency ?? null,
    hrDriftBpm: r.hrDrift != null ? +r.hrDrift.toFixed(1) : null,
    isEasy: r.isEasy ?? null,
  })) : [];

  // Long run pacing trends (early season vs recent)
  const longRunQualityTrend = (() => {
    const withSplits = longRuns ? longRuns.filter(r => r.paceFadeSec != null || r.splitConsistency != null || r.hrDrift != null) : [];
    if (withSplits.length < 3) return null;
    const mid = Math.floor(withSplits.length / 2);
    const early = withSplits.slice(0, mid);
    const late  = withSplits.slice(-mid);
    const avg = (arr, key) => { const vals = arr.filter(r => r[key] != null); return vals.length ? +(vals.reduce((s,r)=>s+r[key],0)/vals.length).toFixed(1) : null; };
    return {
      earlyFadeSec: avg(early, 'paceFadeSec'),
      recentFadeSec: avg(late,  'paceFadeSec'),
      earlySigma: avg(early, 'splitConsistency'),
      recentSigma: avg(late,  'splitConsistency'),
      earlyHRDrift: avg(early, 'hrDrift'),
      recentHRDrift: avg(late,  'hrDrift'),
      runsAnalyzed: withSplits.length,
    };
  })();

  const hrTrend = hrTimeReg
    ? (hrTimeReg.slope < -0.3 ? "declining (good — cardiac adaptation occurring)"
      : hrTimeReg.slope > 0.3 ? "rising (watch for cumulative fatigue)"
      : "stable")
    : "insufficient data";

  const effTrend = effReg
    ? (effReg.slope > 0.001 ? "improving" : effReg.slope < -0.001 ? "declining" : "flat")
    : "unknown";

  const weeksTraining = firstRunDate
    ? Math.round((today - new Date(firstRunDate + "T12:00:00")) / (7 * 864e5))
    : null;

  const recentACWR = acwrHistory ? acwrHistory.slice(-4).map(w => ({ week: w.label, acwr: w.acwr, zone: w.zone })) : [];

  const sortedDates = [...new Set(runs.map(r => r.date))].sort();
  let maxConsecDays = 0, curConsec = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const diff = (new Date(sortedDates[i]) - new Date(sortedDates[i-1])) / 864e5;
    if (diff === 1) { curConsec++; maxConsecDays = Math.max(maxConsecDays, curConsec); }
    else curConsec = 1;
  }

  const thirtyAgo = new Date(today); thirtyAgo.setDate(today.getDate() - 30);
  const last30 = runs.filter(r => new Date(r.date + "T12:00:00") >= thirtyAgo);
  const avgMilesPerRun30 = last30.length ? +(last30.reduce((s,r) => s + kmToMi(r.dist), 0) / last30.length).toFixed(1) : null;

  // Last 10 runs detail for richer AI context
  const recentRunsDetail = allRuns.slice(-10).map(r => ({
    date: r.date,
    miles: +kmToMi(r.dist).toFixed(1),
    avgHR: r.avgHR ? Math.round(r.avgHR) : null,
    maxHR: r.maxHR ? Math.round(r.maxHR) : null,
    pace: paceSecToLabel(r.paceSec),
    durationMin: r.movingTimeSec ? Math.round(r.movingTimeSec / 60) : null,
    effortZone: r.avgHR == null ? "unknown" : r.avgHR < 152 ? "easy" : r.avgHR < 165 ? "moderate" : "hard",
    splitConsistency: r.splitConsistency ?? null,
    paceFadeSec: r.paceFadeSec != null ? +r.paceFadeSec.toFixed(1) : null,
  }));

  // Recent intensity pattern: how many easy/moderate/hard in last 10 runs
  const recentIntensityBreakdown = (() => {
    const last10 = allRuns.slice(-10).filter(r => r.avgHR != null);
    return {
      easy:     last10.filter(r => r.avgHR < 152).length,
      moderate: last10.filter(r => r.avgHR >= 152 && r.avgHR < 165).length,
      hard:     last10.filter(r => r.avgHR >= 165).length,
      total:    last10.length,
    };
  })();

  // Weekly volume trend: last 6 weeks
  const weeklyVolumeTrend = weekly ? weekly.slice(-6).map(w => ({
    week: w.label,
    miles: w.miles,
    runs: w.runs,
    easyPct: weeklyPolarized?.current?.find?.(z => z.id === "easy")?.pct ?? null,
  })) : [];

  // Best recent performances (for aerobic benchmarking)
  const bestRecentPace = (() => {
    const recent = allRuns.slice(-20).filter(r => r.paceSec && kmToMi(r.dist) >= 4);
    if (!recent.length) return null;
    const fastest = recent.reduce((b, r) => r.paceSec < b.paceSec ? r : b);
    return { pace: paceSecToLabel(fastest.paceSec), miles: +kmToMi(fastest.dist).toFixed(1), date: fastest.date };
  })();

  const thisWeekHRRuns = thisWeekRuns.filter(r => r.avgHR);
  const thisWeekAvgHR = thisWeekHRRuns.length ? Math.round(thisWeekHRRuns.reduce((s,r) => s + r.avgHR, 0) / thisWeekHRRuns.length) : null;

  // Summarize cross-training from last 30 days for AI coach context
  const recentCrossTraining = (() => {
    if (!Array.isArray(crossTraining) || !crossTraining.length) return {};
    const cutoff = new Date(today); cutoff.setDate(today.getDate() - 30);
    return crossTraining
      .filter(a => new Date(a.date + "T12:00:00") >= cutoff)
      .reduce((acc, a) => {
        if (!acc[a.type]) acc[a.type] = { sessions: 0, totalMin: 0 };
        acc[a.type].sessions++;
        acc[a.type].totalMin += a.durationMin || 0;
        return acc;
      }, {});
  })();

  return {
    today: todayStr,
    weeksToRace,
    raceDate: "October 11, 2026",
    phase,
    weeksInTraining: weeksTraining,
    totalMilesAllTime: totalMi,
    totalRunsAllTime: allRuns.length,
    acwr: acwr ? { ratio: acwr.ratio, zone: acwr.zone, acute: acwr.acute, chronic: acwr.chronic } : null,
    recentACWRHistory: recentACWR,
    trainingMonotony: trainingMonotony?.monotony ?? null,
    maxConsecutiveDaysWithoutRest: maxConsecDays,
    thisWeek: {
      miles: thisWeekMi,
      runs: thisWeekRuns.length,
      avgHR: thisWeekAvgHR,
      easyPct: weeklyPolarized.current.find(z => z.id === "easy")?.pct ?? null,
      moderatePct: weeklyPolarized.current.find(z => z.id === "medium")?.pct ?? null,
      hardPct: weeklyPolarized.current.find(z => z.id === "hard")?.pct ?? null,
    },
    weeklyVolumeTrend,
    allTimeEasyPct: easyPct150,
    avgPaceLast30d: avgPaceFmt30,
    avgHRLast30d: avgHR,
    avgMilesPerRunLast30d: avgMilesPerRun30,
    hrTrendOverSeason: hrTrend,
    aerobicEfficiencyTrend: effTrend,
    recentLongRuns,
    longRunQualityTrend,
    longRunCount: longRuns?.length ?? 0,
    longestRunToDate: longRuns?.length ? +Math.max(...longRuns.map(r=>r.miles)).toFixed(1) : null,
    longRunTrendSlope: longRunTrend ? +longRunTrend.slope.toFixed(3) : null,
    criticalPaces: {
      best10KPace: criticalPaceData?.best10KPace ?? null,
      bestTempoPace: criticalPaceData?.bestTempoPace ?? null,
      marathonPrediction: criticalPaceData?.marathonPred ?? null,
      bestMilePace: criticalPaceData?.bestMilePace ?? null,
    },
    recentIntensityBreakdown,
    bestRecentPace,
    recentRunsDetail,
    recentCrossTraining,
    athleteContext: {
      experience: "newer runner, aerobic base still developing — in first structured marathon training block",
      easyRunHRBaseline: "140s bpm is normal and expected for this athlete — do NOT flag as too hard",
      hrZones: {
        easy: "<152 bpm (Z1+Z2)",
        moderate: "152–165 bpm (Z3, the grey zone — avoid accumulating here)",
        hard: "165+ bpm (Z4–Z5, true quality work)",
      },
      interpretationNotes: [
        "HR in the 140s = easy aerobic for this athlete. This is healthy and expected.",
        "Pacing consistency (sigma) below 20s/mi = excellent long run control.",
        "Pace fade under 20s = even pacing; under 60s = normal fatigue; over 60s = went out too hard.",
        "HR drift under 8 bpm = good aerobic endurance; over 16 bpm = cardiovascular strain accumulating.",
        "ACWR above 1.3 = elevated injury risk; above 1.5 = high risk. Current phase: protect base.",
      ],
      seasonGoal: "Build aerobic base across 32-week Chicago build. Long run to 20–22 mi peak. Easy HR will drift lower as season progresses.",
      raceGoal: "Finish under 4:14:52 (beat Diddy's marathon time). Current marathon prediction vs target matters.",
    },
  };
}

function hashSummary(summary) {
  const key = [
    summary.acwr?.ratio ?? 0,
    summary.thisWeek.miles,
    summary.weeksToRace,
    summary.avgHRLast30d ?? 0,
    summary.allTimeEasyPct150 ?? 0,
    summary.recentLongRuns?.[summary.recentLongRuns.length - 1]?.miles ?? 0,
    summary.totalRunsAllTime,
  ].join("|");
  let h = 0;
  for (let i = 0; i < key.length; i++) { h = ((h << 5) - h) + key.charCodeAt(i); h |= 0; }
  return String(h);
}

/* ─── CoachReport Component ──────────────────────────────────────────────── */
const LS_KEY = "coachReportCache_v2";

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveToStorage(cache) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch {}
}

function CoachReport({ summary }) {
  const [cache, setCache] = useState(() => loadFromStorage());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const hash = summary ? hashSummary(summary) : null;
  const cached = hash ? cache[hash] : null;

  useEffect(() => {
    if (!summary || !hash || cache[hash] || loading) return;

    const phasePrompts = {
      "base-building":       "Focus on aerobic base development, consistency over intensity, building the aerobic engine. This is the most important phase — protect it.",
      "aerobic-development": "Aerobic engine is developing. Long run progression is the priority. Introduce tempo work carefully only if aerobic base is solid.",
      "race-specific":       "Introduce marathon-pace work and race-specific long runs. Volume should be peaking or just past peak. Quality over quantity now.",
      "taper":               "Protect fitness already built. Reduce volume significantly while maintaining intensity. Trust the process — the work is done.",
    };

    const phaseContext = phasePrompts[summary.phase] || phasePrompts["base-building"];

    const systemPrompt = `You are coaching in the direct, evidence-based style of Steve Magness. You have full access to this athlete's Strava and Apple Watch data — use it precisely.\n\nMAGNESS PHILOSOPHY:\n1. Stress + Rest = Adaptation. Easy days are when adaptation from hard work gets consolidated. Most recreational athletes chronically under-recover.\n2. Polarize ruthlessly. 80% easy, 20% hard. The grey zone (152–165 bpm) is the enemy — too hard to recover from, too easy to drive adaptation.\n3. Build aerobic infrastructure first. Mitochondrial density, fat oxidation, cardiac stroke volume — built at low intensity. The aerobic base is the ceiling for everything else.\n4. Progressive overload with planned recovery. ACWR above 1.3 = yellow. Above 1.5 = red. Volume builds in 3-week blocks then a down week.\n5. Specificity late, base early. Marathon-specific work only in final 10–12 weeks. Now: build the engine.\n6. Long runs are the cornerstone. Must be easy (HR <152 for this athlete). Running them too hard is the most common mistake in marathon prep.\n7. Trust the data over the plan. This athlete's numbers tell a specific story — read it.\n\nATHLETE CONTEXT — non-negotiable, always apply:\n- Newer runner in first structured marathon training block. Base is developing — this is expected, not a problem.\n- Easy runs sit in the 140s bpm — this is their aerobic baseline. Do NOT flag 140s HR as too hard.\n- HR zones (athlete-specific only): easy <152 bpm · moderate 152–165 · hard 165+\n- Race goal: finish Chicago Marathon under 4:14:52. Every training decision is in service of that.\n- Season goal: by race week, runs that feel hard now should feel easy — that's the aerobic adaptation.\n\nINTERPRETING KEY METRICS:\n- Pace fade (last mile − first mile): ≤20s = even; ≤60s = normal drift; >60s = went out too hard\n- HR drift (last mile − first mile HR): <8 bpm = strong aerobic endurance; 8–16 = moderate; >16 = cardiovascular strain accumulating\n- Split σ (std dev of mile paces): <20s = excellent consistency; 20–40s = moderate; >40s = erratic effort control\n- ACWR ratio: sweet spot 0.8–1.3. Above 1.3 = elevated injury risk\n- Long run quality trend: improving fade/drift over time = aerobic system is adapting and strengthening\n- Training monotony: <1.5 = good variety; >2.0 = risky sameness increasing injury probability\n- allTimeEasyPct: percentage of all training time spent at easy HR. Target is ≥80%. Grey zone accumulation (moderate %) is the key risk to watch.\n\nTODAY: ${summary.today}\nTRAINING PHASE: ${summary.phase.toUpperCase()} — ${phaseContext}\nRACE: ${summary.raceDate} | ${summary.weeksToRace} weeks to go\nMARATHON TARGET: under 4:14:52 | Current prediction: ${summary.criticalPaces?.marathonPrediction ?? "unknown"}\n\nOUTPUT FORMAT — respond ONLY with this exact JSON, no markdown, no preamble:\n{\n  "concerns": [\n    { "level": "HIGH|MEDIUM", "title": "concise title", "body": "2-4 sentences. State the specific pattern from the data, explain the physiological mechanism (why it matters for marathon prep), and give a concrete fix. Cite actual numbers.", "stillApplicable": true }\n  ],\n  "guidance": [\n    { "n": "01", "title": "action-oriented title", "body": "3-5 sentences. Ground in physiology. Name the adaptation mechanism. Reference actual numbers — pace, HR, mileage, ACWR, splits, long run trends. Be direct." }\n  ],\n  "thisWeekAction": "One concrete workout prescription. Specific: distance, target HR or pace range, context. Must reference actual current numbers. 2-3 sentences.",\n  \"generatedAt\": \"${new Date().toISOString()}\"\n}\n\nRules: HIGH concerns before MEDIUM. Exactly 3 guidance items. thisWeekAction = real prescription with numbers, not a principle.`;

    const lrq = summary.longRunQualityTrend;
    const lrTrendSummary = lrq
      ? `Long run quality (${lrq.runsAnalyzed} runs): fade ${lrq.earlyFadeSec}s → ${lrq.recentFadeSec}s | σ ${lrq.earlySigma}s → ${lrq.recentSigma}s | HR drift ${lrq.earlyHRDrift} → ${lrq.recentHRDrift} bpm`
      : "Long run quality trend: insufficient split data yet";
    const rib = summary.recentIntensityBreakdown;
    const intensityStr = rib
      ? `Last ${rib.total} runs with HR: ${rib.easy} easy / ${rib.moderate} moderate / ${rib.hard} hard`
      : "Intensity breakdown: no HR data";
    const userPrompt = `ATHLETE TRAINING DATA — analyze and generate a coach's report in Steve Magness's style.\n\nKEY METRICS SNAPSHOT:\n- Phase: ${summary.phase} | ${summary.weeksToRace} weeks to Chicago Marathon\n- This week: ${summary.thisWeek.miles} mi, ${summary.thisWeek.runs} runs | easy ${summary.thisWeek.easyPct}% / mod ${summary.thisWeek.moderatePct}% / hard ${summary.thisWeek.hardPct}% | avg HR ${summary.thisWeek.avgHR ?? "n/a"} bpm\n- ACWR: ${summary.acwr?.ratio ?? "unknown"} (${summary.acwr?.zone ?? "n/a"}) | acute ${summary.acwr?.acute ?? "?"} mi / chronic ${summary.acwr?.chronic ?? "?"} mi\n- Training monotony: ${summary.trainingMonotony ?? "n/a"} | Max consecutive days without rest: ${summary.maxConsecutiveDaysWithoutRest}\n- All-time easy %: ${summary.allTimeEasyPct}% (target ≥80%) | ${intensityStr}\n- HR trend over season: ${summary.hrTrendOverSeason} | Aerobic efficiency: ${summary.aerobicEfficiencyTrend}\n- Longest run: ${summary.longestRunToDate ?? "n/a"} mi across ${summary.longRunCount} long runs\n- ${lrTrendSummary}\n- Marathon prediction: ${summary.criticalPaces?.marathonPrediction ?? "unknown"} | Target: sub-4:14:52 | Best mile: ${summary.criticalPaces?.bestMilePace ?? "n/a"}\n- Best recent effort (4+ mi): ${summary.bestRecentPace ? summary.bestRecentPace.pace + "/mi for " + summary.bestRecentPace.miles + " mi on " + summary.bestRecentPace.date : "n/a"}\n\nFULL DATA:\n${JSON.stringify(summary, null, 2)}\n\nANALYSIS REMINDERS:\n- Today is ${summary.today}. Use exact dates — do not approximate.\n- HR in the 140s is fine. Do not flag it.\n- Athlete-specific zones only: easy <152, moderate 152–165, hard 165+.\n- Every concern and guidance must cite specific numbers from the data.\n- Long run quality trend (fade, drift, sigma improving or worsening) is a key signal of aerobic development.\n- The marathon prediction vs 4:14:52 is always relevant — quantify the gap when data allows.\n- generatedAt must be today's ISO date.`;

    const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;

    setLoading(true);
    setError(null);

    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 2500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(`API error ${data.error.code ?? ""}: ${data.error.message ?? JSON.stringify(data.error)}`);
        const raw = data.choices?.[0]?.message?.content || "";
        const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
        let parsed;
        try {
          parsed = JSON.parse(clean);
        } catch (parseErr) {
          console.warn("Initial parse failed, attempting salvage:", parseErr.message);
          const fallbackJson = {
            concerns: [],
            guidance: [],
            thisWeekAction: "Focus on keeping all runs easy this week — heart rate under 150 bpm. Log how each run feels vs. the number.",
            generatedAt: new Date().toISOString()
          };
          const salvageStr = clean
            .replace(/,\s*"[^"]*"\s*:\s*[^,}\]]*$/, "")
            .replace(/,\s*$/, "") +
            ',\n  "thisWeekAction": ' + JSON.stringify(fallbackJson.thisWeekAction) + ',\n  "generatedAt": "' + new Date().toISOString() + '"\n}';
          try {
            parsed = JSON.parse(salvageStr);
            console.warn("Salvaged truncated response successfully");
          } catch {
            throw new Error("Response was truncated and could not be recovered. This usually means the model ran out of tokens — try refreshing.");
          }
        }
        const entry = { data: parsed, timestamp: new Date().toISOString() };
        setCache(prev => {
          const next = { ...prev, [hash]: entry };
          saveToStorage(next);
          return next;
        });
      })
      .catch(err => {
        console.error("CoachReport API error:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [hash, summary]);

  const fmtGenerated = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getDate()}`;
  };

  const runCount = summary?.totalRunsAllTime ?? 0;

  if (loading) {
    return (
      <div>
        <div style={{ marginBottom: 36 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: "#f5f5f5", border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.border}`, borderRadius: 6, padding: "18px 22px", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 9 }}>
                <div style={{ width: 56, height: 22, background: C.light, borderRadius: 3, animation: "pulse 1.5s ease-in-out infinite" }} />
                <div style={{ width: "55%", height: 22, background: C.light, borderRadius: 3, animation: "pulse 1.5s ease-in-out infinite" }} />
              </div>
              <div style={{ width: "90%", height: 14, background: C.light, borderRadius: 3, marginBottom: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
              <div style={{ width: "70%", height: 14, background: C.light, borderRadius: 3, animation: "pulse 1.5s ease-in-out infinite" }} />
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0" }}>
            <div style={{ width: 18, height: 18, border: `2px solid ${C.light}`, borderTopColor: C.navy, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <span style={{ color: C.midGray, fontSize: 14 }}>Generating personalized coach's analysis…</span>
          </div>
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
        </div>
      </div>
    );
  }

  if (error || !cached) {
    const diagnosis = (() => {
      if (!error) return null;
      if (error.includes("401") || error.toLowerCase().includes("invalid api key") || error.toLowerCase().includes("unauthorized"))
        return { fix: "Your Groq API key is invalid or missing.", action: "Open App.jsx, find line with GROQ_API_KEY, and paste your key from console.groq.com." };
      if (error.includes("429") || error.toLowerCase().includes("rate limit"))
        return { fix: "You've hit Groq's rate limit.", action: "Wait a minute and refresh. The free tier allows ~30 requests/minute." };
      if (error.includes("Failed to fetch") || error.toLowerCase().includes("network"))
        return { fix: "Network request failed — likely a CORS block.", action: "Groq allows browser requests but double-check your key is set. Try opening the browser console (F12) for the exact error." };
      if (error.toLowerCase().includes("truncated") || error.toLowerCase().includes("json") || error.toLowerCase().includes("parse"))
        return { fix: "The model's response was cut off before finishing.", action: "This has been fixed — max_tokens is now 2500. Refresh the page to retry. If it keeps happening, check the browser console for details." };
      return { fix: "Unexpected error.", action: "Check the browser console (F12 → Console tab) for the full error message." };
    })();

    return (
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.amber}`, borderRadius: 8, padding: "28px 32px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <p style={{ color: C.darkGray, fontWeight: 700, fontSize: 16, margin: "0 0 8px" }}>
              {error ? "Coaching report failed to load" : "Waiting for training data…"}
            </p>
            {error ? (
              <>
                <p style={{ color: C.midGray, fontSize: 14, lineHeight: 1.7, margin: "0 0 14px" }}>
                  {diagnosis ? diagnosis.fix : error}
                </p>
                {diagnosis && (
                  <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 6, padding: "12px 16px", marginBottom: 14 }}>
                    <p style={{ color: C.navy, fontWeight: 600, fontSize: 12, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>How to fix</p>
                    <p style={{ color: C.darkGray, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{diagnosis.action}</p>
                  </div>
                )}
                <p style={{ color: C.midGray, fontSize: 13, margin: 0 }}>
                  Raw error: <code style={{ background: C.light, padding: "2px 6px", borderRadius: 3, fontSize: 12 }}>{error}</code>
                </p>
              </>
            ) : (
              <p style={{ color: C.midGray, fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                The coaching report generates automatically once training data loads. If this persists after the dashboard finishes loading, check that your Groq API key is set in App.jsx.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { data, timestamp } = cached;
  const genDate = fmtGenerated(data.generatedAt || timestamp);
  const metaLabel = genDate ? `Generated ${genDate} · based on ${runCount} runs` : `Based on ${runCount} runs`;

  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ color: C.navy, fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Areas of Concern</h3>
          <span style={{ color: C.midGray, fontSize: 13 }}>{metaLabel}</span>
        </div>
        <p style={{ color: C.midGray, fontSize: 14, margin: "0 0 14px" }}>Patterns in the data that carry real injury or adaptation risk if not addressed before the next training block.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
        {[...data.concerns].sort((a,b)=>(b.level==="HIGH"?1:0)-(a.level==="HIGH"?1:0)).map((c, i) => {
          const isHigh = c.level === "HIGH";
          const clr = isHigh ? C.red : C.amber;
          const bg = isHigh ? "#fff0f2" : "#fff8f0";
          return (
            <div key={i} style={{ background: bg, border: `1px solid ${clr}40`, borderLeft: `4px solid ${clr}`, borderRadius: 6, padding: "18px 22px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: clr, border: `1px solid ${clr}`, padding: "3px 9px", borderRadius: 3 }}>{c.level}</span>
                <p style={{ color: C.darkGray, fontWeight: 700, fontSize: 18, margin: 0, flex: 1 }}>{c.title}</p>
                {c.stillApplicable && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.amber, background: "#fff3e0", border: `1px solid ${C.amber}50`, borderRadius: 4, padding: "2px 7px", flexShrink: 0 }}>⟳ Ongoing</span>
                )}
              </div>
              <p style={{ color: "#444", fontSize: 15, lineHeight: 1.75, margin: "0 0 8px" }}>{c.body}</p>
              <p style={{ color: C.midGray, fontSize: 12, margin: 0 }}>{metaLabel}</p>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 14 }}>
        <h3 style={{ color: C.navy, fontSize: 20, fontWeight: 700, margin: "0 0 4px", letterSpacing: "-0.02em" }}>Training Guidance</h3>
        <p style={{ color: C.midGray, fontSize: 14, margin: 0 }}>Principle-based recommendations derived from your current data.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
        {data.guidance.slice(0,3).map((a, i) => (
          <div key={i} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: "16px 20px", display: "flex", gap: 16, alignItems: "flex-start" }}>
            <span style={{ color: C.red, fontSize: 24, fontWeight: 900, flexShrink: 0, lineHeight: 1.2, minWidth: 30, marginTop: 2 }}>{a.n}</span>
            <div style={{ flex: 1 }}>
              <p style={{ color: C.navy, fontWeight: 700, fontSize: 18, margin: "0 0 7px" }}>{a.title}</p>
              <p style={{ color: "#444", fontSize: 15, lineHeight: 1.78, margin: "0 0 8px" }}>{a.body}</p>
              <p style={{ color: C.midGray, fontSize: 12, margin: 0 }}>{metaLabel}</p>
            </div>
          </div>
        ))}
      </div>

      {data.thisWeekAction && (
        <div style={{ background: `linear-gradient(135deg,${C.navy}06,${C.navy}02)`, border: `1px solid ${C.navy}25`, borderLeft: `5px solid ${C.navy}`, borderRadius: 8, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 22 }}>🎯</span>
            <p style={{ color: C.navy, fontWeight: 800, fontSize: 21, margin: 0, letterSpacing: "-0.01em", flex: 1 }}>This Week: One Thing to Try</p>
            <span style={{ color: C.midGray, fontSize: 13 }}>{metaLabel}</span>
          </div>
          <p style={{ color: "#2a2a2a", fontSize: 16, lineHeight: 1.85, margin: 0 }}>{data.thisWeekAction}</p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const isMob = useIsMobile();
  /* ── Responsive helpers ── */
  const px   = isMob ? "16px" : "40px";          // horizontal page padding
  const hpx  = isMob ? "16px 16px 20px" : "24px 40px 22px"; // header padding
  const cpx  = isMob ? "16px 16px 24px" : "36px 40px 40px"; // content padding
  const cols = (n) => isMob ? "1fr" : `repeat(${n},1fr)`;   // grid collapse
  const cols2 = isMob ? "1fr" : "1fr 1fr";
  const card  = isMob ? "16px" : "20px 24px";    // card internal padding

  const [tab, setTab]               = useState("overview");
  const [raw, setRaw]               = useState([]);
  const [crossTraining, setCrossTraining] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [vo2MaxData, setVo2MaxData] = useState([]);
  const [afpMode, setAfpMode] = useState('gap');
  const [patView, setPatView] = useState('dow');
  const [econView, setEconView] = useState('rolling');
  const [longRunView, setLongRunView] = useState('chart');
  const [selectedRun, setSelectedRun] = useState(null);
  const [runSort, setRunSort]         = useState({ key:"date", dir:"desc" });
  const [runFilter, setRunFilter]     = useState("");
  const [debugLog, setDebugLog]     = useState([]);
  const [showDebug, setShowDebug]   = useState(false);
  // ── Global HR color helper (used by Long Run Splits + Raw Stats) ──
  const hrColor = (hr) => {
    if (!hr) return C.midGray;
    return hr > 165 ? C.red : hr > 150 ? C.amber : C.green;
  };

  const addDebug = (msg, type="info") => {
    const ts = new Date().toISOString().slice(11,23);
    setDebugLog(prev => [...prev, { ts, msg, type }]);
  };

  const fetchData = useCallback((isRefresh=false) => {
    if (!isRefresh) setLoading(true); else setRefreshing(true);
    setError(null);
    const url = "/health_workouts_enhanced.json?t="+Date.now();
    addDebug(`Fetching: ${url}`);
    addDebug(`UA: ${navigator.userAgent.slice(0,80)}`);
    addDebug(`Location: ${window.location.href}`);
    fetch(url)
      .then(r => {
        addDebug(`Response: HTTP ${r.status} ${r.statusText}`, r.ok ? "info" : "error");
        addDebug(`Content-Type: ${r.headers.get("content-type")}`, "info");
        if (!r.ok) throw new Error(`HTTP ${r.status} — JSON not found. Is it in /public?`);
        return r.json();
      })
      .then(json => {
        const workoutCount = json?.workouts?.length ?? 0;
        addDebug(`JSON parsed OK. workouts: ${workoutCount}`, workoutCount > 0 ? "ok" : "warn");
        if (workoutCount === 0) addDebug("⚠️ workouts array is empty or missing — check JSON structure", "warn");
        const transformed = transformAppleHealthData(json, addDebug);
        addDebug(`Transformed runs: ${transformed.length}`, transformed.length > 0 ? "ok" : "warn");
        if (transformed.length === 0 && workoutCount > 0) addDebug("⚠️ Workouts present but none transformed — activity type filter may be dropping them all", "warn");
        setRaw(transformed);
        setCrossTraining(transformAppleHealthData._crossTraining || []);
        setVo2MaxData(extractVO2MaxData(json));
        setLastUpdated(new Date().toISOString());
      })
      .catch(e => {
        addDebug(`FETCH ERROR: ${e.message}`, "error");
        setError(e.message);
        setRaw([]);
      })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);
  
  useEffect(() => { fetchData(); }, [fetchData]);

  const TODAY       = useMemo(() => new Date(), []);
  const daysToRace  = Math.ceil((RACE_DATE - TODAY) / 864e5);
  const weeksToRace = Math.floor(daysToRace / 7);
  
  const totalTrainingDays = Math.ceil((RACE_DATE - TRAINING_START) / 864e5);
  const daysElapsed = Math.ceil((TODAY - TRAINING_START) / 864e5);
  const percentToRace = Math.min(100, Math.max(0, Math.round((daysElapsed / totalTrainingDays) * 100)));

  const runs   = raw.filter(d => d.type==="Run" || d.type==="Indoor Run");
  const withHR = runs.filter(d => d.avgHR && d.avgHR > 0 && d.paceSec && d.paceSec > 0);
  const weekly = useMemo(() => {
    const base = buildWeekly(raw);
    return base.map((w, i) => {
      const prev = i > 0 ? base[i-1].miles : null;
      const pctChange = prev != null && prev > 0 ? +((w.miles - prev) / prev * 100).toFixed(0) : null;
      return { ...w, pctChange };
    });
  }, [raw]);

  const thirtyDaysAgo = new Date(TODAY);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const last30DaysRuns = runs.filter(d => new Date(d.date + "T12:00:00") >= thirtyDaysAgo);
  const last30DaysWithHR = last30DaysRuns.filter(d => d.avgHR && d.paceSec);

  const totalMi30     = last30DaysRuns.length ? +kmToMi(last30DaysRuns.reduce((s,a) => s+a.dist, 0)).toFixed(1) : 0;
  const totalFt30     = mToFt(last30DaysRuns.reduce((s,a) => s+a.elev, 0));
  const runsWPace30   = last30DaysRuns.filter(d => d.paceSec);
  const avgPaceSec30  = runsWPace30.length ? runsWPace30.reduce((s,d) => s+d.paceSec, 0)/runsWPace30.length : 0;
  const avgPaceFmt30  = avgPaceSec30>0 ? `${Math.floor(avgPaceSec30/60)}:${String(Math.round(avgPaceSec30%60)).padStart(2,"0")}` : "N/A";
  const avgHRAll30    = last30DaysWithHR.length ? +(last30DaysWithHR.reduce((s,d) => s+d.avgHR, 0)/last30DaysWithHR.length).toFixed(0) : 0;
  const longestRun30  = last30DaysRuns.length ? last30DaysRuns.reduce((a,b) => a.dist>b.dist ? a : b) : null;
  const longestMi30   = longestRun30 ? +kmToMi(longestRun30.dist).toFixed(2) : 0;
  const longestDate30 = longestRun30 ? fmtDate(longestRun30.date) : "—";

  const totalMi     = runs.length ? +kmToMi(runs.reduce((s,a) => s+a.dist, 0)).toFixed(1) : 0;
  const totalFt     = mToFt(runs.reduce((s,a) => s+a.elev, 0));

  const lastRunDate    = runs.length ? runs.map(d=>d.date).sort().pop() : TODAY.toISOString().slice(0,10);
  const thisWeekMon    = getMondayOf(lastRunDate);
  const thisWeekRuns   = runs.filter(d => getMondayOf(d.date)===thisWeekMon);
  const thisWeekMi     = +kmToMi(thisWeekRuns.reduce((s,a) => s+a.dist, 0)).toFixed(1);
  const firstRunDate   = runs.length ? runs.map(d=>d.date).sort()[0] : null;

  const thisWeekStart  = new Date(thisWeekMon+"T00:00:00");
  const thisWeekEnd    = new Date(thisWeekStart); thisWeekEnd.setDate(thisWeekStart.getDate()+6);
  const weekInProgress = TODAY < thisWeekEnd;
  const daysSoFar      = Math.max(1, Math.ceil((TODAY - thisWeekStart) / 864e5));
  const projectedMi    = weekInProgress ? +(thisWeekMi * 7 / daysSoFar).toFixed(1) : thisWeekMi;

  const prevCompletedWeek  = weekly.length >= 2 ? weekly[weekly.length - 2] : null;
  const prevCompletedMiles = prevCompletedWeek?.miles ?? null;

  const thisWeekEndDisplay = new Date(thisWeekStart); thisWeekEndDisplay.setDate(thisWeekStart.getDate()+6);
  const thisWeekRange = `${fmtDate(thisWeekMon)} – ${fmtDate(thisWeekEndDisplay.toISOString().slice(0,10))}`;

  // Use workout ID in scatter to ensure uniqueness
  const scatter     = withHR.map(d => ({ 
    id: d.id,
    x: d.paceSec, 
    y: d.avgHR, 
    date: d.date, 
    pace: paceSecToLabel(d.paceSec), 
    dist: kmToMi(d.dist), 
    maxHR: d.maxHR 
  }));
  const regression  = linReg(scatter);
  
  const hrTimePts   = withHR.map((d,i) => ({ x:i, y:d.avgHR }));
  const hrTimeReg   = linReg(hrTimePts);
  
  const pacTimePts  = withHR.map((d,i) => ({ x:i, y:d.paceSec }));
  const paceTimeReg = linReg(pacTimePts);
  
  const hrOverTime  = withHR.map(d => ({ 
    date: d.displayTime || d.date.slice(5), 
    avgHR: d.avgHR, 
    maxHR: d.maxHR, 
    paceLabel: paceSecToLabel(d.paceSec) 
  }));
  
  const hrImproving   = hrTimeReg   && hrTimeReg.slope   < -0.3;
  const paceImproving = paceTimeReg && paceTimeReg.slope < -1;

  const effIdx = (ps,hr) => hr>0&&ps>0 ? 10000/(ps*hr/60) : null;
  const efficiencyOverTime = useMemo(() =>
    withHR.map(d => {
      const eff = effIdx(d.paceSec, d.avgHR);
      return eff!=null ? { 
        id: d.id,
        date: d.displayTime || d.date.slice(5), 
        efficiency: +eff.toFixed(3), 
        avgHR: d.avgHR,
        pace: paceSecToLabel(d.paceSec) 
      } : null;
    }).filter(Boolean), [withHR]);

  // True Effort™ efficiency: same calc but using weather+grade adjusted pace
  const gapEfficiencyOverTime = useMemo(() => {
    return withHR.map(d => {
      let adjPace = d.paceSec;
      if (d.elev && d.dist && d.dist > 0) {
        const ftPerMile = d.elev / kmToMi(d.dist);
        adjPace = d.paceSec / (1 + (ftPerMile / 100) * 0.07);
      }
      if (d.temperature != null && d.humidity != null) {
        const tempPenalty = d.temperature > 60 ? ((d.temperature - 60) / 5) * 0.01 : 0;
        const humPenalty  = d.humidity > 60 ? ((d.humidity - 60) / 10) * 0.005 : 0;
        adjPace = adjPace / (1 + tempPenalty + humPenalty);
      }
      const eff = effIdx(adjPace, d.avgHR);
      return eff!=null ? {
        id: d.id,
        date: d.displayTime || d.date.slice(5),
        efficiency: +eff.toFixed(3),
        avgHR: d.avgHR,
        pace: paceSecToLabel(adjPace),
      } : null;
    }).filter(Boolean);
  }, [withHR]);

  const effReg       = linReg(efficiencyOverTime.map((d,i) => ({ x:i, y:d.efficiency })));
  const gapEffReg    = linReg(gapEfficiencyOverTime.map((d,i) => ({ x:i, y:d.efficiency })));
  const effImproving = effReg && effReg.slope > 0.001;

  // Aggregated pace zones (broader categories)
  const paceZoneStats = useMemo(() => {
    const trimmedMean = arr => {
      if (!arr.length) return null;
      if (arr.length < 4) return +(arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(1);
      const sorted = [...arr].sort((a,b)=>a-b).slice(1,-1);
      return +(sorted.reduce((s,v)=>s+v,0)/sorted.length).toFixed(1);
    };
    const now = new Date(TODAY);
    const ms4w = 4*7*864e5, ms8w = 8*7*864e5;
    const recentCut = new Date(now.getTime() - ms4w);
    const priorCut  = new Date(now.getTime() - ms8w);
    const recentAll = withHR.filter(d => new Date(d.date+"T12:00:00") >= recentCut);
    const earlyAll  = withHR.filter(d => { const dt=new Date(d.date+"T12:00:00"); return dt>=priorCut && dt<recentCut; });

    // Define broader zones
    const broadZones = [
      { id: "sub9", label: "Sub 9:00",   min: 0,   max: 540 }, // up to 9:00
      { id: "9to10", label: "9:00–10:00", min: 540, max: 600 },
      { id: "10to11", label: "10:00–11:00", min: 600, max: 660 },
      { id: "11plus", label: "11:00+",   min: 660, max: 9999 },
    ];

    return broadZones.map(z => {
      const inZone = arr => arr.filter(d => d.paceSec && d.paceSec >= z.min && d.paceSec < z.max);
      const earlyR  = inZone(earlyAll);
      const recentR = inZone(recentAll);
      // Weighted average HR across runs in zone
      const eHR = earlyR.length ? earlyR.reduce((s, r) => s + r.avgHR, 0) / earlyR.length : null;
      const lHR = recentR.length ? recentR.reduce((s, r) => s + r.avgHR, 0) / recentR.length : null;
      return { 
        ...z, 
        earlyHR: eHR ? +eHR.toFixed(1) : null, 
        lateHR: lHR ? +lHR.toFixed(1) : null,
        delta: eHR && lHR ? +(lHR - eHR).toFixed(1) : null,
        earlyN: earlyR.length, 
        lateN: recentR.length 
      };
    });
  }, [withHR]);

  // GAP (Grade-Adjusted Pace) adjusted version of paceZoneStats
  // Removes elevation penalty AND accounts for heat/humidity stress
  const gapPaceZoneStats = useMemo(() => {
    const adjusted = withHR.map(r => {
      let adjPace = r.paceSec;
      // Elevation adjustment: +7% per 100 ft/mi
      if (r.elev && r.dist && r.dist > 0) {
        const ftPerMile = r.elev / kmToMi(r.dist);
        adjPace = r.paceSec / (1 + (ftPerMile / 100) * 0.07);
      }
      // Weather adjustment: heat & humidity inflate HR, making pace look slower
      // Apply reverse correction to pace so hot-day runs compare fairly
      if (r.temperature != null && r.humidity != null) {
        const tempF = r.temperature;
        const hum = r.humidity;
        // Heat index effect on pace: each 5°F above 60°F adds ~1% difficulty
        // Humidity > 60% adds additional ~0.5% per 10% humidity above 60%
        const tempPenalty = tempF > 60 ? ((tempF - 60) / 5) * 0.01 : 0;
        const humPenalty  = hum > 60 ? ((hum - 60) / 10) * 0.005 : 0;
        const totalPenalty = tempPenalty + humPenalty;
        // Normalize pace to neutral conditions (remove weather penalty)
        adjPace = adjPace / (1 + totalPenalty);
      }
      return { ...r, paceSec: adjPace };
    });
    const now = new Date(TODAY);
    const recentCut = new Date(now.getTime() - 4*7*864e5);
    const priorCut  = new Date(now.getTime() - 8*7*864e5);
    const recentAll = adjusted.filter(d => new Date(d.date+"T12:00:00") >= recentCut);
    const earlyAll  = adjusted.filter(d => { const dt=new Date(d.date+"T12:00:00"); return dt>=priorCut && dt<recentCut; });
    return [
      { id:"sub9",   label:"Sub 9:00",    min:0,   max:540  },
      { id:"9to10",  label:"9:00–10:00",  min:540, max:600  },
      { id:"10to11", label:"10:00–11:00", min:600, max:660  },
      { id:"11plus", label:"11:00+",      min:660, max:9999 },
    ].map(z => {
      const inZone = arr => arr.filter(d => d.paceSec >= z.min && d.paceSec < z.max);
      const earlyR = inZone(earlyAll), recentR = inZone(recentAll);
      const eHR = earlyR.length  ? earlyR.reduce((s,r)=>s+r.avgHR,0)/earlyR.length   : null;
      const lHR = recentR.length ? recentR.reduce((s,r)=>s+r.avgHR,0)/recentR.length : null;
      return { ...z, earlyHR:eHR?+eHR.toFixed(1):null, lateHR:lHR?+lHR.toFixed(1):null,
        delta:eHR&&lHR?+(lHR-eHR).toFixed(1):null, earlyN:earlyR.length, lateN:recentR.length };
    });
  }, [withHR]);

  const runsWithDuration = useMemo(() => runs.map(r => {
    const sec = r.movingTimeSec ?? (r.dist && r.paceSec ? r.dist * r.paceSec : null);
    return { ...r, durationMin: sec != null ? sec / 60 : null };
  }).filter(r => r.durationMin != null), [runs]);

  const longRunMiles = 8;
  const longRuns = useMemo(() => runsWithDuration
    .filter(r => kmToMi(r.dist) >= longRunMiles || r.durationMin >= 90)
    .map(r => {
      // Compute split-derived analytics
      const fullSplits = (r.splits || []).filter(s => s.distMiles != null && s.distMiles >= 0.85 && s.paceSec);
      const splitPaces = fullSplits.map(s => s.paceSec);
      const firstMilePace = splitPaces[0] ?? null;
      const lastMilePace = splitPaces[splitPaces.length - 1] ?? null;
      // Positive fade = slowed down (positive = sec/mi added = worse); negative = negative split
      const paceFadeSec = (firstMilePace != null && lastMilePace != null) ? +(lastMilePace - firstMilePace).toFixed(1) : null;
      // Split consistency: std deviation of split paces
      const splitConsistency = splitPaces.length >= 3 ? (() => {
        const mean = splitPaces.reduce((a,b) => a+b, 0) / splitPaces.length;
        const std = Math.sqrt(splitPaces.reduce((a,b) => a + Math.pow(b-mean,2), 0) / splitPaces.length);
        return +std.toFixed(1);
      })() : null;
      // HR drift: last mile HR - first mile HR (via splits)
      const splitHRs = (r.splits || []).filter(s => s.distMiles != null && s.distMiles >= 0.85 && s.avgHR);
      const hrDrift = splitHRs.length >= 2 ? +(splitHRs[splitHRs.length-1].avgHR - splitHRs[0].avgHR).toFixed(1) : null;
      return {
        id: r.id,
        date: r.date,
        miles: +kmToMi(r.dist).toFixed(2),
        durationMin: +r.durationMin.toFixed(0),
        paceSec: r.paceSec,
        paceLabel: paceSecToLabel(r.paceSec),
        avgHR: r.avgHR,
        isEasy: r.avgHR != null && r.avgHR < 152,
        splits: r.splits || [],
        paceFadeSec,
        splitConsistency,
        hrDrift,
        stravaId: r.stravaId,
      };
    })
    .sort((a,b) => a.date.localeCompare(b.date)), [runsWithDuration]);
  
  const longRunTrend = longRuns.length >= 2 ? linReg(longRuns.map((r,i) => ({ x: i, y: r.miles }))) : null;
  const goalMarathonPaceSec = 10 * 60 + 0;
  
  const longRunsWithEffort = useMemo(() => longRuns.map(r => ({
    ...r,
    isGoalPace: r.paceSec != null && r.paceSec >= goalMarathonPaceSec - 30 && r.paceSec <= goalMarathonPaceSec + 30,
  })), [longRuns, goalMarathonPaceSec]);
  
  const longRunChartData = useMemo(() => longRunTrend
    ? longRunsWithEffort.map((r, i) => ({ ...r, trend: longRunTrend.intercept + longRunTrend.slope * i }))
    : longRunsWithEffort.map(r => ({ ...r, trend: r.miles })),
  [longRunsWithEffort, longRunTrend]);

  const dailyLoad = useMemo(() => {
    const byDate = {};
    runsWithDuration.forEach(r => {
      const load = r.durationMin * (r.avgHR ? (r.avgHR / 150) : 1);
      if (!byDate[r.date]) byDate[r.date] = 0;
      byDate[r.date] += load;
    });
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b));
  }, [runsWithDuration]);

  const weeklyLoad = useMemo(() => {
    const map = {};
    dailyLoad.forEach(([date, load]) => {
      const mon = getMondayOf(date);
      if (!map[mon]) map[mon] = 0;
      map[mon] += load;
    });
    return Object.entries(map).sort(([a],[b]) => a.localeCompare(b)).map(([mon, load]) => ({
      monDate: mon,
      label: fmtDate(mon),
      load: +load.toFixed(0),
    }));
  }, [dailyLoad]);

  const acwr = useMemo(() => {
    if (weeklyLoad.length < 2) return null;
    const acute = weeklyLoad[weeklyLoad.length - 1].load;
    const prev4 = weeklyLoad.slice(-5, -1).map(w => w.load);
    const chronic = prev4.length ? prev4.reduce((a,b) => a + b, 0) / prev4.length : acute;
    const ratio = chronic > 0 ? acute / chronic : 0;
    let zone = "safe";
    if (ratio > 1.5) zone = "high";
    else if (ratio > 1.3) zone = "caution";
    else if (ratio < 0.8) zone = "low";
    return { ratio: +ratio.toFixed(2), acute: +acute.toFixed(0), chronic: +chronic.toFixed(0), zone };
  }, [weeklyLoad]);

  const acwrHistory = useMemo(() => {
    if (weeklyLoad.length < 4) return [];
    return weeklyLoad.slice(4).map((w, idx) => {
      const i = idx + 4;
      const acute = weeklyLoad[i].load;
      const prev4 = weeklyLoad.slice(i - 4, i).map(x => x.load);
      const chronic = prev4.reduce((a,b) => a + b, 0) / 4;
      const ratio = chronic > 0 ? acute / chronic : 0;
      let zone = "safe";
      if (ratio > 1.5) zone = "high"; else if (ratio > 1.3) zone = "caution";
      return { ...weeklyLoad[i], acwr: +ratio.toFixed(2), zone };
    });
  }, [weeklyLoad]);

  const trainingMonotony = useMemo(() => {
    if (!runs.length) return null;
    const dates = runs.map(r=>r.date).sort();
    const start = new Date(dates[0]+"T12:00:00");
    const end   = new Date(dates[dates.length-1]+"T12:00:00");
    const byDate = {};
    runs.forEach(r => { byDate[r.date] = (byDate[r.date]||0) + kmToMi(r.dist); });
    const allDays = [];
    const cur = new Date(start);
    while (cur <= end) {
      const key = cur.toISOString().slice(0,10);
      allDays.push(byDate[key] || 0);
      cur.setDate(cur.getDate()+1);
    }
    const mean = allDays.reduce((a,b)=>a+b,0)/allDays.length;
    const std  = Math.sqrt(allDays.reduce((a,b)=>a+Math.pow(b-mean,2),0)/allDays.length);
    const monotony = std > 0 ? +(mean/std).toFixed(2) : 0;
    const weeklyMonotony = [];
    for (let i = 6; i < allDays.length; i++) {
      const slice = allDays.slice(i-6, i+1);
      const wMean = slice.reduce((a,b)=>a+b,0)/7;
      const wStd  = Math.sqrt(slice.reduce((a,b)=>a+Math.pow(b-wMean,2),0)/7);
      const wKey  = new Date(start.getTime()+(i*864e5)).toISOString().slice(0,10);
      weeklyMonotony.push({ date: fmtDate(wKey), monotony: wStd>0 ? +(wMean/wStd).toFixed(2) : 0 });
    }
    return { monotony, mean: +mean.toFixed(2), std: +std.toFixed(2), weeklyMonotony };
  }, [runs]);

  const polarizedDistribution = useMemo(() => {
    const buckets = [
      { id: "easy",   label: "Easy (<152 bpm)",        min: 0,   max: 152, color: C.green },
      { id: "medium", label: "Medium (152–165 bpm)",   min: 152, max: 165, color: C.amber },
      { id: "hard",   label: "Hard (>165 bpm)",        min: 165, max: 400, color: C.red },
    ];
  
    const mins = buckets.map(b => ({ ...b, minutes: 0 }));
  
    runsWithDuration.forEach(r => {
      const splits = r.splits || [];
      const hasGoodSplits = splits.length >= 2 && splits.some(s => s.avgHR && s.movingTimeSec);
  
      if (hasGoodSplits) {
        splits.forEach(s => {
          if (s.avgHR && s.movingTimeSec) {
            const bucket = mins.find(b => s.avgHR >= b.min && s.avgHR < b.max);
            if (bucket) bucket.minutes += s.movingTimeSec / 60;
          }
        });
      } else if (r.avgHR != null) {
        const bucket = mins.find(b => r.avgHR >= b.min && r.avgHR < b.max);
        if (bucket) bucket.minutes += r.durationMin;
      }
    });
  
    const total = mins.reduce((s, b) => s + b.minutes, 0) || 1;
    return mins.map(b => ({
      ...b,
      minutes: +b.minutes.toFixed(0),
      pct: +(100 * b.minutes / total).toFixed(1),
    }));
  }, [runsWithDuration]);

  const weeklyPolarized = useMemo(() => {
    const buckets = [
      { id: "easy",   label: "Easy",     min: 0,   max: 152, color: C.green },
      { id: "medium", label: "Moderate", min: 152, max: 165, color: C.amber },
      { id: "hard",   label: "Hard",     min: 165, max: 400, color: C.red },
    ];
  
    const calc = (runsArr) => {
      const mins = buckets.map(b => ({ ...b, minutes: 0 }));
  
      runsArr.forEach(r => {
        const splits = r.splits || [];
        const hasGoodSplits = splits.length >= 2 && splits.some(s => s.avgHR && s.movingTimeSec);
  
        if (hasGoodSplits) {
          splits.forEach(s => {
            if (s.avgHR && s.movingTimeSec) {
              const bucket = mins.find(b => s.avgHR >= b.min && s.avgHR < b.max);
              if (bucket) bucket.minutes += s.movingTimeSec / 60;
            }
          });
        } else if (r.avgHR != null) {
          const durationMin = r.movingTimeSec
            ? r.movingTimeSec / 60
            : (r.dist && r.paceSec ? (r.dist * r.paceSec) / 60 : 0);
          const bucket = mins.find(b => r.avgHR >= b.min && r.avgHR < b.max);
          if (bucket) bucket.minutes += durationMin;
        }
      });
  
      const total = mins.reduce((s, b) => s + b.minutes, 0) || 1;
      return mins.map(b => ({
        ...b,
        minutes: +b.minutes.toFixed(0),
        pct: +(100 * b.minutes / total).toFixed(1),
      }));
    };
  
    const prevMonDate = prevCompletedWeek?.monDate;
    const prevWeekRuns = prevMonDate ? runs.filter(r => getMondayOf(r.date) === prevMonDate) : [];
  
    return {
      current: calc(thisWeekRuns),
      prior:   calc(prevWeekRuns),
    };
  }, [thisWeekRuns, prevCompletedWeek, runs]);

  const criticalPaceData = useMemo(() => {
    const withPace = runs.filter(r => r.paceSec && r.dist).map(r => ({ ...r, miles:kmToMi(r.dist) }));
    const recent = withPace.slice(-25);
    const sp = arr => [...arr].sort((a,b)=>a.paceSec-b.paceSec);
    const best10K   = sp(recent.filter(r=>r.miles>=5.5&&r.miles<=7))[0];
    const bestTempo = sp(recent.filter(r=>r.miles>=3&&r.miles<=5))[0];
    // Best mile: scan individual mile splits from Strava (most accurate source)
    // across the most recent 25 runs' splits, then fall back to 0.9–1.4 mi whole runs
    const bestMileSec = (() => {
      let fastest = null;
      recent.forEach(r => {
        (r.splits || []).forEach(s => {
          if (s.paceSec && s.distMiles != null && s.distMiles >= 0.9 && s.distMiles <= 1.15) {
            if (fastest === null || s.paceSec < fastest) fastest = s.paceSec;
          }
        });
      });
      // Fall back to whole-run 1-mile efforts if no split data available
      if (fastest === null) {
        const wholeRun = sp(recent.filter(r=>r.miles>=0.9&&r.miles<=1.4))[0];
        fastest = wholeRun ? wholeRun.paceSec : null;
      }
      return fastest;
    })();
    const bestMile  = sp(recent.filter(r=>r.miles>=0.9&&r.miles<=1.4))[0];
    const bestHM    = sp(recent.filter(r=>r.miles>=11&&r.miles<=14))[0];
    const bestLong  = sp(recent.filter(r=>r.miles>=14))[0];
    // Riegel: T2 = T1*(D2/D1)^1.06
    const riegelPace = (pace, from, to) => pace ? pace * Math.pow(to/from, 1.06-1) * (to/from) / (to/from) : null;
    // Actually: predPaceSec = (pace * from)*(to/from)^1.06 / to
    const predMarathonPace = (pace, fromMi) => {
      if (!pace) return null;
      const MARATHON = 26.219;
      return (pace * fromMi) * Math.pow(MARATHON/fromMi, 1.06) / MARATHON;
    };
    let marathonPredSec = null, predSource = null;
    if (bestLong) { marathonPredSec = predMarathonPace(bestLong.paceSec, bestLong.miles); predSource = `${bestLong.miles.toFixed(1)} mi run`; }
    else if (bestHM) { marathonPredSec = predMarathonPace(bestHM.paceSec, 13.11); predSource = "half-marathon effort"; }
    else if (best10K) { marathonPredSec = predMarathonPace(best10K.paceSec, 6.2); predSource = "10K effort"; }
    else if (bestTempo) { marathonPredSec = predMarathonPace(bestTempo.paceSec, 4); predSource = "tempo run"; }
    const fmtFinish = sec => {
      if (!sec) return null;
      const t = Math.round(sec * 26.219);
      return `${Math.floor(t/3600)}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
    };
    const easyLo = best10K ? paceSecToLabel(Math.round(best10K.paceSec*1.35)) : null;
    const easyHi = best10K ? paceSecToLabel(Math.round(best10K.paceSec*1.25)) : null;
    const tempo  = best10K ? paceSecToLabel(Math.round(best10K.paceSec*1.08)) : null;
    const mp     = marathonPredSec ? paceSecToLabel(Math.round(marathonPredSec)) : null;
    return {
      best10KPace:   best10K   ? paceSecToLabel(best10K.paceSec)   : null,
      bestTempoPace: bestTempo ? paceSecToLabel(bestTempo.paceSec) : null,
      bestMilePace:  bestMileSec != null ? paceSecToLabel(Math.round(bestMileSec)) : null,
      bestHMPace:    bestHM    ? paceSecToLabel(bestHM.paceSec)    : null,
      bestLongPace:  bestLong  ? paceSecToLabel(bestLong.paceSec)  : null,
      marathonPred:  marathonPredSec ? paceSecToLabel(Math.round(marathonPredSec)) : null,
      marathonFinish: fmtFinish(marathonPredSec),
      predSource,
      easyZoneLow:easyLo, easyZoneHigh:easyHi, tempoZone:tempo, mpZone:mp,
    };
  }, [runs]);

  const longRuns90Min = useMemo(() => runsWithDuration
    .filter(r => r.durationMin >= 90 && r.avgHR != null)
    .map(r => ({
      date: r.date,
      durationMin: Math.round(r.durationMin),
      miles: +kmToMi(r.dist).toFixed(1),
      avgHR: Math.round(r.avgHR),
    })),
  [runsWithDuration]);

  const trainingSummary = useMemo(() => {
    if (!runs.length) return null;
    return summarizeTrainingData(runs, {
      acwr, weeklyPolarized, weeksToRace, effReg, longRuns,
      avgHR: avgHRAll30, thisWeekMi, thisWeekRuns,
      avgPaceFmt30, totalMi, trainingMonotony, runs,
      weekly, longRunTrend, hrTimeReg, firstRunDate,
      criticalPaceData, longRuns90Min, acwrHistory, crossTraining,
    });
  }, [runs, acwr, weeklyPolarized, weeksToRace, effReg, longRuns,
     avgHRAll30, thisWeekMi, thisWeekRuns, avgPaceFmt30, totalMi,
     trainingMonotony, weekly, longRunTrend, hrTimeReg, firstRunDate,
     criticalPaceData, longRuns90Min, acwrHistory, crossTraining]);

  const cumulativeLoadChart = useMemo(() => {
    return weeklyLoad.map((w, i) => {
      const slice = weeklyLoad.slice(Math.max(0, i-3), i+1);
      const avg = slice.reduce((s,x)=>s+x.load,0)/slice.length;
      const prev = weeklyLoad[i-1]?.load ?? 0;
      return { ...w, rolling4:+avg.toFixed(0), spike: prev>0 && w.load>prev*1.5 };
    });
  }, [weeklyLoad]);

  const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const dowStats = useMemo(() => {
    const buckets = DAYS.map(d => ({ day:d, runs:0, miles:0, totalHR:0, hrRuns:0 }));
    runs.forEach(r => {
      const d = new Date(r.date+"T12:00:00");
      const dow = (d.getDay()+6)%7;
      buckets[dow].runs++;
      buckets[dow].miles += kmToMi(r.dist);
      if (r.avgHR) { buckets[dow].totalHR += r.avgHR; buckets[dow].hrRuns++; }
    });
    return buckets.map(b => ({
      day: b.day,
      runs: b.runs,
      miles: +b.miles.toFixed(1),
      avgMiles: b.runs > 0 ? +(b.miles/b.runs).toFixed(1) : 0,
      avgHR: b.hrRuns > 0 ? Math.round(b.totalHR/b.hrRuns) : null,
    }));
  }, [runs]);

  // Running Efficiency data: numbers are 3-week rolling averages to reduce noise
  const efficiencyMetrics = useMemo(() => {
    const withData = runs
      .filter(r => r.avgCadence || r.avgGroundContactTime || r.avgVerticalOscillation || r.avgStrideLength)
      .sort((a,b) => a.date.localeCompare(b.date));
    if (!withData.length) return null;
    const THREE_WEEKS = 21 * 24 * 3600 * 1000;
    const rollAvg = (arr, field) => arr.map(r => {
      if (!r[field]) return null;
      const t = new Date(r.date+'T12:00:00').getTime();
      const window = arr.filter(x => x[field] && new Date(x.date+'T12:00:00').getTime() >= t - THREE_WEEKS && new Date(x.date+'T12:00:00').getTime() <= t);
      return window.length ? window.reduce((s,x) => s+x[field], 0) / window.length : null;
    });
    const rCad  = rollAvg(withData, 'avgCadence');
    const rGCT  = rollAvg(withData, 'avgGroundContactTime');
    const rVO   = rollAvg(withData, 'avgVerticalOscillation');
    const rStr  = rollAvg(withData, 'avgStrideLength');
    const lastVal = arr => { for (let i=arr.length-1;i>=0;i--) if(arr[i]!=null) return arr[i]; return null; };
    const trendCadence = linReg(withData.filter(r=>r.avgCadence).map((r,i)=>({x:i,y:r.avgCadence})));
    const trendGCT = linReg(withData.filter(r=>r.avgGroundContactTime).map((r,i)=>({x:i,y:r.avgGroundContactTime})));
    const trendVO = linReg(withData.filter(r=>r.avgVerticalOscillation).map((r,i)=>({x:i,y:r.avgVerticalOscillation})));
    const trendStride = linReg(withData.filter(r=>r.avgStrideLength).map((r,i)=>({x:i,y:r.avgStrideLength})));
    const lc = lastVal(rCad), lg = lastVal(rGCT), lv = lastVal(rVO), ls = lastVal(rStr);
    return {
      avgCadence: lc ? Math.round(lc) : null,
      avgGCT:     lg ? +lg.toFixed(1) : null,
      avgVO:      lv ? +lv.toFixed(2) : null,
      avgStride:  ls ? +ls.toFixed(2) : null,
      trendCadence, trendGCT, trendVO, trendStride,
      data: withData.map((r,i) => ({
        date: r.displayTime || r.date.slice(5),
        cadence: rCad[i]!=null ? +rCad[i].toFixed(1) : null,
        gct:     rGCT[i]!=null ? +rGCT[i].toFixed(1) : null,
        vo:      rVO[i]!=null  ? +rVO[i].toFixed(2)  : null,
        stride:  rStr[i]!=null ? +rStr[i].toFixed(2) : null,
      })),
      rawData: withData.map(r => ({
        date: r.displayTime || r.date.slice(5),
        cadence: r.avgCadence ? +r.avgCadence.toFixed(1) : null,
        gct:     r.avgGroundContactTime ? +r.avgGroundContactTime.toFixed(1) : null,
        vo:      r.avgVerticalOscillation ? +r.avgVerticalOscillation.toFixed(2) : null,
        stride:  r.avgStrideLength ? +r.avgStrideLength.toFixed(2) : null,
      })),
    };
  }, [runs]);

  const powerData = useMemo(() => {
    const withPower = runs.filter(r => r.avgPower && r.avgPower > 0)
      .map(r => ({
        date: r.displayTime || r.date.slice(5),
        power: r.avgPower,
        paceSec: r.paceSec,
        avgHR: r.avgHR,
        miles: +kmToMi(r.dist).toFixed(1),
      }));
    if (!withPower.length) return null;
    
    const powerVsHR = withPower.map(d => ({ x: d.avgHR, y: d.power, date: d.date }));
    const powerVsPace = withPower.map(d => ({ x: d.paceSec, y: d.power, date: d.date }));
    const powerRegHR = linReg(powerVsHR);
    const powerRegPace = linReg(powerVsPace);
    
    return {
      data: withPower,
      powerVsHR,
      powerVsPace,
      powerRegHR,
      powerRegPace,
      avgPower: Math.round(withPower.reduce((s,d) => s + d.power, 0) / withPower.length),
      maxPower: Math.round(Math.max(...withPower.map(d => d.power))),
      minPower: Math.round(Math.min(...withPower.map(d => d.power))),
    };
  }, [runs]);

  const timeOfDayStats = useMemo(() => {
    const slots = [
      { id:"morning",      label:"Morning",      hours:"Before 11am", runs:[], color:C.bofaBlue },
      { id:"late-morning", label:"Late Morning",  hours:"11am–noon",   runs:[], color:C.navy },
      { id:"midday",       label:"Midday",        hours:"Noon–3pm",    runs:[], color:C.amber },
      { id:"afternoon",    label:"Afternoon",     hours:"3–6pm",       runs:[], color:C.green },
      { id:"evening",      label:"Evening",       hours:"After 6pm",   runs:[], color:C.darkRed },
    ];
    runs.forEach(r => {
      const slot = slots.find(s => s.id === r.timeOfDay);
      if (slot) slot.runs.push(r);
    });
    return slots.filter(s => s.runs.length > 0).map(s => {
      const withHRs = s.runs.filter(r => r.avgHR);
      const withPace = s.runs.filter(r => r.paceSec);
      return {
        ...s,
        count: s.runs.length,
        totalMiles: +s.runs.reduce((t,r)=>t+kmToMi(r.dist),0).toFixed(1),
        avgMiles: +(s.runs.reduce((t,r)=>t+kmToMi(r.dist),0)/s.runs.length).toFixed(1),
        avgHR: withHRs.length ? Math.round(withHRs.reduce((t,r)=>t+r.avgHR,0)/withHRs.length) : null,
        avgPaceSec: withPace.length ? withPace.reduce((t,r)=>t+r.paceSec,0)/withPace.length : null,
      };
    });
  }, [runs]);

  const WeekTip = ({ active, payload }) => {
    if (!active||!payload?.length) return null;
    const w = payload[0].payload;
    const isCurrent = w.monDate === thisWeekMon;
    return (
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderLeft:`4px solid ${w.miles>30?C.red:w.miles>20?C.navy:"#A0AECF"}`, borderRadius:8, padding:"14px 18px", boxShadow:"0 6px 24px rgba(1,33,105,0.13)", fontFamily:F, minWidth:200 }}>
        <p style={{ color:C.navy, fontWeight:800, fontSize:15, margin:"0 0 10px", paddingBottom:8, borderBottom:`1px solid ${C.border}` }}>
          {w.fullRange}{isCurrent && weekInProgress ? <span style={{ marginLeft:8, fontSize:12, color:C.amber, fontWeight:600 }}>In progress</span> : ""}
        </p>
        <Row label="Miles"     value={`${w.miles} mi`}             bold color={w.miles>30?C.red:C.navy} />
        {w.pctChange != null && <Row label="vs prior week" value={`${w.pctChange > 0 ? "+" : ""}${w.pctChange}%`} color={Math.abs(w.pctChange) > 15 ? C.amber : C.green} />}
        <Row label="Runs"      value={w.runs}                       />
        <Row label="Elevation" value={`${w.elev.toLocaleString()} ft`} />
        {isCurrent && weekInProgress && projectedMi !== w.miles &&
          <Row label="Projected total" value={`~${projectedMi} mi`} color={C.amber} />}
      </div>
    );
  };

  const ScatterTip = ({ active, payload }) => {
    if (!active||!payload?.length) return null;
    const d = payload[0].payload;
    const eff = effIdx(d.x, d.y);
    return (
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 18px", boxShadow:"0 6px 24px rgba(1,33,105,0.13)", fontFamily:F, minWidth:200 }}>
        <p style={{ color:C.navy, fontWeight:800, fontSize:15, margin:"0 0 10px", paddingBottom:8, borderBottom:`1px solid ${C.border}` }}>{d.date}</p>
        <Row label="Pace"          value={`${d.pace} /mi`}         bold color={C.red}  />
        <Row label="Avg HR"        value={`${d.y} bpm`}            bold color={C.navy} />
        {d.maxHR && <Row label="Max HR" value={`${d.maxHR} bpm`}  color={C.amber} />}
        <Row label="Distance"      value={`${d.dist} mi`}          />
        {eff && <Row label="Efficiency index" value={eff.toFixed(2)} color={C.green} />}
      </div>
    );
  };

  const PowerScatterTip = ({ active, payload }) => {
    if (!active||!payload?.length) return null;
    const d = payload[0].payload;
    const xType = d.xType || 'hr';
    return (
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 18px", boxShadow:"0 6px 24px rgba(1,33,105,0.13)", fontFamily:F, minWidth:200 }}>
        <p style={{ color:C.navy, fontWeight:800, fontSize:15, margin:"0 0 10px", paddingBottom:8, borderBottom:`1px solid ${C.border}` }}>{d.date}</p>
        <Row label="Power" value={`${d.y} W`} bold color={C.red} />
        <Row label="vs" value={xType === 'hr' ? `${d.x} bpm` : paceSecToLabel(d.x)} />
      </div>
    );
  };

  const TABS = [
    { id:"overview", label:"Training Overview" },
    { id:"report",   label:"Coach's Report"    },
    { id:"rawstats", label:"Run Details"         },
  ];

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.offWhite, fontFamily:F }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:44, height:44, border:`3px solid ${C.light}`, borderTopColor:C.red, borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <p style={{ color:C.midGray, fontSize:17, margin:0 }}>Loading training data from Apple Health…</p>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.offWhite, fontFamily:F, padding:24 }}>
      <div style={{ maxWidth:440, textAlign:"center" }}>
        <p style={{ color:C.darkGray, fontSize:21, fontWeight:700, margin:"0 0 12px" }}>Unable to load data</p>
        <p style={{ color:C.midGray, fontSize:16, margin:"0 0 16px", lineHeight:1.6 }}>{error}</p>
        <p style={{ color:C.midGray, fontSize:15 }}>Make sure <code style={{ background:C.light, padding:"2px 8px", borderRadius:4 }}>health_workouts_enhanced.json</code> is in the <code style={{ background:C.light, padding:"2px 8px", borderRadius:4 }}>/public</code> folder and refresh.</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.offWhite, fontFamily:F, color:C.darkGray, fontSize: isMob ? 14 : 15, overflowX:"hidden" }}>

      {/* ── Debug overlay ── tap the button to expand, shows fetch + parse log */}
      <div style={{ position:"fixed", bottom:16, right:16, zIndex:9999 }}>
        <button
          onClick={() => setShowDebug(d => !d)}
          style={{
            background: debugLog.some(l=>l.type==="error") ? C.red : debugLog.some(l=>l.type==="warn") ? C.amber : C.navy,
            color: C.white, border:"none", borderRadius:8, padding:"8px 14px",
            fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F,
            boxShadow:"0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          {showDebug ? "Hide Debug" : `🔍 Debug ${debugLog.some(l=>l.type==="error")?"❌":debugLog.some(l=>l.type==="warn")?"⚠️":"✓"}`}
        </button>
        {showDebug && (
          <div style={{
            position:"absolute", bottom:44, right:0, width: isMob ? "calc(100vw - 32px)" : 480,
            background:"#0d1117", border:"1px solid #30363d", borderRadius:10,
            padding:"14px 16px", boxShadow:"0 8px 32px rgba(0,0,0,0.5)",
            maxHeight:"60vh", overflowY:"auto",
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, borderBottom:"1px solid #30363d", paddingBottom:8 }}>
              <p style={{ color:"#e6edf3", fontSize:13, fontWeight:700, margin:0 }}>Fetch Debug Log</p>
              <div style={{ display:"flex", gap:8 }}>
                <span style={{ color:"#8b949e", fontSize:11 }}>runs: {raw.length} | cross-training: {crossTraining.length}</span>
                <button onClick={() => { setDebugLog([]); fetchData(true); }}
                  style={{ background:"#21262d", color:"#58a6ff", border:"1px solid #30363d", borderRadius:4, padding:"2px 8px", fontSize:11, cursor:"pointer", fontFamily:F }}>
                  Retry
                </button>
              </div>
            </div>
            {debugLog.length === 0
              ? <p style={{ color:"#8b949e", fontSize:12, margin:0 }}>No log entries yet.</p>
              : debugLog.map((l, i) => (
                <div key={i} style={{ display:"flex", gap:8, marginBottom:4, alignItems:"flex-start" }}>
                  <span style={{ color:"#8b949e", fontSize:10, flexShrink:0, marginTop:2 }}>{l.ts}</span>
                  <span style={{
                    fontSize:12, lineHeight:1.5, wordBreak:"break-all",
                    color: l.type==="error" ? "#ff7b72" : l.type==="warn" ? "#e3b341" : l.type==="ok" ? "#3fb950" : "#e6edf3",
                  }}>{l.msg}</span>
                </div>
              ))
            }
          </div>
        )}
      </div>
      <header style={{ position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0 }}>
          <img src={CHICAGO_BG} alt="Chicago skyline" style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"center 30%" }} />
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(105deg,rgba(1,33,105,0.95) 0%,rgba(1,33,105,0.88) 38%,rgba(1,33,105,0.48) 68%,rgba(0,0,0,0.1) 100%)" }} />
        </div>
        <div style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none" }}>
          <div style={{ position:"absolute", top:-80, right:-60, width:300, height:300, background:C.red, transform:"rotate(-12deg)", opacity:0.9 }} />
          <div style={{ position:"absolute", top:-40, right:80,  width:190, height:190, background:C.navy, transform:"rotate(-8deg)", opacity:0.82 }} />
        </div>

        <div style={{ position:"relative", zIndex:1, maxWidth:980, margin:"0 auto", padding:hpx }}>
          <div style={{ display:"flex", alignItems: isMob ? "flex-start" : "center", justifyContent:"space-between", flexDirection: isMob ? "column" : "row", gap: isMob ? 16 : 24, marginBottom:20 }}>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:20, marginBottom:12 }}>
                <img
                  src={CHI_LOGO_SVG}
                  alt="Chicago Marathon"
                  style={{ height: isMob ? 32 : 42, objectFit:"contain", filter:"brightness(0) invert(1)", opacity:0.95 }}
                  onError={e => e.currentTarget.style.display="none"}
                />
              </div>
              <h1 style={{ color:C.white, fontSize: isMob ? 22 : 33, fontWeight:800, margin:0, letterSpacing:"-0.03em", lineHeight:1.1 }}>
                John Knapp <span style={{ color:C.red }}>·</span> Chicago Marathon Training
              </h1>
            </div>

            <div style={{ flexShrink:0, width: isMob ? "100%" : "auto" }}>
              <div style={{ 
                background:"rgba(255,255,255,0.08)", 
                backdropFilter:"blur(12px)",
                borderRadius:12, 
                padding: isMob ? "12px 16px" : "14px 22px",
                border:"1px solid rgba(255,255,255,0.15)",
                boxShadow:"0 8px 24px rgba(0,0,0,0.2)",
                display:"flex",
                alignItems:"center",
                gap: isMob ? 16 : 24
              }}>
                <div style={{ textAlign:"center", minWidth: isMob ? 60 : 80 }}>
                  <p style={{ color:"rgba(255,255,255,0.6)", fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", margin:"0 0 4px", fontWeight:600 }}>Countdown</p>
                  <p style={{ color:C.white, fontSize: isMob ? 26 : 33, fontWeight:900, margin:0, lineHeight:1 }}>{daysToRace}</p>
                  <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:"2px 0 0" }}>days</p>
                  <p style={{ color:"rgba(255,255,255,0.4)", fontSize:10, margin:"4px 0 0", letterSpacing:"0.04em" }}>
                    {TODAY.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                  </p>
                </div>
                <div style={{ width:1, height:30, background:"rgba(255,255,255,0.2)" }} />
                <div style={{ flex:1 }}>
                  <p style={{ color:"rgba(255,255,255,0.7)", fontSize: isMob ? 13 : 14, margin:"0 0 4px", fontWeight:500 }}>October 11, 2026</p>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ flex:1, height:4, background:"rgba(255,255,255,0.2)", borderRadius:2, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${percentToRace}%`, background:C.red, borderRadius:2 }} />
                    </div>
                    <span style={{ color:C.white, fontSize:13, fontWeight:600 }}>{percentToRace}%</span>
                  </div>
                  <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:"4px 0 0" }}>{weeksToRace} weeks to go</p>
                </div>
              </div>
            </div>
          </div>

          {(() => {
            const allTimeBestMile = (() => {
              // Scan per-mile Strava splits first (most accurate — actual mile efforts)
              let bestSec = null, bestDate = null;
              runs.forEach(r => {
                (r.splits || []).forEach(s => {
                  if (s.paceSec && s.distMiles != null && s.distMiles >= 0.9 && s.distMiles <= 1.15) {
                    if (bestSec === null || s.paceSec < bestSec) {
                      bestSec = s.paceSec;
                      bestDate = r.date;
                    }
                  }
                });
              });
              if (bestSec !== null) return { sec: bestSec, date: bestDate };
              // Fall back to whole runs ~1 mile
              const paceRuns = runs.filter(r=>r.paceSec && kmToMi(r.dist)>=0.9);
              if (!paceRuns.length) return null;
              const best = paceRuns.reduce((b,r)=>r.paceSec < b.paceSec ? r : b);
              return { sec: best.paceSec, date: best.date };
            })();
            const longestRunAllTime = runs.length ? runs.reduce((a,b)=>a.dist>b.dist?a:b) : null;
            // Peak HR: use actual maxHR (from HKQuantityTypeIdentifierHeartRate maximum field) if available, else fall back to best avgHR
            const runsWithMaxHR = runs.filter(r => r.maxHR && r.maxHR > 100);
            const hasRealMaxHR = runsWithMaxHR.length > 0;
            const peakHRRun = hasRealMaxHR
              ? runsWithMaxHR.reduce((best,r) => r.maxHR > best.maxHR ? r : best)
              : runs.filter(r=>r.avgHR).reduce((best,r)=>(!best||r.avgHR>best.avgHR)?r:best, null);
            const peakHR = peakHRRun ? Math.round(hasRealMaxHR ? peakHRRun.maxHR : peakHRRun.avgHR) : null;
            const peakHRDate = peakHRRun ? fmtDate(peakHRRun.date) : null;
            const peakHRLabel = hasRealMaxHR ? "Max HR" : "Avg HR";
            const peakHRSub = peakHRDate ? peakHRDate : "all-time high";
            const totalTrainingMinutes = runs.reduce((s, r) => s + (r.movingTimeSec ? r.movingTimeSec / 60 : 0), 0);
            const totalHours = Math.floor(totalTrainingMinutes / 60);
            const heroStats = [
              { label: "Time on Feet", value: totalHours, unit: "hrs", sub: `${runs.length} runs · avg ${totalHours && runs.length ? Math.round(totalHours/runs.length*60) : "—"} min/run` },
              { label: "Total Miles", value: totalMi, unit: "mi", sub: `${runs.length} runs all-time` },
              { label: "Longest Run", value: longestRunAllTime ? +kmToMi(longestRunAllTime.dist).toFixed(1) : "—", unit: "mi", sub: longestRunAllTime ? fmtDate(longestRunAllTime.date) : "—" },
              { label: "Best Mile", value: allTimeBestMile ? paceSecToLabel(allTimeBestMile.sec) : "—", unit: "/mi", sub: allTimeBestMile ? fmtDate(allTimeBestMile.date) : "all-time fastest" },
              { label: peakHRLabel, value: peakHR ?? "—", unit: "bpm", sub: peakHRSub },
              { label: "Elevation", value: totalFt.toLocaleString(), unit: "ft", sub: "all-time climbing" },
            ];
            return (
              <div style={{ display:"grid", gridTemplateColumns: isMob ? "repeat(3,1fr)" : "repeat(6,1fr)", gap: isMob ? 8 : 12 }}>
                {heroStats.map(s => (
                  <div key={s.label} style={{ background:"rgba(255,255,255,0.12)", backdropFilter:"blur(12px)", borderRadius:8, padding:"12px 14px", border:"1px solid rgba(255,255,255,0.2)" }}>
                    <p style={{ color:"rgba(255,255,255,0.65)", fontSize:11, letterSpacing:"0.13em", textTransform:"uppercase", margin:"0 0 4px", fontWeight:600 }}>{s.label}</p>
                    <p style={{ color:C.white, fontSize:23, fontWeight:800, margin:"0 0 2px", letterSpacing:"-0.03em", lineHeight:1 }}>
                      {s.value}<span style={{ fontSize:13, fontWeight:400, color:"rgba(255,255,255,0.6)", marginLeft:3 }}>{s.unit}</span>
                    </p>
                    <p style={{ color:"rgba(255,255,255,0.45)", fontSize:12, margin:0 }}>{s.sub}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </header>

      <div style={{ background:C.white, borderBottom:`1px solid ${C.border}`, position:"sticky", top:0, zIndex:10, overflowX:"auto" }}>
        <div style={{ maxWidth:980, margin:"0 auto", padding:`0 ${px}`, display:"flex" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>{ setTab(t.id); setSelectedRun(null); }} style={{
              background:"none", border:"none",
              borderBottom: tab===t.id ? `3px solid ${C.red}` : "3px solid transparent",
              color:         tab===t.id ? C.navy : C.midGray,
              padding: isMob ? "14px 16px 11px" : "16px 28px 13px",
              fontSize: isMob ? 14 : 17,
              fontWeight:tab===t.id ? 700 : 500,
              cursor:"pointer", fontFamily:F, letterSpacing:"0.01em", whiteSpace:"nowrap",
              transition:"color 0.15s",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:980, margin:"0 auto", padding:cpx }}>
        {tab==="overview" && (
          <div>
            {/* ═══ WEEKLY SUMMARY ═══ */}
            <section style={{ marginBottom: isMob ? 32 : 48 }}>
              {(() => {
                const phaseLabel = weeksToRace > 20 ? "Base Building" : weeksToRace > 12 ? "Aerobic Development" : weeksToRace > 8 ? "Race-Specific" : "Taper";
                const wkNum = Math.max(1, Math.ceil((new Date() - new Date("2026-01-19")) / (7 * 864e5)));
                return <SecTitle title={`Weekly Summary · Wk ${wkNum} · ${phaseLabel} Phase`} color={C.navy} />;
              })()}
              {(() => {
                const weekElev = mToFt(thisWeekRuns.reduce((s,a)=>s+a.elev,0));
                const weekHRRuns = thisWeekRuns.filter(r=>r.avgHR);
                const weekAvgHR = weekHRRuns.length ? Math.round(weekHRRuns.reduce((s,r)=>s+r.avgHR,0)/weekHRRuns.length) : null;
                const hardestThisWeek = [...weekHRRuns].sort((a,b)=>b.avgHR-a.avgHR)[0];
                const weekPaceRuns = thisWeekRuns.filter(r=>r.paceSec);
                const weekAvgPaceSec = weekPaceRuns.length ? weekPaceRuns.reduce((s,r)=>s+r.paceSec,0)/weekPaceRuns.length : null;
                const weekAvgPace = weekAvgPaceSec ? paceSecToLabel(Math.round(weekAvgPaceSec)) : null;
                const last4 = weekly.slice(-4);
                const volumeTrend = last4.length>=2 ? linReg(last4.map((w,i)=>({x:i,y:w.miles}))) : null;
                const trendDir = volumeTrend ? (volumeTrend.slope>0.5?"↑ building":volumeTrend.slope<-0.5?"↓ tapering":"→ stable") : null;
                const effTrend = effReg ? (effReg.slope>0.001?"improving":"flat/declining") : null;
                const weekMiChange = prevCompletedMiles!=null ? +((thisWeekMi-prevCompletedMiles)).toFixed(1) : null;
                const weekMiChangePct = prevCompletedMiles!=null&&prevCompletedMiles>0 ? Math.round((thisWeekMi-prevCompletedMiles)/prevCompletedMiles*100) : null;
                const easyPctThisWeek = (() => {
                  let e=0,t=0;
                  thisWeekRuns.forEach(r=>{if(r.avgHR==null)return;const m=r.movingTimeSec?r.movingTimeSec/60:0;t+=m;if(r.avgHR<152)e+=m;});
                  return t>0?Math.round(e/t*100):null;
                })();
                return (
                  <div style={{ background:C.white, border:`1px solid ${C.border}`, borderLeft:`4px solid ${C.red}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                      <p style={{ color:C.navy, fontWeight:700, fontSize: isMob ? 16 : 19, margin:0 }}>
                        {weekInProgress ? "Week in Progress" : "Most Recent Week"} · {thisWeekRange}
                        {" "}<span style={{ color:C.midGray, fontWeight:400, fontSize:14 }}>
                          · {weeksToRace > 20 ? "Base Building" : weeksToRace > 12 ? "Aerobic Dev" : weeksToRace > 8 ? "Race-Specific" : "Taper"} Phase
                        </span>
                      </p>
                      {weekInProgress && <Badge label="Live" color={C.amber} />}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns: isMob ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10, marginBottom:18 }}>
                      {[
                        { label:"Miles", value:thisWeekMi, unit:"mi", sub:weekMiChangePct!=null?`${weekMiChangePct>0?"+":""}${weekMiChangePct}% vs last wk`:`${thisWeekRuns.length} runs`, color:weekMiChangePct!=null&&Math.abs(weekMiChangePct)>20?C.amber:C.navy },
                        { label:"Avg Pace", value:weekAvgPace??"—", unit:"/mi", sub:`${thisWeekRuns.length} runs`, color:C.navy },
                        { label:"Avg HR", value:weekAvgHR??"—", unit:"bpm", sub:hardestThisWeek?`peak ${Math.round(hardestThisWeek.avgHR)} bpm`:"no HR data", color:weekAvgHR>165?C.red:weekAvgHR>152?C.amber:C.green },
                        { label:"Elevation", value:weekElev.toLocaleString(), unit:"ft", sub:"total gain", color:C.navy },
                      ].map(s=>(
                        <div key={s.label} style={{ background:C.offWhite, borderRadius:6, padding:"11px 13px" }}>
                          <p style={{ color:C.midGray, fontSize:11, letterSpacing:"0.09em", textTransform:"uppercase", margin:"0 0 3px", fontWeight:600 }}>{s.label}</p>
                          <p style={{ color:s.color, fontSize:21, fontWeight:800, margin:"0 0 2px", lineHeight:1 }}>
                            {s.value}<span style={{ fontSize:12, fontWeight:400, color:C.midGray, marginLeft:2 }}>{s.unit}</span>
                          </p>
                          <p style={{ color:C.midGray, fontSize:12, margin:0 }}>{s.sub}</p>
                        </div>
                      ))}
                    </div>

                    <div style={{ borderTop:`1px solid ${C.light}`, paddingTop:14, marginBottom:18 }}>
                      <p style={{ color:C.midGray, fontSize:11, fontWeight:600, letterSpacing:"0.09em", textTransform:"uppercase", margin:"0 0 8px" }}>
                        Weekly Mileage · <span style={{ fontWeight:400 }}>hover for details</span>
                      </p>
                      <ResponsiveContainer width="100%" height={165}>
                        <BarChart data={weekly} barSize={26} margin={{ top:20, right:12, bottom:2, left:0 }}>
                          <defs>
                            <linearGradient id="gHigh" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={C.red} stopOpacity={1} />
                              <stop offset="100%" stopColor={C.darkRed} stopOpacity={0.88} />
                            </linearGradient>
                            <linearGradient id="gMid" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={C.navy} stopOpacity={1} />
                              <stop offset="100%" stopColor={C.navyMid} stopOpacity={0.88} />
                            </linearGradient>
                            <linearGradient id="gLow" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#8FA0C8" stopOpacity={1} />
                              <stop offset="100%" stopColor="#6B7FB8" stopOpacity={0.88} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                          <XAxis dataKey="label" tick={{ fill:C.midGray, fontSize:11, fontFamily:F }} axisLine={{ stroke:C.border }} tickLine={false} />
                          <YAxis tick={{ fill:C.midGray, fontSize:11, fontFamily:F }} axisLine={false} tickLine={false} unit=" mi" width={34} />
                          <Tooltip content={<WeekTip />} cursor={{ fill:"rgba(1,33,105,0.04)", radius:4 }} />
                          <Bar dataKey="miles" radius={[4,4,0,0]}>
                            {weekly.map((w,i)=>(
                              <Cell key={i} fill={w.miles>30?"url(#gHigh)":w.miles>20?"url(#gMid)":"url(#gLow)"} />
                            ))}
                            <LabelList
                              content={({ x, y, width, value, index }) => {
                                const w = weekly[index];
                                const pct = w?.pctChange!=null ? `${w.pctChange>0?"+":""}${w.pctChange}%` : null;
                                return (
                                  <g>
                                    <text x={x+width/2} y={y-12} textAnchor="middle" fill={C.midGray} fontSize={10} fontWeight={700} fontFamily={F}>{value}</text>
                                    {pct && <text x={x+width/2} y={y-2} textAnchor="middle"
                                      fill={w.pctChange>15?C.amber:w.pctChange<-15?C.bofaBlue:C.midGray}
                                      fontSize={9} fontFamily={F}>{pct}</text>}
                                  </g>
                                );
                              }}
                              dataKey="miles"
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div style={{ borderTop:`1px solid ${C.light}`, paddingTop:16 }}>
                      <WeeklySummaryAI
                        weekData={{ monDate: getMondayOf(lastRunDate) }}
                        allData={{
                          thisWeekMi, thisWeekRuns:thisWeekRuns.length,
                          weekAvgHR, weekAvgPace, weekElev,
                          weekMiChangePct, weekMiChange, prevCompletedMiles,
                          trendDir, effTrend, acwr, weekInProgress, projectedMi,
                          easyPct:easyPctThisWeek, weeksToRace,
                          avgHRAll30, totalMi, runsCount:runs.length,
                        }}
                      />
                    </div>

                    {/* HR Zone Breakdown */}
                    {(() => {
                      // 5-zone breakdown matching Apple Watch zones from screenshot
                      // Zone 1: <138, Zone 2: 139–151, Zone 3: 152–164, Zone 4: 165–177, Zone 5: >178
                      const ZONES_5 = [
                        { id:"z1", label:"Zone 1", desc:"< 138 bpm", color:"#4FC3F7", textColor:"#0277BD", pctTarget:null, note:"Recovery" },
                        { id:"z2", label:"Zone 2", desc:"139–151 bpm", color:"#81C784", textColor:"#2E7D32", pctTarget:null, note:"Aerobic Base" },
                        { id:"z3", label:"Zone 3", desc:"152–164 bpm", color:"#CDDC39", textColor:"#827717", pctTarget:"target ≥50%", note:"Aerobic Threshold" },
                        { id:"z4", label:"Zone 4", desc:"165–177 bpm", color:"#FFA726", textColor:"#E65100", pctTarget:null, note:"Lactate Threshold" },
                        { id:"z5", label:"Zone 5", desc:"≥ 178 bpm", color:"#EF5350", textColor:"#B71C1C", pctTarget:null, note:"VO₂ Max" },
                      ];

                      // Calculate time in each zone — prefer mile-level split HR from Strava
                      // for accuracy; fall back to run-average HR when splits lack HR data.
                      let totalMin = 0;
                      const zoneMinutes = { z1:0, z2:0, z3:0, z4:0, z5:0 };

                      const assignZone5 = (hr, min) => {
                        if (hr == null || min <= 0) return;
                        totalMin += min;
                        if      (hr < 138) zoneMinutes.z1 += min;
                        else if (hr < 152) zoneMinutes.z2 += min;
                        else if (hr < 165) zoneMinutes.z3 += min;
                        else if (hr < 178) zoneMinutes.z4 += min;
                        else               zoneMinutes.z5 += min;
                      };

                      thisWeekRuns.forEach(r => {
                        const splits = r.splits || [];
                        const splitsWithHR = splits.filter(s => s.avgHR != null && s.movingTimeSec > 0);
                        if (splitsWithHR.length >= 1) {
                          // Use per-mile split HR for precision
                          splitsWithHR.forEach(s => assignZone5(s.avgHR, s.movingTimeSec / 60));
                          // Remaining time without split HR: fall back to run avg
                          const coveredSec = splitsWithHR.reduce((a,s)=>a+s.movingTimeSec,0);
                          const leftoverMin = Math.max(0, ((r.movingTimeSec ?? 0) - coveredSec) / 60);
                          if (leftoverMin > 0 && r.avgHR != null) assignZone5(r.avgHR, leftoverMin);
                        } else if (r.avgHR != null) {
                          // No per-split HR — use run average as approximation
                          assignZone5(r.avgHR, r.movingTimeSec ? r.movingTimeSec / 60 : 0);
                        }
                      });

                      if (!totalMin) return null;

                      const fmtMin = m => {
                        const rounded = Math.round(m);
                        return rounded >= 60 ? `${Math.floor(rounded/60)}h ${rounded%60}m` : `${rounded}m`;
                      };

                      const maxPct = Math.max(...Object.values(zoneMinutes).map(m => m/totalMin*100));

                      return (
                        <div style={{ borderTop:`1px solid ${C.light}`, paddingTop:14, marginTop:4 }}>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                            <div>
                              <p style={{ color:C.navy, fontSize:16, fontWeight:700, margin:"0 0 2px" }}>HR Zone Breakdown · This Week</p>
                              <p style={{ color:C.midGray, fontSize:12, margin:0 }}>
                                Time in each zone from mile-level Strava splits when available; falls back to run-average HR.
                              </p>
                            </div>
                            <p style={{ color:C.midGray, fontSize:12, margin:0, flexShrink:0, marginLeft:12 }}>{fmtMin(totalMin)} total</p>
                          </div>

                          {/* Stacked bar visualization */}
                          <div style={{ display:"flex", height:14, borderRadius:7, overflow:"hidden", marginBottom:14, gap:1 }}>
                            {ZONES_5.map(zone => {
                              const pct = totalMin > 0 ? zoneMinutes[zone.id] / totalMin * 100 : 0;
                              if (pct < 0.5) return null;
                              return (
                                <div key={zone.id} style={{ height:"100%", width:`${pct}%`, background:zone.color, transition:"width 0.4s ease" }} title={`${zone.label}: ${pct.toFixed(0)}%`} />
                              );
                            })}
                          </div>

                          {/* Zone rows */}
                          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                            {ZONES_5.map(zone => {
                              const mins = zoneMinutes[zone.id];
                              const pct = totalMin > 0 ? mins / totalMin * 100 : 0;
                              const barWidth = maxPct > 0 ? pct / maxPct * 100 : 0;
                              return (
                                <div key={zone.id} style={{ display:"grid", gridTemplateColumns:"80px 1fr 70px 52px", alignItems:"center", gap:10 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                    <div style={{ width:10, height:10, borderRadius:"50%", background:zone.color, flexShrink:0 }} />
                                    <span style={{ fontSize:12, fontWeight:700, color:zone.textColor }}>{zone.label}</span>
                                  </div>
                                  <div style={{ position:"relative", height:8, background:C.light, borderRadius:4, overflow:"hidden" }}>
                                    <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${barWidth}%`, background:zone.color, borderRadius:4, transition:"width 0.4s ease" }} />
                                  </div>
                                  <span style={{ fontSize:12, color:C.midGray, textAlign:"right", whiteSpace:"nowrap" }}>{fmtMin(mins)}</span>
                                  <span style={{ fontSize:12, fontWeight:700, color:pct > 0 ? zone.textColor : C.light, textAlign:"right" }}>
                                    {pct > 0 ? `${pct.toFixed(0)}%` : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Zone reference legend */}
                          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 14px", marginTop:10 }}>
                            {ZONES_5.map(zone => (
                              <span key={zone.id} style={{ fontSize:11, color:C.midGray }}>
                                <span style={{ fontWeight:600, color:zone.textColor }}>{zone.label}</span> {zone.desc} · {zone.note}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </section>

            {/* ═══ CHICAGO MARATHON TRAINING CYCLE ═══ */}
            {(() => {
              const TODAY_TS = new Date();
              const TRAINING_START_TS = new Date("2026-01-19T00:00:00");
              const RACE_DATE_TS = new Date("2026-10-11T07:30:00");
              const totalDays = (RACE_DATE_TS - TRAINING_START_TS) / 864e5;
              const daysElapsed = Math.max(0, (TODAY_TS - TRAINING_START_TS) / 864e5);
              const pctDone = Math.min(100, (daysElapsed / totalDays * 100));

              const SEASONS = [
                {
                  id: "base",
                  label: "Base Building",
                  shortLabel: "Base",
                  start: new Date("2026-01-19"),
                  end:   new Date("2026-05-11"),
                  color: "#4FC3F7",
                  textColor: "#0277BD",
                  icon: "🏗️",
                  desc: "Building aerobic infrastructure. Easy miles only. Volume over intensity.",
                  weeksLabel: "Wks 1–16",
                },
                {
                  id: "aerobic",
                  label: "Aerobic Development",
                  shortLabel: "Aerobic Dev",
                  start: new Date("2026-05-11"),
                  end:   new Date("2026-07-06"),
                  color: "#81C784",
                  textColor: "#2E7D32",
                  icon: "⚡",
                  desc: "Long run progression, peak mileage weeks. Aerobic engine is developing.",
                  weeksLabel: "Wks 17–24",
                },
                {
                  id: "specific",
                  label: "Race-Specific",
                  shortLabel: "Race-Specific",
                  start: new Date("2026-07-06"),
                  end:   new Date("2026-09-21"),
                  color: "#FFA726",
                  textColor: "#E65100",
                  icon: "🎯",
                  desc: "Marathon-pace long runs, tempo work. Quality over quantity.",
                  weeksLabel: "Wks 25–35",
                },
                {
                  id: "taper",
                  label: "Taper",
                  shortLabel: "Taper",
                  start: new Date("2026-09-21"),
                  end:   new Date("2026-10-11"),
                  color: "#EF5350",
                  textColor: "#B71C1C",
                  icon: "🪶",
                  desc: "Protect fitness. Reduce volume. Trust the process.",
                  weeksLabel: "Wks 36–38",
                },
              ];

              const currentSeason = SEASONS.find(s => TODAY_TS >= s.start && TODAY_TS < s.end) ?? SEASONS[SEASONS.length - 1];
              const weekNum = Math.max(1, Math.ceil(daysElapsed / 7));

              // Phase-specific contextual message
              const phaseMessages = {
                base: `Week ${weekNum} of base building. Every easy mile is laying a brick. Mitochondria don't care that it feels slow.`,
                aerobic: `You're in the aerobic development phase — this is where the engine actually gets built. Long runs and consistency are everything right now.`,
                specific: `Race-specific phase. The base is done. Now you tune it. MP long runs start mattering.`,
                taper: `Taper time. The work is banked. Your job is to show up rested on October 11th.`,
              };

              return (
                <section style={{ marginBottom: isMob ? 32 : 48 }}>
                  <SecTitle title="Chicago Marathon Training Cycle" color={C.navy} />
                  <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>

                    {/* Current phase callout */}
                    <div style={{
                      background:`${currentSeason.color}18`,
                      border:`1px solid ${currentSeason.color}60`,
                      borderLeft:`5px solid ${currentSeason.color}`,
                      borderRadius:8, padding:"14px 18px", marginBottom:20,
                      display:"flex", alignItems:"center", gap:14, flexWrap:"wrap",
                    }}>
                      <span style={{ fontSize:28 }}>{currentSeason.icon}</span>
                      <div style={{ flex:1, minWidth:180 }}>
                        <p style={{ color:currentSeason.textColor, fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", margin:"0 0 2px" }}>
                          Current Phase · Week {weekNum}
                        </p>
                        <p style={{ color:C.darkGray, fontSize:17, fontWeight:800, margin:"0 0 3px" }}>{currentSeason.label}</p>
                        <p style={{ color:C.midGray, fontSize:13, margin:0, lineHeight:1.5 }}>{phaseMessages[currentSeason.id]}</p>
                      </div>
                      <div style={{ textAlign:"center", flexShrink:0 }}>
                        <p style={{ color:C.midGray, fontSize:11, textTransform:"uppercase", letterSpacing:"0.09em", margin:"0 0 2px", fontWeight:600 }}>Race Day</p>
                        <p style={{ color:C.darkGray, fontSize:15, fontWeight:800, margin:0 }}>Oct 11</p>
                        <p style={{ color:C.midGray, fontSize:12, margin:0 }}>{weeksToRace} wks away</p>
                      </div>
                    </div>

                    {/* Timeline progress bar */}
                    <div style={{ marginBottom:6 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:12, color:C.midGray }}>Training Start · Jan 19</span>
                        <span style={{ fontSize:12, color:C.midGray }}>Race Day · Oct 11</span>
                      </div>
                      <div style={{ position:"relative", height:10, background:C.light, borderRadius:5, overflow:"visible", marginBottom:18 }}>
                        {/* Phase segments */}
                        {SEASONS.map(s => {
                          const segStart = Math.max(0, (s.start - TRAINING_START_TS) / (RACE_DATE_TS - TRAINING_START_TS) * 100);
                          const segEnd   = Math.min(100, (s.end   - TRAINING_START_TS) / (RACE_DATE_TS - TRAINING_START_TS) * 100);
                          const segWidth = segEnd - segStart;
                          return (
                            <div key={s.id} style={{
                              position:"absolute", left:`${segStart}%`, width:`${segWidth}%`,
                              height:"100%", background:s.color, opacity:0.5,
                            }} />
                          );
                        })}
                        {/* Progress fill */}
                        <div style={{ position:"absolute", left:0, width:`${pctDone}%`, height:"100%", background:currentSeason.color, borderRadius:5, opacity:0.9 }} />
                        {/* Current position dot */}
                        <div style={{
                          position:"absolute", left:`${Math.min(pctDone, 97)}%`, top:"50%",
                          transform:"translate(-50%,-50%)",
                          width:14, height:14, borderRadius:"50%",
                          background:currentSeason.color, border:"2px solid white",
                          boxShadow:"0 1px 4px rgba(0,0,0,0.3)",
                        }} />
                      </div>
                    </div>

                    {/* Phase cards */}
                    <div style={{ display:"grid", gridTemplateColumns: isMob ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10 }}>
                      {SEASONS.map(s => {
                        const isCurrent = s.id === currentSeason.id;
                        const isPast = TODAY_TS >= s.end;
                        return (
                          <div key={s.id} style={{
                            background: isCurrent ? `${s.color}12` : isPast ? C.offWhite : C.white,
                            border: isCurrent ? `2px solid ${s.color}` : `1px solid ${C.border}`,
                            borderTop: `4px solid ${isCurrent || isPast ? s.color : C.border}`,
                            borderRadius:8, padding:"12px 14px",
                            opacity: isPast && !isCurrent ? 0.7 : 1,
                          }}>
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
                              <span style={{ fontSize:16 }}>{s.icon}</span>
                              {isCurrent && <span style={{ fontSize:10, fontWeight:700, color:s.textColor, background:`${s.color}30`, borderRadius:3, padding:"1px 5px", letterSpacing:"0.06em" }}>NOW</span>}
                              {isPast && !isCurrent && <span style={{ fontSize:10, color:C.midGray }}>✓</span>}
                            </div>
                            <p style={{ color: isCurrent ? s.textColor : C.darkGray, fontSize:13, fontWeight:700, margin:"0 0 2px", lineHeight:1.2 }}>{s.label}</p>
                            <p style={{ color:C.midGray, fontSize:11, margin:"0 0 4px" }}>{s.weeksLabel}</p>
                            <p style={{ color:C.midGray, fontSize:11, margin:0, lineHeight:1.5, display: isMob ? "none" : "block" }}>{s.desc}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* ═══ AEROBIC FITNESS PROFILE ═══ */}
            {(() => {
              const zones = afpMode === 'gap' ? gapPaceZoneStats : paceZoneStats;
              return (
            <section style={{ marginBottom: isMob ? 32 : 48 }}>
              <SecTitle title="Aerobic Fitness Profile" color={C.navy}
                toggleOptions={[{id:'raw',label:'Raw Pace'},{id:'gap',label:'⚡ True Effort™'}]}
                toggleValue={afpMode} onToggle={setAfpMode} />
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                  <div style={{ marginBottom:20 }}>
                  <div style={{ marginBottom:10 }}>
                    <p style={{ color:C.midGray, fontSize:13, margin:"0 0 3px" }}>
                      <strong style={{ color:C.navy }}>HR at Equivalent Paces</strong> · Prior 4 weeks → Recent 4 weeks · <span style={{ color:C.green }}>green = HR dropped (fitness gained)</span>
                    </p>
                    {afpMode==='gap' && (
                      <p style={{ color:C.midGray, fontSize:12, margin:0, fontStyle:"italic" }}>
                        <strong style={{ color:C.navy, fontStyle:"normal" }}>⚡ True Effort™</strong> — normalizes every run to neutral conditions by removing the grade penalty (+7% per 100 ft/mi elevation) and stripping out heat & humidity stress (each 5°F above 60°F + high humidity adds ~1–2% difficulty). What you see is your actual aerobic output, not the weather and terrain tax. The fairest apples-to-apples fitness comparison possible.
                      </p>
                    )}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns: isMob ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:12 }}>
                    {zones.filter(z=>z.earlyN>0||z.lateN>0).map(z => {
                      const borderColor = z.delta != null && z.delta < 0 ? C.green : z.delta != null && z.delta > 0 ? C.amber : C.border;
                      return (
                        <div key={z.id} style={{
                          background:C.white, border:`1px solid ${borderColor}`,
                          borderTop:`4px solid ${borderColor}`,
                          borderRadius:8, padding:"16px 18px",
                          boxShadow:"0 2px 8px rgba(1,33,105,0.07)",
                        }}>
                          <p style={{ color:C.midGray, fontSize:12, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", margin:"0 0 10px" }}>{z.label}</p>
                          <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                            <span style={{ color:C.midGray, fontSize:16, fontWeight:500 }}>{z.earlyHR ?? "—"}</span>
                            <span style={{ color:C.midGray, fontSize:14 }}>→</span>
                            <span style={{ color:z.delta!=null&&z.delta<0?C.green:z.delta!=null&&z.delta>0?C.red:C.navy, fontSize:27, fontWeight:800, lineHeight:1 }}>{z.lateHR ?? "—"}</span>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:6 }}>
                            <span style={{ fontSize:14, fontWeight:700, color:z.delta<0?C.green:z.delta>0?C.red:C.midGray }}>
                              {z.delta!=null ? (z.delta<0?`${z.delta} bpm`:`+${z.delta} bpm`) : ""}
                            </span>
                            <span style={{ color:C.midGray, fontSize:11 }}>
                              {z.earlyN>0?`${z.earlyN}`:"-"} / {z.lateN>0?`${z.lateN}`:"-"} runs
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap:24, borderTop:`1px solid ${C.light}`, paddingTop:20 }}>
                  <div>
                    {(() => {
                      const activeEff = afpMode === 'gap' ? gapEfficiencyOverTime : efficiencyOverTime;
                      const activeReg = afpMode === 'gap' ? gapEffReg : effReg;
                      return (
                    <div style={{ marginBottom:12 }}>
                      <p style={{ color:C.navy, fontSize:16, fontWeight:700, margin:"0 0 3px" }}>
                        Aerobic Efficiency Index{afpMode==='gap' && <span style={{ color:C.bofaBlue, fontSize:12, fontWeight:600, marginLeft:6 }}>⚡ True Effort™</span>}
                      </p>
                      <p style={{ color:C.midGray, fontSize:13, margin:"0 0 8px", lineHeight:1.5 }}>10,000 ÷ (pace_sec × HR/60) — higher score = more efficient running{afpMode==='gap'?' · pace normalized for terrain & weather':''}</p>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:13, color:C.midGray, fontWeight:500 }}>Season trend:</span>
                        <span style={{ fontSize:14, fontWeight:700, color:activeReg&&activeReg.slope>0?C.green:C.amber }}>
                          {activeReg?(activeReg.slope>0?"↑ Improving":"↓ Declining"):"—"}
                        </span>
                        {activeReg&&<span style={{ fontSize:12, color:C.midGray }}>R² {(activeReg.r2*100).toFixed(0)}%</span>}
                      </div>
                    </div>
                      );
                    })()}
                    <ResponsiveContainer width="100%" height={210}>
                      <ComposedChart data={afpMode==='gap' ? gapEfficiencyOverTime : efficiencyOverTime}>
                        <defs>
                          <linearGradient id="effGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={C.green} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={C.green} stopOpacity={0.01} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                        <XAxis dataKey="date" tick={{ fill:C.midGray, fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
                        <YAxis tick={{ fill:C.midGray, fontSize:11 }} axisLine={false} tickLine={false} domain={["auto","auto"]} tickFormatter={v=>v.toFixed(1)} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active||!payload?.length) return null;
                          const d=payload[0].payload;
                          return (
                            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px", fontFamily:F }}>
                              <p style={{ color:C.midGray, fontSize:13, margin:"0 0 4px" }}>{d.date}</p>
                              <p style={{ color:d.efficiency>1.5?C.green:d.efficiency>1.2?C.amber:C.red, fontSize:19, fontWeight:800, margin:"0 0 4px" }}>{d.efficiency.toFixed(2)}</p>
                              <Row label="Pace" value={`${d.pace} /mi`} />
                              <Row label="Avg HR" value={`${d.avgHR} bpm`} />
                            </div>
                          );
                        }} />
                        <Area type="monotone" dataKey="efficiency" stroke={C.green} fill="url(#effGrad)" strokeWidth={2.5}
                          dot={(props)=>{ const {cx,cy,index}=props; const activeData=afpMode==='gap'?gapEfficiencyOverTime:efficiencyOverTime; const isLatest=index===activeData.length-1;
                            return <circle key={index} cx={cx} cy={cy} r={isLatest?5:3} fill={isLatest?C.green:C.navy} stroke={C.white} strokeWidth={isLatest?2:1} />;
                          }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  <div>
                    <div style={{ marginBottom:12 }}>
                      <p style={{ color:C.navy, fontSize:16, fontWeight:700, margin:"0 0 3px" }}>HR vs Pace Scatter</p>
                      <p style={{ color:C.midGray, fontSize:13, margin:"0 0 8px", lineHeight:1.5 }}>Each dot = one run. A downward shift over time signals aerobic gains.</p>
                      {regression && (
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <span style={{ fontSize:13, color:C.midGray }}>Correlation R²</span>
                          <span style={{ fontSize:14, fontWeight:700, color:regression.r2>0.6?C.green:regression.r2>0.3?C.amber:C.midGray }}>{(regression.r2*100).toFixed(0)}%</span>
                          <span style={{ fontSize:13, color:C.midGray }}>· {regression.r2>0.6?"Strong":regression.r2>0.3?"Moderate":"Weak"}</span>
                        </div>
                      )}
                    </div>
                    <ResponsiveContainer width="100%" height={210}>
                      <ScatterChart margin={{ top:8, right:8, bottom:22, left:0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.light} />
                        <XAxis type="number" dataKey="x" name="Pace" domain={["auto","auto"]}
                          tick={{ fill:C.midGray, fontSize:11 }}
                          label={{ value:"pace (min/mi)", position:"insideBottom", offset:-8, fill:C.midGray, fontSize:11 }}
                          tickFormatter={v=>`${Math.floor(v/60)}:${String(v%60).padStart(2,"0")}`} />
                        <YAxis type="number" dataKey="y" name="Avg HR" domain={["auto","auto"]}
                          tick={{ fill:C.midGray, fontSize:11 }} width={30} />
                        <Tooltip content={<ScatterTip />} />
                        <Scatter data={scatter} fill={C.navy} opacity={0.7} r={4} />
                        {regression && (() => {
                          const xs=scatter.map(d=>d.x);
                          const xMin=Math.min(...xs), xMax=Math.max(...xs);
                          return <Scatter data={[{x:xMin,y:regression.slope*xMin+regression.intercept},{x:xMax,y:regression.slope*xMax+regression.intercept}]}
                            fill="none" line={{ stroke:C.red, strokeWidth:1.5, strokeDasharray:"5 3" }} shape={()=>null} legendType="none" />;
                        })()}
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </section>
              );
            })()}

            {/* ═══ LOAD & FATIGUE ═══ */}
            <section style={{ marginBottom: isMob ? 32 : 48 }}>
              <SecTitle title="Load & Fatigue" color={C.navy} />
              <p style={{ color:C.midGray, fontSize:14, margin:"0 0 20px" }}>
                Training load = duration × HR factor. ACWR compares this week's load to the rolling 4-week average. Sweet spot: 0.8–1.3.
              </p>

              {/* Top row: ACWR score card + load chart */}
              <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "280px 1fr", gap:20, marginBottom:20 }}>
                {/* ACWR Score */}
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                  <p style={{ color:C.midGray, fontSize:12, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", margin:"0 0 14px" }}>Acute:Chronic Ratio</p>
                  {acwr ? (
                    <>
                      <div style={{
                        background:acwr.zone==="high"?"#fff0f2":acwr.zone==="caution"?"#fff8f0":"#f0fff8",
                        border:`1px solid ${acwr.zone==="high"?C.red+"40":acwr.zone==="caution"?C.amber+"40":C.green+"40"}`,
                        borderLeft:`5px solid ${acwr.zone==="high"?C.red:acwr.zone==="caution"?C.amber:C.green}`,
                        borderRadius:8, padding:"16px 18px", marginBottom:14,
                      }}>
                        <p style={{ color:acwr.zone==="high"?C.red:acwr.zone==="caution"?C.amber:C.green, fontSize:45, fontWeight:900, margin:"0 0 4px", lineHeight:1, letterSpacing:"-0.03em" }}>{acwr.ratio}</p>
                        <p style={{ color:C.darkGray, fontSize:15, fontWeight:600, margin:"0 0 4px" }}>
                          {acwr.zone==="high"?"High risk — reduce load":acwr.zone==="caution"?"Caution — avoid big jumps":acwr.zone==="low"?"Low — room to build":"Safe zone ✓"}
                        </p>
                        <p style={{ color:C.midGray, fontSize:13, margin:0 }}>Acute load: {acwr.acute} · Chronic: {acwr.chronic}</p>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, textAlign:"center" }}>
                        {[{r:"<0.8", label:"Low", c:C.bofaBlue},{r:"0.8–1.3", label:"Optimal", c:C.green},{r:">1.3", label:"Risk", c:C.red}].map(z=>(
                          <div key={z.r} style={{ background:C.offWhite, borderRadius:6, padding:"8px 4px", borderTop:`3px solid ${z.c}` }}>
                            <p style={{ color:z.c, fontSize:12, fontWeight:700, margin:"0 0 2px" }}>{z.r}</p>
                            <p style={{ color:C.midGray, fontSize:11, margin:0 }}>{z.label}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <p style={{ color:C.midGray, fontSize:15 }}>Not enough data</p>}
                </div>

                {/* Weekly Load chart */}
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                  <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:14 }}>
                    <p style={{ color:C.navy, fontSize:16, fontWeight:700, margin:0 }}>Weekly Load History</p>
                    <p style={{ color:C.midGray, fontSize:13, margin:0 }}>Bar color = load spike · Red line = 4-wk rolling avg</p>
                  </div>
                  {acwrHistory.length>0 ? (
                    <ResponsiveContainer width="100%" height={160}>
                      <ComposedChart data={cumulativeLoadChart.slice(-10)} margin={{ top:5, right:10, bottom:5, left:0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
                        <YAxis hide />
                        <Tooltip contentStyle={{ fontSize:13 }} formatter={(v,n) => [n==="rolling4"?`${v} avg`:`${v} load`, n==="rolling4"?"4-wk avg":"Load"]} />
                        <Bar dataKey="load" radius={[3,3,0,0]}>
                          {cumulativeLoadChart.slice(-10).map((w,i)=>(<Cell key={i} fill={w.spike?C.amber:C.navy} />))}
                        </Bar>
                        <Line type="monotone" dataKey="rolling4" stroke={C.red} strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p style={{ color:C.midGray, fontSize:14 }}>Not enough data</p>}
                  <p style={{ margin:"8px 0 0", fontSize:12, color:C.midGray }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:5, marginRight:12 }}><span style={{ width:10, height:10, background:C.amber, borderRadius:2, display:"inline-block" }} />Load spike (≥1.5× prior week)</span>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}><span style={{ width:16, height:2, background:C.red, display:"inline-block" }} />4-week rolling avg</span>
                  </p>
                </div>
              </div>

              {/* Bottom row: Monotony (left) + ACWR trend (right) */}
              <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap:20 }}>
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                  <p style={{ color:C.navy, fontSize:16, fontWeight:700, margin:"0 0 4px" }}>Training Monotony</p>
                  <p style={{ color:C.midGray, fontSize:13, margin:"0 0 16px" }}>Mean daily mileage ÷ std dev. Lower = more varied stimulus.</p>
                  {trainingMonotony ? (
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
                        <span style={{ fontSize:53, fontWeight:900, letterSpacing:"-0.03em", color:trainingMonotony.monotony>2?C.red:trainingMonotony.monotony>1.5?C.amber:C.green, lineHeight:1 }}>
                          {trainingMonotony.monotony}
                        </span>
                        <div>
                          <p style={{ color:C.midGray, fontSize:14, margin:"0 0 4px" }}>Mean: {trainingMonotony.mean} mi/day</p>
                          <p style={{ color:trainingMonotony.monotony<1.5?C.green:trainingMonotony.monotony<2?C.amber:C.red, fontSize:15, fontWeight:700, margin:0 }}>
                            {trainingMonotony.monotony<1.5?"✓ Good variety":trainingMonotony.monotony<2?"Moderate — mix it up":"⚠ High monotony"}
                          </p>
                        </div>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, textAlign:"center" }}>
                        {[{r:"<1.5", label:"Varied", c:C.green},{r:"1.5–2.0", label:"Moderate", c:C.amber},{r:">2.0", label:"Monotonous", c:C.red}].map(z=>(
                          <div key={z.r} style={{ background:C.offWhite, borderRadius:6, padding:"8px 4px", borderTop:`3px solid ${z.c}` }}>
                            <p style={{ color:z.c, fontSize:12, fontWeight:700, margin:"0 0 2px" }}>{z.r}</p>
                            <p style={{ color:C.midGray, fontSize:11, margin:0 }}>{z.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : <p style={{ color:C.midGray, fontSize:14 }}>Not enough data</p>}
                </div>

                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                  <p style={{ color:C.navy, fontSize:16, fontWeight:700, margin:"0 0 4px" }}>ACWR Over Time</p>
                  <p style={{ color:C.midGray, fontSize:13, margin:"0 0 14px" }}>Historical ratio by week — keep under 1.3</p>
                  {acwrHistory.length > 0 ? (
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={acwrHistory.slice(-8)} margin={{ top:5, right:5, bottom:5, left:0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
                        <YAxis hide domain={[0,2]} />
                        <Tooltip contentStyle={{ fontSize:13 }} formatter={(v) => [`${v}`, "ACWR"]} />
                        <Bar dataKey="acwr" radius={[3,3,0,0]}>
                          {acwrHistory.slice(-8).map((e,i)=>(<Cell key={i} fill={e.zone==="high"?C.red:e.zone==="caution"?C.amber:C.green} />))}
                        </Bar>
                        <ReferenceLine y={1.3} stroke={C.amber} strokeDasharray="4 3" label={{ value:"1.3", fill:C.amber, fontSize:11, position:"insideTopRight" }} />
                        <ReferenceLine y={1.5} stroke={C.red} strokeDasharray="4 3" label={{ value:"1.5", fill:C.red, fontSize:11, position:"insideTopRight" }} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p style={{ color:C.midGray, fontSize:14 }}>Not enough weekly data</p>}
                </div>
              </div>
            </section>


            {/* ═══ RUNNING ECONOMY ═══ */}
            {efficiencyMetrics && (
              <section style={{ marginBottom: isMob ? 32 : 48 }}>
                <SecTitle title="Running Economy" color={C.navy}
                  toggleOptions={[{id:'rolling',label:'3-Wk Rolling Avg'},{id:'individual',label:'Individual Runs'}]}
                  toggleValue={econView} onToggle={setEconView} />
                <p style={{ color:C.midGray, fontSize:14, margin:"0 0 20px" }}>
                  Biomechanical efficiency and cardio fitness. Lower ground contact time and vertical oscillation, higher cadence = better economy.{econView==='individual' && <span style={{ color:C.amber, marginLeft:6 }}>· Showing raw per-run data — more noise, reveals single-run outliers.</span>}
                </p>

                {/* VO2 Max compact card */}
                {(() => {
                  const vo2Latest = vo2MaxData.length > 0 ? vo2MaxData[vo2MaxData.length-1] : null;
                  if (!vo2Latest) return null;
                  const vo2First = vo2MaxData[0];
                  const delta = vo2MaxData.length > 1 ? +(vo2Latest.vo2max - vo2First.vo2max).toFixed(1) : null;
                  const zone = vo2Latest.vo2max >= 52 ? { label:"Excellent", color:C.green }
                    : vo2Latest.vo2max >= 46 ? { label:"Good", color:C.bofaBlue }
                    : vo2Latest.vo2max >= 42 ? { label:"Average", color:C.amber }
                    : { label:"Below Average", color:C.red };
                  const trend = vo2MaxData.length < 2 ? "→ stable"
                    : delta > 1 ? "↑ improving" : delta < -1 ? "↓ declining" : "→ stable";
                  const trendColor = trend.includes("↑") ? C.green : trend.includes("↓") ? C.amber : C.midGray;
                  // Build recent-only sparkline: last 10 readings with tight y-domain
                  const sparkData = vo2MaxData.slice(-10);
                  const sparkVals = sparkData.map(d => d.vo2max).filter(Boolean);
                  const sparkMin = sparkVals.length ? +(Math.min(...sparkVals) - 0.5).toFixed(1) : "auto";
                  const sparkMax = sparkVals.length ? +(Math.max(...sparkVals) + 0.5).toFixed(1) : "auto";
                  return (
                    <div style={{ background:C.white, border:`1px solid ${zone.color}30`, borderLeft:`4px solid ${zone.color}`, borderRadius:10, padding:"16px 20px", marginBottom:24, display:"flex", alignItems:"center", gap:20, flexWrap:"wrap", boxShadow:`0 2px 10px ${zone.color}10` }}>
                      {/* Big number */}
                      <div style={{ flexShrink:0 }}>
                        <p style={{ color:C.midGray, fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", margin:"0 0 2px" }}>VO₂ Max</p>
                        <p style={{ color:zone.color, fontSize:42, fontWeight:900, margin:0, lineHeight:1, letterSpacing:"-0.03em" }}>
                          {vo2Latest.vo2max?.toFixed(1)}<span style={{ fontSize:13, fontWeight:400, color:C.midGray, marginLeft:3 }}>ml/kg/min</span>
                        </p>
                        <p style={{ color:C.midGray, fontSize:11, margin:"3px 0 0" }}>{vo2Latest.date} · Apple Watch</p>
                      </div>
                      {/* Stat pills */}
                      <div style={{ display:"flex", gap:10, flexWrap:"wrap", flexShrink:0 }}>
                        <div style={{ background:zone.color+"15", borderRadius:6, padding:"8px 12px", textAlign:"center", minWidth:72 }}>
                          <p style={{ color:C.midGray, fontSize:10, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", margin:"0 0 2px" }}>Zone</p>
                          <p style={{ color:zone.color, fontSize:14, fontWeight:800, margin:0 }}>{zone.label}</p>
                        </div>
                        {delta !== null && (
                          <div style={{ background:C.offWhite, borderRadius:6, padding:"8px 12px", textAlign:"center", minWidth:72 }}>
                            <p style={{ color:C.midGray, fontSize:10, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", margin:"0 0 2px" }}>Season Δ</p>
                            <p style={{ color:delta>0?C.green:delta<0?C.red:C.midGray, fontSize:14, fontWeight:800, margin:0 }}>{delta>0?"+":""}{delta}</p>
                          </div>
                        )}
                        <div style={{ background:C.offWhite, borderRadius:6, padding:"8px 12px", textAlign:"center", minWidth:72 }}>
                          <p style={{ color:C.midGray, fontSize:10, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", margin:"0 0 2px" }}>Trend</p>
                          <p style={{ color:trendColor, fontSize:14, fontWeight:800, margin:0 }}>{trend}</p>
                        </div>
                      </div>
                      {/* Sparkline — tight y-domain so subtle changes are visible */}
                      {sparkData.length > 2 && (
                        <div style={{ flex:1, minWidth:160 }}>
                          <p style={{ color:C.midGray, fontSize:10, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", margin:"0 0 4px" }}>
                            Last {sparkData.length} readings
                          </p>
                          <ResponsiveContainer width="100%" height={52}>
                            <LineChart data={sparkData} margin={{ top:4, right:8, bottom:4, left:0 }}>
                              <YAxis domain={[sparkMin, sparkMax]} hide />
                              <Line type="monotone" dataKey="vo2max" stroke={zone.color} strokeWidth={2.5}
                                dot={(props) => {
                                  const { cx, cy, index } = props;
                                  return index === sparkData.length - 1
                                    ? <circle key={index} cx={cx} cy={cy} r={4} fill={zone.color} stroke={C.white} strokeWidth={1.5} />
                                    : <circle key={index} cx={cx} cy={cy} r={2} fill={zone.color} opacity={0.5} />;
                                }}
                              />
                              <Tooltip contentStyle={{ fontSize:11, padding:"4px 8px" }} formatter={(v) => [`${v.toFixed(1)} ml/kg/min`, "VO₂ Max"]}
                                labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Biomechanics 2x2 grid */}
                {(() => {
                  const metrics = [
                    {
                      key: "cadence", label: "Cadence", unit: "spm", dataKey: "cadence",
                      value: efficiencyMetrics.avgCadence, trend: efficiencyMetrics.trendCadence,
                      refVal: 170, refLabel: "170 spm target", goodUp: true,
                      color: efficiencyMetrics.avgCadence >= 170 ? C.green : efficiencyMetrics.avgCadence >= 160 ? C.amber : C.red,
                      methodology: "Steps per minute from Apple Watch step count ÷ duration. Higher = shorter ground contact, less braking force.",
                      trendLabel: efficiencyMetrics.trendCadence?.slope > 0.1 ? "↑ improving" : efficiencyMetrics.trendCadence?.slope < -0.1 ? "↓ declining" : "→ stable",
                    },
                    {
                      key: "gct", label: "Ground Contact Time", unit: "ms", dataKey: "gct",
                      value: efficiencyMetrics.avgGCT, trend: efficiencyMetrics.trendGCT,
                      refVal: 250, refLabel: "250 ms target", goodUp: false,
                      color: efficiencyMetrics.avgGCT < 250 ? C.green : efficiencyMetrics.avgGCT < 280 ? C.amber : C.red,
                      methodology: "Time each foot spends on ground per step. Lower = faster turnover, more elastic energy return.",
                      trendLabel: efficiencyMetrics.trendGCT?.slope < -1 ? "↓ improving" : efficiencyMetrics.trendGCT?.slope > 1 ? "↑ worsening" : "→ stable",
                    },
                    {
                      key: "vo", label: "Vertical Oscillation", unit: "cm", dataKey: "vo",
                      value: efficiencyMetrics.avgVO, trend: efficiencyMetrics.trendVO,
                      refVal: 9, refLabel: "9 cm target", goodUp: false,
                      color: efficiencyMetrics.avgVO < 9 ? C.green : efficiencyMetrics.avgVO < 11 ? C.amber : C.red,
                      methodology: "Vertical bounce per stride in cm. Lower = less wasted energy moving up instead of forward.",
                      trendLabel: efficiencyMetrics.trendVO?.slope < -0.1 ? "↓ improving" : efficiencyMetrics.trendVO?.slope > 0.1 ? "↑ worsening" : "→ stable",
                    },
                    {
                      key: "stride", label: "Stride Length", unit: "m", dataKey: "stride",
                      value: efficiencyMetrics.avgStride, trend: efficiencyMetrics.trendStride,
                      refVal: 1.1, refLabel: "1.1 m target", goodUp: true,
                      color: efficiencyMetrics.avgStride > 1.1 ? C.green : efficiencyMetrics.avgStride > 0.9 ? C.amber : C.red,
                      methodology: "Distance covered per stride. Longer = better power output and neuromuscular efficiency at same cadence.",
                      trendLabel: efficiencyMetrics.trendStride?.slope > 0.01 ? "↑ improving" : efficiencyMetrics.trendStride?.slope < -0.01 ? "↓ declining" : "→ stable",
                    },
                  ].filter(m => m.value != null);
                  if (!metrics.length) return null;
                  return (
                    <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap:16 }}>
                      {metrics.map(m => {
                        const isImproving = m.goodUp ? m.trendLabel.includes("↑") : m.trendLabel.includes("↓ improving");
                        const isWorsening = m.goodUp ? m.trendLabel.includes("↓") : m.trendLabel.includes("↑ worsening");
                        const trendColor = isImproving ? C.green : isWorsening ? C.amber : C.midGray;
                        const chartData = (econView === 'individual' ? efficiencyMetrics.rawData : efficiencyMetrics.data).filter(d => d[m.dataKey] != null);
                        return (
                          <div key={m.key} style={{ background:C.white, border:`1px solid ${m.color}25`, borderTop:`3px solid ${m.color}`, borderRadius:8, padding:"16px 18px", boxShadow:`0 2px 10px ${m.color}08` }}>
                            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:8 }}>
                              <div>
                                <p style={{ color:C.midGray, fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", margin:"0 0 4px", fontWeight:700 }}>{m.label}</p>
                                <p style={{ color:m.color, fontSize:30, fontWeight:900, margin:0, lineHeight:1, letterSpacing:"-0.02em" }}>
                                  {m.value ?? "—"}<span style={{ fontSize:13, fontWeight:400, color:C.midGray, marginLeft:2 }}>{m.unit}</span>
                                </p>
                              </div>
                              <div style={{ textAlign:"right" }}>
                                <p style={{ fontSize:12, fontWeight:700, color:trendColor, margin:"0 0 2px" }}>{m.trendLabel}</p>
                                <p style={{ color:C.midGray, fontSize:11, margin:0 }}>{m.refLabel}</p>
                              </div>
                            </div>
                            {chartData.length > 1 && (
                              <ResponsiveContainer width="100%" height={90}>
                                <LineChart data={chartData} margin={{ top:4, right:4, bottom:4, left:0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                                  <XAxis dataKey="date" tick={{ fill:C.midGray, fontSize:9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                                  <YAxis hide domain={["auto","auto"]} />
                                  <ReferenceLine y={m.refVal} stroke={m.color} strokeDasharray="4 3" strokeWidth={1} label={{ value:m.refLabel, fill:m.color, fontSize:9, position:"insideTopRight" }} />
                                  <Tooltip contentStyle={{ fontSize:11, padding:"4px 8px" }} formatter={(v) => [`${v} ${m.unit}`, m.label]} />
                                  <Line type="monotone" dataKey={m.dataKey} stroke={m.color} strokeWidth={2} dot={econView==='individual' ? { r:2, fill:m.color } : false} />
                                </LineChart>
                              </ResponsiveContainer>
                            )}
                            <p style={{ color:C.midGray, fontSize:11, margin:"8px 0 0", lineHeight:1.5, fontStyle:"italic" }}>{m.methodology}</p>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </section>
            )}

            {/* ═══ LONG RUN TRACKER ═══ */}
            <section style={{ marginBottom: isMob ? 32 : 48 }}>
              <SecTitle title="Long Run Tracker" color={C.navy} />
              <p style={{ color:C.midGray, fontSize:14, margin:"0 0 16px" }}>
                Long runs defined as ≥8 miles or ≥90 minutes. Splits from Strava — pace and HR at every mile.
              </p>
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>

                {/* ── Key stats row ── */}
                {longRuns.length > 0 && (() => {
                  const last = longRuns[longRuns.length-1];
                  const longest = [...longRuns].sort((a,b)=>b.miles-a.miles)[0];
                  const avgLongHR = longRuns.filter(r=>r.avgHR).length
                    ? Math.round(longRuns.filter(r=>r.avgHR).reduce((s,r)=>s+r.avgHR,0)/longRuns.filter(r=>r.avgHR).length)
                    : null;
                  const runsWithSplitConsistency = longRuns.filter(r => r.splitConsistency != null);
                  const avgSplitConsistency = runsWithSplitConsistency.length
                    ? +(runsWithSplitConsistency.reduce((s,r) => s+r.splitConsistency, 0) / runsWithSplitConsistency.length).toFixed(1)
                    : null;
                  const stats = [
                    { label:"Total Long Runs", value:longRuns.length, unit:"", sub:"≥8 mi or ≥90 min", color:C.navy, accent:C.navy },
                    { label:"Longest Run", value:longest.miles.toFixed(1), unit:" mi", sub:fmtDate(longest.date), color:C.red, accent:C.red },
                    { label:"Last Long Run", value:last.miles.toFixed(1), unit:" mi", sub:`${fmtDate(last.date)} · ${last.paceLabel}/mi`, color:C.bofaBlue, accent:C.bofaBlue },
                    avgSplitConsistency != null
                      ? { label:"Avg Split σ", value:avgSplitConsistency, unit:" sec/mi",
                          sub: avgSplitConsistency < 20 ? "✓ Consistent pacing" : avgSplitConsistency < 40 ? "Moderate variance" : "⚠ High variability",
                          color: avgSplitConsistency < 20 ? C.green : avgSplitConsistency < 40 ? C.amber : C.red,
                          accent: avgSplitConsistency < 20 ? C.green : avgSplitConsistency < 40 ? C.amber : C.red }
                      : { label:"Avg HR on Longs", value:avgLongHR??"—", unit:" bpm",
                          sub:avgLongHR==null?"no data":avgLongHR<152?"✓ Easy aerobic":avgLongHR<165?"Moderate effort":"Running hard",
                          color:avgLongHR>165?C.red:avgLongHR>152?C.amber:C.green,
                          accent:avgLongHR>165?C.red:avgLongHR>152?C.amber:C.green },
                  ];
                  return (
                    <div style={{ display:"grid", gridTemplateColumns: isMob ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:12, marginBottom:20 }}>
                      {stats.map(s=>(
                        <div key={s.label} style={{
                          background:C.offWhite, border:`1px solid ${s.accent}20`,
                          borderTop:`3px solid ${s.accent}`, borderRadius:8, padding:"12px 14px",
                        }}>
                          <p style={{ color:C.midGray, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", margin:"0 0 4px", fontWeight:700 }}>{s.label}</p>
                          <p style={{ color:s.color, fontSize:24, fontWeight:900, margin:"0 0 2px", lineHeight:1, letterSpacing:"-0.02em" }}>
                            {s.value}<span style={{ fontSize:12, fontWeight:400, color:C.midGray, marginLeft:2 }}>{s.unit}</span>
                          </p>
                          <p style={{ color:C.midGray, fontSize:11, margin:0 }}>{s.sub}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* ── Progression chart + table combined ── */}
                {longRuns.length > 0 && (() => {
                  return (
                    <div style={{ borderTop:`1px solid ${C.light}`, paddingTop:16, marginBottom:20 }}>
                      <p style={{ color:C.navy, fontSize:15, fontWeight:700, margin:"0 0 10px" }}>
                        Distance Progression
                        {longRunTrend && <span style={{ fontSize:13, fontWeight:400, color:longRunTrend.slope>0?C.green:C.amber, marginLeft:8 }}>
                          {longRunTrend.slope>0.1?"↑ Building":"↓ Tapering or holding"}
                        </span>}
                      </p>
                      <ResponsiveContainer width="100%" height={180}>
                        <ComposedChart data={longRunChartData} margin={{ top:8, right:20, bottom:20, left:8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.light} />
                          <XAxis dataKey="date" tick={{ fill:C.midGray, fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
                          <YAxis tick={{ fill:C.midGray, fontSize:11 }} unit=" mi" domain={[0,24]} axisLine={false} tickLine={false} width={36} />
                          <Tooltip content={({ active, payload }) => {
                            if (!active||!payload?.[0]) return null;
                            const p=payload[0].payload;
                            return (
                              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px", fontFamily:F, fontSize:13 }}>
                                <p style={{ color:C.navy, fontWeight:700, margin:"0 0 4px" }}>{p.date} · {Number(p.miles).toFixed(1)} mi</p>
                                <Row label="Pace" value={`${p.paceLabel}/mi`} />
                                {p.avgHR&&<Row label="Avg HR" value={`${Math.round(p.avgHR)} bpm`} color={hrColor(p.avgHR)} />}
                                {p.paceFadeSec != null && <Row label="Pace fade" value={p.paceFadeSec > 0 ? `+${Math.round(p.paceFadeSec)}s` : `${Math.round(p.paceFadeSec)}s (neg)`} color={p.paceFadeSec > 60 ? C.red : p.paceFadeSec > 20 ? C.amber : C.green} />}
                              </div>
                            );
                          }} />
                          <ReferenceLine y={20} stroke={C.bofaBlue} strokeDasharray="4 3" label={{ value:"20 mi", fill:C.bofaBlue, fontSize:10, position:"right" }} />
                          <ReferenceLine y={22} stroke={C.amber} strokeDasharray="5 3" label={{ value:"22 peak", fill:C.amber, fontSize:10, position:"right" }} />
                          {longRunTrend&&longRunChartData.length>=2&&(
                            <Line type="monotone" dataKey="trend" stroke={C.navy} strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
                          )}
                          <Bar dataKey="miles" radius={[4,4,0,0]} barSize={24}>
                            {longRunChartData.map((e,i)=>(
                              <Cell key={i} fill={e.isEasy?C.green:e.isGoalPace?C.red:C.navy} />
                            ))}
                            <LabelList content={({ x, y, width, value }) => (
                              <text x={x+width/2} y={y-4} textAnchor="middle" fill={C.midGray} fontSize={9} fontWeight={600} fontFamily={F}>{Number(value).toFixed(1)}</text>
                            )} dataKey="miles" />
                          </Bar>
                        </ComposedChart>
                      </ResponsiveContainer>
                      <div style={{ display:"flex", gap:14, marginTop:6, flexWrap:"wrap" }}>
                        {[{c:C.green,l:"Easy (HR <152)"},{c:C.red,l:"Goal marathon pace"},{c:C.navy,l:"Other"}].map(x=>(
                          <span key={x.l} style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:C.midGray }}>
                            <span style={{ width:9, height:9, borderRadius:2, background:x.c, display:"inline-block" }} />{x.l}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* ── Long Run Trends: pacing, fade, HR drift over time ── */}
                {(() => {
                  // Gather all long runs that have any split-derived quality metric
                  const splitRuns = longRunsWithEffort.filter(r =>
                    r.paceFadeSec != null || r.splitConsistency != null || r.hrDrift != null
                  );
                  if (splitRuns.length < 2) return null;

                  // Build chart data: one point per run, chronological
                  const trendData = splitRuns.map(r => ({
                    date: r.date.slice(5),          // MM-DD
                    fullDate: r.date,
                    miles: r.miles,
                    fade: r.paceFadeSec != null ? +r.paceFadeSec.toFixed(1) : null,
                    sigma: r.splitConsistency,
                    hrDrift: r.hrDrift != null ? +r.hrDrift.toFixed(1) : null,
                    avgPaceSec: r.paceSec,
                    avgHR: r.avgHR,
                    paceLabel: r.paceLabel,
                  }));

                  // Compute simple trend direction for each metric (last half vs first half)
                  const trendDir = (arr, key) => {
                    const vals = arr.filter(d => d[key] != null);
                    if (vals.length < 3) return null;
                    const mid = Math.floor(vals.length / 2);
                    const early = vals.slice(0, mid).reduce((s,d)=>s+d[key],0)/mid;
                    const late  = vals.slice(-mid).reduce((s,d)=>s+d[key],0)/mid;
                    return { early: +early.toFixed(1), late: +late.toFixed(1), delta: +(late - early).toFixed(1) };
                  };

                  const fadeTrend   = trendDir(trendData, 'fade');
                  const sigmaTrend  = trendDir(trendData, 'sigma');
                  const hrDriftTrend = trendDir(trendData, 'hrDrift');
                  const paceTrend   = trendDir(trendData, 'avgPaceSec');

                  // Trend summary chips
                  const chips = [
                    fadeTrend ? {
                      label: "Pace fade",
                      icon: fadeTrend.delta < -10 ? "↓" : fadeTrend.delta > 10 ? "↑" : "→",
                      value: `${fadeTrend.late > 0 ? "+" : ""}${fadeTrend.late}s`,
                      sub: fadeTrend.delta < -10 ? "improving" : fadeTrend.delta > 10 ? "worsening" : "stable",
                      color: fadeTrend.late <= 20 ? C.green : fadeTrend.late <= 60 ? C.amber : C.red,
                      tip: "Last mile vs first mile. Positive = slowed down. Goal: under 20s.",
                    } : null,
                    sigmaTrend ? {
                      label: "Split σ",
                      icon: sigmaTrend.delta < -5 ? "↓" : sigmaTrend.delta > 5 ? "↑" : "→",
                      value: `±${sigmaTrend.late}s`,
                      sub: sigmaTrend.delta < -5 ? "more consistent" : sigmaTrend.delta > 5 ? "less consistent" : "stable",
                      color: sigmaTrend.late < 20 ? C.green : sigmaTrend.late < 40 ? C.amber : C.red,
                      tip: "Standard deviation of mile paces. Lower = more even effort throughout.",
                    } : null,
                    hrDriftTrend ? {
                      label: "HR drift",
                      icon: hrDriftTrend.delta < -3 ? "↓" : hrDriftTrend.delta > 3 ? "↑" : "→",
                      value: `${hrDriftTrend.late > 0 ? "+" : ""}${hrDriftTrend.late} bpm`,
                      sub: hrDriftTrend.delta < -3 ? "improving" : hrDriftTrend.delta > 3 ? "worsening" : "stable",
                      color: Math.abs(hrDriftTrend.late) < 8 ? C.green : Math.abs(hrDriftTrend.late) < 16 ? C.amber : C.red,
                      tip: "Last mile HR minus first mile HR. Cardiac drift — smaller = better aerobic endurance.",
                    } : null,
                    paceTrend ? {
                      label: "Long run pace",
                      icon: paceTrend.delta < -10 ? "↑" : paceTrend.delta > 10 ? "↓" : "→",
                      value: paceSecToLabel(Math.round(paceTrend.late)),
                      sub: paceTrend.delta < -10 ? "getting faster" : paceTrend.delta > 10 ? "slowing" : "holding",
                      color: paceTrend.delta < -10 ? C.green : paceTrend.delta > 10 ? C.amber : C.bofaBlue,
                      tip: "Average long run pace trend. Getting faster at same effort = aerobic adaptation.",
                    } : null,
                  ].filter(Boolean);

                  return (
                    <div style={{ borderTop:`1px solid ${C.light}`, paddingTop:16 }}>
                      <p style={{ color:C.navy, fontSize:15, fontWeight:700, margin:"0 0 4px" }}>Long Run Trends</p>
                      <p style={{ color:C.midGray, fontSize:13, margin:"0 0 14px" }}>
                        Across {splitRuns.length} long runs with split data — pacing quality and physiological markers over time.
                      </p>

                      {/* Summary chips row */}
                      <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr 1fr" : `repeat(${chips.length},1fr)`, gap:10, marginBottom:20 }}>
                        {chips.map(chip => (
                          <div key={chip.label} title={chip.tip} style={{ background:C.offWhite, borderRadius:8, padding:"11px 13px", borderLeft:`3px solid ${chip.color}` }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                              <p style={{ color:C.midGray, fontSize:10, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", margin:"0 0 3px" }}>{chip.label}</p>
                              <span style={{ fontSize:14 }}>{chip.icon}</span>
                            </div>
                            <p style={{ color:chip.color, fontSize:20, fontWeight:900, margin:"0 0 2px", lineHeight:1 }}>{chip.value}</p>
                            <p style={{ color:C.midGray, fontSize:11, margin:0 }}>{chip.sub}</p>
                          </div>
                        ))}
                      </div>

                      {/* Dual chart: Pace Fade + HR Drift over time */}
                      {trendData.filter(d => d.fade != null || d.hrDrift != null).length >= 3 && (() => {
                        const chartRows = trendData.filter(d => d.fade != null || d.hrDrift != null);
                        return (
                          <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap:16, marginBottom:16 }}>
                            {/* Pace Fade trend */}
                            {chartRows.some(d => d.fade != null) && (
                              <div>
                                <p style={{ color:C.navy, fontSize:13, fontWeight:700, margin:"0 0 6px" }}>
                                  Pace Fade per Run <span style={{ color:C.midGray, fontWeight:400, fontSize:12 }}>(last mi − first mi)</span>
                                </p>
                                <ResponsiveContainer width="100%" height={130}>
                                  <ComposedChart data={chartRows} margin={{ top:4, right:8, bottom:16, left:0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                                    <XAxis dataKey="date" tick={{ fill:C.midGray, fontSize:10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill:C.midGray, fontSize:10 }} unit="s" axisLine={false} tickLine={false} width={28} />
                                    <ReferenceLine y={0} stroke={C.green} strokeDasharray="3 2" />
                                    <ReferenceLine y={20} stroke={C.amber} strokeDasharray="3 2" label={{ value:"20s", fill:C.amber, fontSize:9, position:"insideTopRight" }} />
                                    <ReferenceLine y={60} stroke={C.red} strokeDasharray="3 2" label={{ value:"60s", fill:C.red, fontSize:9, position:"insideTopRight" }} />
                                    <Tooltip
                                      contentStyle={{ fontSize:12, padding:"6px 10px" }}
                                      formatter={(v, n) => [v != null ? `${v > 0 ? "+" : ""}${v}s` : "—", "Fade"]}
                                      labelFormatter={(_, p) => p?.[0]?.payload?.fullDate ?? ""}
                                    />
                                    <Bar dataKey="fade" radius={[3,3,0,0]} barSize={18}>
                                      {chartRows.map((e,i) => (
                                        <Cell key={i} fill={e.fade == null ? C.light : e.fade <= 20 ? C.green : e.fade <= 60 ? C.amber : C.red} />
                                      ))}
                                    </Bar>
                                    <Line type="monotone" dataKey="fade" stroke={C.navy} strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />
                                  </ComposedChart>
                                </ResponsiveContainer>
                              </div>
                            )}

                            {/* HR Drift trend */}
                            {chartRows.some(d => d.hrDrift != null) && (
                              <div>
                                <p style={{ color:C.navy, fontSize:13, fontWeight:700, margin:"0 0 6px" }}>
                                  HR Drift per Run <span style={{ color:C.midGray, fontWeight:400, fontSize:12 }}>(last mi − first mi)</span>
                                </p>
                                <ResponsiveContainer width="100%" height={130}>
                                  <ComposedChart data={chartRows} margin={{ top:4, right:8, bottom:16, left:0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                                    <XAxis dataKey="date" tick={{ fill:C.midGray, fontSize:10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill:C.midGray, fontSize:10 }} unit=" bpm" axisLine={false} tickLine={false} width={36} />
                                    <ReferenceLine y={0} stroke={C.green} strokeDasharray="3 2" />
                                    <ReferenceLine y={8} stroke={C.amber} strokeDasharray="3 2" label={{ value:"8", fill:C.amber, fontSize:9, position:"insideTopRight" }} />
                                    <ReferenceLine y={16} stroke={C.red} strokeDasharray="3 2" label={{ value:"16", fill:C.red, fontSize:9, position:"insideTopRight" }} />
                                    <Tooltip
                                      contentStyle={{ fontSize:12, padding:"6px 10px" }}
                                      formatter={(v, n) => [v != null ? `${v > 0 ? "+" : ""}${v} bpm` : "—", "HR drift"]}
                                      labelFormatter={(_, p) => p?.[0]?.payload?.fullDate ?? ""}
                                    />
                                    <Bar dataKey="hrDrift" radius={[3,3,0,0]} barSize={18}>
                                      {chartRows.map((e,i) => (
                                        <Cell key={i} fill={e.hrDrift == null ? C.light : Math.abs(e.hrDrift) < 8 ? C.green : Math.abs(e.hrDrift) < 16 ? C.amber : C.red} />
                                      ))}
                                    </Bar>
                                    <Line type="monotone" dataKey="hrDrift" stroke={C.navy} strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />
                                  </ComposedChart>
                                </ResponsiveContainer>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Split consistency over time */}
                      {trendData.filter(d => d.sigma != null).length >= 3 && (
                        <div style={{ marginBottom:16 }}>
                          <p style={{ color:C.navy, fontSize:13, fontWeight:700, margin:"0 0 6px" }}>
                            Pacing Consistency (σ) <span style={{ color:C.midGray, fontWeight:400, fontSize:12 }}>std dev of mile paces — lower is more even</span>
                          </p>
                          <ResponsiveContainer width="100%" height={110}>
                            <ComposedChart data={trendData.filter(d => d.sigma != null)} margin={{ top:4, right:8, bottom:16, left:0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                              <XAxis dataKey="date" tick={{ fill:C.midGray, fontSize:10 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fill:C.midGray, fontSize:10 }} unit="s" axisLine={false} tickLine={false} width={28} domain={[0,"auto"]} />
                              <ReferenceLine y={20} stroke={C.green} strokeDasharray="3 2" label={{ value:"20s", fill:C.green, fontSize:9, position:"insideTopRight" }} />
                              <ReferenceLine y={40} stroke={C.amber} strokeDasharray="3 2" label={{ value:"40s", fill:C.amber, fontSize:9, position:"insideTopRight" }} />
                              <Tooltip
                                contentStyle={{ fontSize:12, padding:"6px 10px" }}
                                formatter={(v) => [`±${v}s/mi`, "Split σ"]}
                                labelFormatter={(_, p) => p?.[0]?.payload?.fullDate ?? ""}
                              />
                              <Bar dataKey="sigma" radius={[3,3,0,0]} barSize={18}>
                                {trendData.filter(d => d.sigma != null).map((e,i) => (
                                  <Cell key={i} fill={e.sigma < 20 ? C.green : e.sigma < 40 ? C.amber : C.red} />
                                ))}
                              </Bar>
                              <Line type="monotone" dataKey="sigma" stroke={C.navy} strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Run-by-run summary table */}
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:F, fontSize:12 }}>
                          <thead>
                            <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                              {["Date","Miles","Avg Pace","Avg HR","Fade","σ Splits","HR Drift"].map(h => (
                                <th key={h} style={{ textAlign: h==="Date"?"left":"right", padding:"5px 8px", color:C.midGray, fontSize:10, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {trendData.slice().reverse().map((r, i) => (
                              <tr key={r.fullDate+i} style={{ borderBottom:`1px solid ${C.light}`, background: i%2===0 ? "transparent" : C.offWhite+"60" }}>
                                <td style={{ padding:"6px 8px", fontWeight:600, fontSize:12, color:C.navy }}>{fmtDate(r.fullDate)}</td>
                                <td style={{ textAlign:"right", padding:"6px 8px", fontWeight:700, fontSize:12, color:r.miles>=18?C.red:r.miles>=13?C.navy:C.darkGray }}>{r.miles.toFixed(1)}</td>
                                <td style={{ textAlign:"right", padding:"6px 8px", fontFamily:"monospace", fontSize:12, color:C.midGray }}>{r.paceLabel}/mi</td>
                                <td style={{ textAlign:"right", padding:"6px 8px", fontSize:12, fontWeight:600, color:r.avgHR ? hrColor(r.avgHR) : C.midGray }}>{r.avgHR ? `${Math.round(r.avgHR)}` : "—"}</td>
                                <td style={{ textAlign:"right", padding:"6px 8px", fontSize:12, fontWeight:600,
                                  color: r.fade == null ? C.midGray : r.fade <= 20 ? C.green : r.fade <= 60 ? C.amber : C.red }}>
                                  {r.fade != null ? (r.fade > 0 ? `+${Math.round(r.fade)}s` : `${Math.round(r.fade)}s ↓`) : "—"}
                                </td>
                                <td style={{ textAlign:"right", padding:"6px 8px", fontSize:12, fontWeight:600,
                                  color: r.sigma == null ? C.midGray : r.sigma < 20 ? C.green : r.sigma < 40 ? C.amber : C.red }}>
                                  {r.sigma != null ? `±${r.sigma}s` : "—"}
                                </td>
                                <td style={{ textAlign:"right", padding:"6px 8px", fontSize:12, fontWeight:600,
                                  color: r.hrDrift == null ? C.midGray : Math.abs(r.hrDrift) < 8 ? C.green : Math.abs(r.hrDrift) < 16 ? C.amber : C.red }}>
                                  {r.hrDrift != null ? `${r.hrDrift > 0 ? "+" : ""}${Math.round(r.hrDrift)} bpm` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p style={{ color:C.midGray, fontSize:11, margin:"8px 0 0", lineHeight:1.5 }}>
                          <strong style={{ color:C.darkGray }}>Fade</strong> = last mi − first mi pace. <strong style={{ color:C.darkGray }}>σ</strong> = pace std dev across all miles. <strong style={{ color:C.darkGray }}>HR drift</strong> = last mi − first mi heart rate. Color: <span style={{ color:C.green }}>●</span> good · <span style={{ color:C.amber }}>●</span> moderate · <span style={{ color:C.red }}>●</span> high.
                        </p>
                      </div>
                    </div>
                  );
                })()}

              </div>
            </section>

            {/* ═══ CRITICAL PACE ESTIMATES ═══ */}
            <section style={{ marginBottom: isMob ? 32 : 48 }}>
              <SecTitle title="Critical Pace Estimates" color={C.navy} />
              <p style={{ color:C.midGray, fontSize:14, margin:"0 0 20px" }}>
                Best recent efforts from the last 25 runs, projected using the Riegel formula (T₂ = T₁ × (D₂/D₁)^1.06). Longer source runs yield more accurate marathon predictions.
              </p>

              {/* Marathon finish hero card with Diddy tracker */}
              {(() => {
                const DIDDY_SEC = 4*3600 + 14*60 + 52; // 4:14:52
                const DIDDY_FMT = "4:14:52";
                // Use the uploaded Diddy running photos as background
                const DIDDY_IMG_1 = "/rapper-sean-p-diddy-combs-celebrates-after-running-the-new-news-photo-1676673813.avif";
                const DIDDY_IMG_2 = "/rapper-sean-p-diddy-combs-crosses-the-finish-line-after-news-photo-1675893152.avif";
                const marathonSec = (() => {
                  const f = criticalPaceData.marathonFinish;
                  if (!f || f === "—") return null;
                  const parts = f.split(":").map(Number);
                  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
                  if (parts.length === 2) return parts[0]*3600 + parts[1]*60;
                  return null;
                })();
                const aheadOfDiddy = marathonSec != null && marathonSec < DIDDY_SEC;
                const diffSec = marathonSec != null ? Math.abs(marathonSec - DIDDY_SEC) : null;
                const diffMin = diffSec != null ? Math.floor(diffSec/60) : null;
                const fmtDiff = diffSec != null
                  ? diffSec < 60 ? `${diffSec}s`
                  : diffSec < 3600 ? `${Math.floor(diffSec/60)}m ${diffSec%60}s`
                  : `${Math.floor(diffSec/3600)}h ${Math.floor((diffSec%3600)/60)}m`
                  : null;

                // Scoring — expectation is you should beat Diddy easily. Being close is failing.
                const getDiddyScore = () => {
                  if (marathonSec == null) return { grade:"?", label:"Data Pending", desc:"Not enough run data to calculate your Diddy Score™. Log more miles.", color:"rgba(255,255,255,0.4)", emoji:"🔒", scoreNum: null };
                  if (aheadOfDiddy) {
                    if (diffMin > 60) return { grade:"S+", label:"Untouchable", desc:`${fmtDiff} faster. This is what it's supposed to look like.`, color:"#ffd700", emoji:"👑", scoreNum: 100 };
                    if (diffMin > 30) return { grade:"S",  label:"Dominant", desc:`${fmtDiff} faster. You're done before he sees the finish line. Keep it up.`, color:"#6ef0a0", emoji:"🏆", scoreNum: 80 };
                    if (diffMin > 10) return { grade:"B+", label:"Ahead, But Not By Enough", desc:`${fmtDiff} faster. You're winning — but the margin is embarrassingly thin. You should be lapping this man.`, color:"#7ee8a2", emoji:"😐", scoreNum: 58 };
                    return { grade:"C+", label:"Barely Winning", desc:`Only ${fmtDiff} faster. This is not a victory. This is a near-miss.`, color:"#a8edbb", emoji:"😬", scoreNum: 42 };
                  } else {
                    if (diffMin < 5)  return { grade:"C",  label:"Get faster so you won't get Diddled", desc:null, color:"#ffd080", emoji:"⚠️", scoreNum: 32 };
                    if (diffMin < 15) return { grade:"D+", label:"Getting Diddled", desc:`He's already in the finisher tent. You are getting Diddled right now.`, color:"#ffaa60", emoji:"😤", scoreNum: 20 };
                    if (diffMin < 30) return { grade:"D",  label:"Badly Diddled", desc:`You are getting thoroughly Diddled. Run more.`, color:"#ff8c42", emoji:"🔥", scoreNum: 10 };
                    if (diffMin < 60) return { grade:"F",  label:"Completely Diddled", desc:`You've been Diddled at every mile marker. This needs a full reset.`, color:"#ff6b6b", emoji:"💀", scoreNum: 4 };
                    return { grade:"F-", label:"Diddled Into Oblivion", desc:`At this pace, Diddy doesn't even know you're racing.`, color:"#ff4757", emoji:"☠️", scoreNum: 0 };
                  }
                };
                const score = getDiddyScore();
                return (
                  <div style={{ borderRadius:14, marginBottom:20, overflow:"hidden", boxShadow:"0 12px 40px rgba(1,33,105,0.28)", position:"relative" }}>
                    {/* Background: two Diddy running photos side by side */}
                    <div style={{ position:"absolute", inset:0, zIndex:0 }}>
                      <div style={{ position:"absolute", inset:0, display:"flex" }}>
                        <img src={DIDDY_IMG_2} alt="" style={{ width:"50%", height:"100%", objectFit:"cover", objectPosition:"center 20%" }} onError={e=>e.currentTarget.style.display="none"} />
                        <img src={DIDDY_IMG_1} alt="" style={{ width:"50%", height:"100%", objectFit:"cover", objectPosition:"center 30%" }} onError={e=>e.currentTarget.style.display="none"} />
                      </div>
                      <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg, rgba(0,8,30,0.92) 0%, rgba(1,15,50,0.87) 40%, rgba(0,0,0,0.82) 100%)" }} />
                    </div>

                    {/* Content */}
                    <div style={{ position:"relative", zIndex:1, padding: isMob ? "20px 18px" : "26px 32px" }}>
                      {/* Top: title + race info */}
                      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:14, marginBottom:16 }}>
                        <div>
                          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                            <span style={{ fontSize:20 }}>🎯</span>
                            <p style={{ color:"rgba(255,255,255,0.9)", fontSize:14, fontWeight:800, letterSpacing:"0.12em", textTransform:"uppercase", margin:0 }}>Diddy Tracker™</p>
                          </div>
                          <p style={{ color:C.white, fontSize: isMob ? 38 : 52, fontWeight:900, margin:"0 0 4px", lineHeight:1, letterSpacing:"-0.04em", textShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                            {criticalPaceData.marathonFinish ?? "—"}
                          </p>
                          <p style={{ color:"rgba(255,255,255,0.5)", fontSize:13, margin:0 }}>
                            Projected finish · {criticalPaceData.predSource ? `based on ${criticalPaceData.predSource}` : "add longer runs to unlock"}
                          </p>
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          <p style={{ color:"rgba(255,255,255,0.45)", fontSize:11, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", margin:"0 0 4px" }}>Race Day</p>
                          <p style={{ color:C.white, fontSize:17, fontWeight:700, margin:0 }}>Oct 11, 2026</p>
                          <p style={{ color:"rgba(255,255,255,0.4)", fontSize:12, margin:"4px 0 0" }}>Chicago Marathon · 7:30am</p>
                        </div>
                      </div>

                      {/* Divider */}
                      <div style={{ height:1, background:"rgba(255,255,255,0.12)", marginBottom:18 }} />

                      {/* Diddy Score™ section */}
                      <div style={{ display:"flex", alignItems:"center", gap: isMob ? 14 : 22, flexWrap:"wrap" }}>
                        {/* Grade badge + numeric score */}
                        <div style={{
                          width: isMob ? 72 : 92, flexShrink:0,
                          border:`3px solid ${score.color}`,
                          borderRadius:12,
                          background:`${score.color}20`,
                          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                          boxShadow:`0 0 28px ${score.color}45`,
                          padding:"10px 6px",
                        }}>
                          <p style={{ color:score.color, fontSize: isMob ? 26 : 34, fontWeight:900, margin:0, lineHeight:1, letterSpacing:"-0.03em" }}>{score.grade}</p>
                          {score.scoreNum != null && (
                            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:10, fontWeight:700, margin:"4px 0 0", letterSpacing:"0.04em" }}>{score.scoreNum}/100</p>
                          )}
                          <p style={{ color:"rgba(255,255,255,0.35)", fontSize:9, fontWeight:700, letterSpacing:"0.1em", margin:"2px 0 0", textTransform:"uppercase" }}>Diddy Score</p>
                        </div>

                        {/* Main verdict */}
                        <div style={{ flex:1, minWidth:150 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                            <span style={{ fontSize: isMob ? 18 : 22 }}>{score.emoji}</span>
                            <p style={{ color:score.color, fontSize: isMob ? 16 : 20, fontWeight:900, margin:0, letterSpacing:"-0.01em", lineHeight:1.2 }}>{score.label}</p>
                          </div>
                          {score.desc && <p style={{ color:"rgba(255,255,255,0.65)", fontSize: isMob ? 12 : 13, margin:"0 0 10px", lineHeight:1.55 }}>{score.desc}</p>}
                          {/* Progress bar: you vs Diddy */}
                          {marathonSec != null && (
                            <div>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                                <span style={{ color:"rgba(255,255,255,0.5)", fontSize:10, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase" }}>You</span>
                                <span style={{ color:"rgba(255,255,255,0.5)", fontSize:10, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase" }}>Diddy ({DIDDY_FMT})</span>
                              </div>
                              <div style={{ height:8, background:"rgba(255,255,255,0.12)", borderRadius:4, overflow:"hidden", position:"relative" }}>
                                {/* reference line at Diddy's position */}
                                <div style={{ position:"absolute", top:0, bottom:0, left:`${Math.min((DIDDY_SEC/Math.max(DIDDY_SEC,marathonSec))*100,100)}%`, width:2, background:"rgba(255,215,0,0.6)", zIndex:2 }} />
                                <div style={{
                                  height:"100%",
                                  width:`${Math.min((Math.min(marathonSec,DIDDY_SEC)/Math.max(DIDDY_SEC,marathonSec))*100,100)}%`,
                                  background:`linear-gradient(90deg,${score.color},${score.color}bb)`,
                                  borderRadius:4
                                }} />
                              </div>
                              <p style={{ color:score.color, fontSize: isMob ? 14 : 16, fontWeight:700, margin:"8px 0 0", textAlign:"center" }}>
                                {aheadOfDiddy ? `🏃 You finish ${fmtDiff} before Diddy` : `🐌 Diddy finishes ${fmtDiff} before you`}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Best efforts grid */}
              <div style={{ display:"grid", gridTemplateColumns: isMob ? "repeat(2,1fr)" : "repeat(3,1fr)", gap:14, marginBottom:20 }}>
                {[
                  { label:"Best Mile",            sub:"0.9–1.4 mi",  value:criticalPaceData.bestMilePace,  color:C.green,    flag:"1M"     },
                  { label:"Best Tempo",            sub:"3–5 mi",      value:criticalPaceData.bestTempoPace, color:C.bofaBlue, flag:"TEMPO"  },
                  { label:"Best 10K-distance",     sub:"5.5–7 mi",    value:criticalPaceData.best10KPace,   color:C.navy,     flag:"10K"    },
                  { label:"Best Half-Marathon",    sub:"11–14 mi",    value:criticalPaceData.bestHMPace,    color:C.amber,    flag:"HM"     },
                  { label:"Best Long Run",         sub:"14+ mi",      value:criticalPaceData.bestLongPace,  color:C.red,      flag:"LONG"   },
                  { label:"Predicted Marathon Pace", sub:"Riegel",    value:criticalPaceData.marathonPred,  color:C.red,      flag:"GOAL"   },
                ].map(p=>(
                  <div key={p.label} style={{
                    background:C.white, border:`1px solid ${p.value?C.border:C.light}`,
                    borderTop:`4px solid ${p.color}`,
                    borderRadius:8, padding:"16px 18px",
                    boxShadow:"0 2px 8px rgba(1,33,105,0.05)",
                    opacity:p.value?1:0.45,
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <p style={{ color:C.midGray, fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", margin:0, fontWeight:600 }}>{p.label}</p>
                      <span style={{ fontSize:10, fontWeight:700, color:p.color, border:`1px solid ${p.color}`, borderRadius:3, padding:"1px 5px" }}>{p.flag}</span>
                    </div>
                    <p style={{ color:p.color, fontSize:30, fontWeight:900, margin:"0 0 3px", lineHeight:1, letterSpacing:"-0.02em" }}>
                      {p.value??"—"}<span style={{ fontSize:13, fontWeight:400, color:C.midGray, marginLeft:3 }}>/mi</span>
                    </p>
                    <p style={{ color:C.midGray, fontSize:12, margin:0 }}>{p.sub}</p>
                  </div>
                ))}
              </div>

              {/* Training zones */}
              {criticalPaceData.easyZoneHigh && (
                <div style={{ background:C.offWhite, borderRadius:10, padding:"16px 20px", border:`1px solid ${C.border}` }}>
                  <p style={{ color:C.navy, fontSize:14, fontWeight:700, margin:"0 0 4px" }}>Training Zones (Jack Daniels VDOT)</p>
                  <p style={{ color:C.midGray, fontSize:12, margin:"0 0 12px" }}>Derived from your best 10K-distance effort. Use these as pace targets for each workout type.</p>
                  <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "repeat(3,1fr)", gap:10 }}>
                    {[
                      { label:"Easy / Long Run",     range:`${criticalPaceData.easyZoneHigh} – ${criticalPaceData.easyZoneLow}`, desc:"Daily runs & long runs. HR under 150.", color:C.green },
                      { label:"Tempo / Threshold",   range:criticalPaceData.tempoZone,                                            desc:"20–40 min sustained. Builds lactate threshold.", color:C.amber },
                      { label:"Marathon Pace",       range:criticalPaceData.mpZone??criticalPaceData.marathonPred,                desc:"Practice on long run last 2–4 miles.",  color:C.red },
                    ].map(z=>(
                      <div key={z.label} style={{ background:C.white, borderRadius:6, padding:"12px 14px", borderLeft:`3px solid ${z.color}` }}>
                        <p style={{ color:C.midGray, fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", margin:"0 0 4px" }}>{z.label}</p>
                        <p style={{ color:z.color, fontSize:21, fontWeight:900, margin:"0 0 4px", lineHeight:1 }}>{z.range??"—"}<span style={{ fontSize:13, fontWeight:400, color:C.midGray }}>/mi</span></p>
                        <p style={{ color:C.midGray, fontSize:12, margin:0, lineHeight:1.4 }}>{z.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ═══ TRAINING PATTERNS ═══ */}
            <section style={{ marginBottom: isMob ? 32 : 48 }}>
              <SecTitle title="Training Patterns" color={C.bofaBlue}
                toggleOptions={[{id:'dow',label:'Day of Week'},{id:'tod',label:'Time of Day'}]}
                toggleValue={patView} onToggle={setPatView} />
              <p style={{ color:C.midGray, fontSize:14, margin:"0 0 6px" }}>
                How your training distributes across the week and day of training — revealing scheduling habits, recovery cycles, and race-day alignment.
              </p>
              <p style={{ color:C.midGray, fontSize:13, margin:"0 0 18px", lineHeight:1.55 }}>
                <strong style={{ color:C.navy, fontStyle:"normal" }}>Methodology: Day-of-week</strong> aggregates all runs by the day they started (Mon–Sun). Bar height = average mileage per run on that day; circle = average HR.
                {" "}<strong style={{ color:C.navy, fontStyle:"normal" }}>Time-of-day</strong> uses fixed windows based on start hour. Chicago Marathon starts at <strong style={{ color:C.red }}>7:30am</strong> — morning runs are your most race-specific data. Comparing morning HR vs afternoon/evening reveals your typical circadian HR offset (usually 2–5 bpm higher in the morning at equal effort).
              </p>
              {(() => {
                return (
                  <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                    {patView==='dow' && (
                      <div>
                        <p style={{ color:C.midGray, fontSize:13, margin:"0 0 16px", lineHeight:1.5 }}>
                          Bars show average miles per run on each day. Dots show average HR — <span style={{ color:C.green }}>green = easy (&lt;150)</span>, <span style={{ color:C.amber }}>amber = moderate</span>, <span style={{ color:C.red }}>red = hard</span>. Days with no bar = rest days.
                        </p>
                        <div style={{ display:"grid", gridTemplateColumns: isMob ? "repeat(4,1fr)" : "repeat(7,1fr)", gap: isMob ? 8 : 10, marginBottom:20 }}>
                          {dowStats.map(d => {
                            const maxMiles = Math.max(...dowStats.map(x=>x.avgMiles), 0.1);
                            const barH = Math.round((d.avgMiles/maxMiles)*80);
                            const hrColor = d.avgHR ? (d.avgHR > 165 ? C.red : d.avgHR > 152 ? C.amber : C.green) : C.border;
                            return (
                              <div key={d.day} style={{ textAlign:"center" }}>
                                <p style={{ color:C.navy, fontSize:13, fontWeight:700, margin:"0 0 6px" }}>{d.day}</p>
                                <div style={{ display:"flex", justifyContent:"center", alignItems:"flex-end", height:90, marginBottom:8 }}>
                                  <div style={{ width:28, height:barH||4,
                                    background:d.runs===0?C.light:d.avgMiles>8?C.red:d.avgMiles>5?C.navy:C.bofaBlue+"99",
                                    borderRadius:"3px 3px 0 0", position:"relative",
                                    boxShadow:d.runs>0?"0 2px 4px rgba(1,33,105,0.12)":"none" }}>
                                    {d.runs>0 && barH>22 && (
                                      <span style={{ position:"absolute", top:-18, left:"50%", transform:"translateX(-50%)", fontSize:11, fontWeight:700, color:C.midGray, whiteSpace:"nowrap" }}>
                                        {d.avgMiles}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div style={{ display:"flex", justifyContent:"center", marginBottom:4 }}>
                                  <div style={{ width:24, height:24, borderRadius:"50%", background:d.avgHR?hrColor:C.light, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 1px 3px rgba(0,0,0,0.1)" }}>
                                    {d.avgHR && <span style={{ color:C.white, fontSize:9, fontWeight:700 }}>{d.avgHR}</span>}
                                  </div>
                                </div>
                                <p style={{ color:C.midGray, fontSize:11, margin:"2px 0 0" }}>{d.runs} runs</p>
                                <p style={{ color:C.midGray, fontSize:10, margin:0 }}>{d.miles} mi</p>
                              </div>
                            );
                          })}
                        </div>
                        {(() => {
                          const best = [...dowStats].filter(d=>d.runs>0).sort((a,b)=>b.avgMiles-a.avgMiles)[0];
                          // Compute true rest days: days within the season window that had zero runs
                          const restDayCount = (() => {
                            if (!firstRunDate || !lastRunDate) return 0;
                            const start = new Date(firstRunDate+"T12:00:00");
                            const end   = new Date(lastRunDate+"T12:00:00");
                            const runDates = new Set(runs.map(r=>r.date));
                            let count = 0;
                            const cur = new Date(start);
                            while (cur <= end) {
                              const key = cur.toISOString().slice(0,10);
                              if (!runDates.has(key)) count++;
                              cur.setDate(cur.getDate()+1);
                            }
                            return count;
                          })();
                          const totalSeasonDays = (() => {
                            if (!firstRunDate || !lastRunDate) return 0;
                            return Math.round((new Date(lastRunDate) - new Date(firstRunDate)) / 864e5) + 1;
                          })();
                          const restPct = totalSeasonDays > 0 ? Math.round(restDayCount/totalSeasonDays*100) : 0;
                          const avgRestPerWeek = totalSeasonDays > 0 ? +(restDayCount/(totalSeasonDays/7)).toFixed(1) : 0;
                          const hardDays = dowStats.filter(d=>d.avgHR&&d.avgHR>152&&d.runs>0);
                          return (
                            <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "repeat(3,1fr)", gap:10, borderTop:`1px solid ${C.light}`, paddingTop:14 }}>
                              {[
                                { label:"Heaviest Day", value:best?`${best.day} — ${best.avgMiles} mi avg`:"—", color:C.navy, desc:"Highest average mileage across all weeks" },
                                { label:"Rest Days", value:restDayCount>0?`${restDayCount} days (${avgRestPerWeek}/wk avg)`:"None logged", color:C.green, desc:`${restPct}% of season days — days with zero runs` },
                                { label:"Higher-HR Days", value:hardDays.length?hardDays.map(d=>d.day).join(", "):"None", color:C.amber, desc:"Avg HR >152 — watch grey-zone accumulation" },
                              ].map(s=>(
                                <div key={s.label} style={{ background:C.offWhite, borderRadius:6, padding:"12px 14px" }}>
                                  <p style={{ color:C.midGray, fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", margin:"0 0 4px" }}>{s.label}</p>
                                  <p style={{ color:s.color, fontSize:15, fontWeight:700, margin:"0 0 3px" }}>{s.value}</p>
                                  <p style={{ color:C.midGray, fontSize:11, margin:0 }}>{s.desc}</p>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {patView==='tod' && (
                      <div>
                        <p style={{ color:C.midGray, fontSize:13, margin:"0 0 16px", lineHeight:1.5 }}>
                          Your runs split by start time. <strong style={{ color:C.red }}>Chicago starts at 7:30am</strong> — morning sessions are your most race-relevant data. Expect HR to run 2–5 bpm higher in the morning due to cortisol and lower cardiac vagal tone.
                        </p>
                        {/* Summary stats row */}
                        {(() => {
                          const morn = timeOfDayStats.find(s=>s.id==='morning');
                          const aft  = timeOfDayStats.find(s=>s.id==='afternoon')||timeOfDayStats.find(s=>s.id==='midday');
                          const totalRuns = timeOfDayStats.reduce((s,x)=>s+x.count,0);
                          const morningPct = morn ? Math.round(morn.count/totalRuns*100) : 0;
                          const diff = morn?.avgHR && aft?.avgHR ? morn.avgHR - aft.avgHR : null;
                          return (
                            <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr 1fr" : "repeat(3,1fr)", gap:10, marginBottom:16 }}>
                              {[
                                { label:"Morning Runs", value:`${morn?.count ?? 0}`, sub:`${morningPct}% of all training`, color:C.red, icon:"🌅" },
                                { label:"Morning Avg HR", value:morn?.avgHR ? `${morn.avgHR} bpm` : "—", sub:morn?.avgHR ? (morn.avgHR<152?"✓ Easy aerobic":morn.avgHR<165?"Moderate":"Hard") : "no data", color:morn?.avgHR>165?C.red:morn?.avgHR>152?C.amber:C.green, icon:"❤️" },
                                { label:"HR Circadian Offset", value:diff!=null?`${diff>0?"+":""}${diff} bpm`:"—", sub:diff!=null?(Math.abs(diff)<=5?"✓ Normal range (2–5 bpm)":diff>5?"⚠️ Higher than typical":"Favorable — low morning HR"):"morning vs afternoon", color:diff!=null&&Math.abs(diff)<=6?C.green:C.amber, icon:"⏰" },
                              ].map(s=>(
                                <div key={s.label} style={{ background:C.offWhite, borderRadius:8, padding:"12px 14px", borderLeft:`3px solid ${s.color}` }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                                    <span style={{ fontSize:14 }}>{s.icon}</span>
                                    <p style={{ color:C.midGray, fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", margin:0 }}>{s.label}</p>
                                  </div>
                                  <p style={{ color:s.color, fontSize:20, fontWeight:800, margin:"0 0 2px", lineHeight:1 }}>{s.value}</p>
                                  <p style={{ color:C.midGray, fontSize:11, margin:0 }}>{s.sub}</p>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        {/* Time slot breakdown */}
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {timeOfDayStats.map(s => {
                            const paceLabel = s.avgPaceSec ? paceSecToLabel(Math.round(s.avgPaceSec)) : null;
                            const isRaceTime = s.id === "morning";
                            const maxRuns = Math.max(...timeOfDayStats.map(x=>x.count),1);
                            const barPct = Math.round((s.count/maxRuns)*100);
                            const hrColor = s.avgHR ? (s.avgHR>165?C.red:s.avgHR>152?C.amber:C.green) : C.midGray;
                            return (
                              <div key={s.id} style={{
                                background:C.white, border:`1px solid ${isRaceTime?C.red+"60":C.border}`,
                                borderLeft:`4px solid ${isRaceTime?C.red:s.color}`,
                                borderRadius:8, padding:"10px 14px",
                                boxShadow:isRaceTime?`0 2px 8px ${C.red}18`:"none",
                              }}>
                                <div style={{ display:"flex", alignItems:"center", gap:0, marginBottom:6, flexWrap:"wrap" }}>
                                  {/* Label + badge */}
                                  <div style={{ flex:1, display:"flex", alignItems:"center", gap:8, minWidth:120 }}>
                                    <p style={{ color:isRaceTime?C.red:C.darkGray, fontSize:13, fontWeight:700, margin:0 }}>{s.label}</p>
                                    <p style={{ color:C.midGray, fontSize:11, margin:0 }}>{s.hours}</p>
                                    {isRaceTime && <span style={{ fontSize:9, fontWeight:700, color:C.white, background:C.red, borderRadius:3, padding:"1px 5px", letterSpacing:"0.05em" }}>RACE TIME</span>}
                                  </div>
                                  {/* Stats chips */}
                                  <div style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
                                    <span style={{ color:s.color, fontSize:15, fontWeight:800 }}>{s.count}<span style={{ color:C.midGray, fontSize:10, fontWeight:400, marginLeft:2 }}>runs</span></span>
                                    <span style={{ color:C.midGray, fontSize:11 }}>{s.totalMiles} mi</span>
                                    {s.avgHR && <span style={{ color:hrColor, fontSize:12, fontWeight:700, background:hrColor+"15", padding:"1px 6px", borderRadius:10 }}>{s.avgHR} bpm</span>}
                                    {paceLabel && <span style={{ color:C.midGray, fontSize:11 }}>{paceLabel}/mi</span>}
                                  </div>
                                </div>
                                {/* Progress bar showing relative frequency */}
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ flex:1, height:5, background:C.light, borderRadius:3, overflow:"hidden" }}>
                                    <div style={{ height:"100%", width:`${barPct}%`, background:isRaceTime?C.red:s.color, borderRadius:3, transition:"width 0.4s ease" }} />
                                  </div>
                                  <span style={{ color:C.midGray, fontSize:10, flexShrink:0, width:28, textAlign:"right" }}>{Math.round(s.count/timeOfDayStats.reduce((a,x)=>a+x.count,0)*100)}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Race-day insight */}
                        {(() => {
                          const morn = timeOfDayStats.find(s=>s.id==='morning');
                          const aft  = timeOfDayStats.find(s=>s.id==='afternoon');
                          const eve  = timeOfDayStats.find(s=>s.id==='evening');
                          const nonMorningHR = [aft,eve].filter(Boolean).filter(s=>s.avgHR);
                          const avgNonMornHR = nonMorningHR.length ? Math.round(nonMorningHR.reduce((s,x)=>s+x.avgHR,0)/nonMorningHR.length) : null;
                          const diff = morn?.avgHR && avgNonMornHR ? morn.avgHR - avgNonMornHR : null;
                          if (!morn?.avgHR) return null;
                          return (
                            <div style={{ background:C.navy+"08", border:`1px solid ${C.navy}20`, borderLeft:`3px solid ${C.navy}`, borderRadius:8, padding:"12px 16px", marginTop:12 }}>
                              <p style={{ color:C.navy, fontSize:13, fontWeight:700, margin:"0 0 4px" }}>🏁 Race Day Projection</p>
                              <p style={{ color:C.midGray, fontSize:13, margin:0, lineHeight:1.6 }}>
                                {diff != null
                                  ? `Your morning HR runs ${Math.abs(diff)} bpm ${diff>0?"higher":"lower"} than other times of day — ${Math.abs(diff)<=5?"well within the normal 2–5 bpm circadian range. On race morning, don't panic your HR and back off pace.":"above the typical 2–5 bpm range. Account for this when pacing your first miles."} With ${morn.count} morning runs logged, you${morn.count>=10?" have a solid race-specific aerobic baseline.":" should aim to add more morning sessions before race day."}`
                                  : `Log more morning runs to build a race-specific aerobic baseline. Chicago starts at 7:30am.`}
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })()}
            </section>

            {/* ═══ RUNNING POWER ═══ */}
            {powerData && (
              <section style={{ marginBottom: isMob ? 32 : 48 }}>
                <SecTitle title="Running Power" color={C.bofaBlue} />
                <p style={{ color:C.midGray, fontSize:14, margin:"0 0 16px" }}>
                  Power output in watts. Higher power at lower HR = better efficiency.
                </p>
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:24 }}>
                    {[
                      { label:"Avg Power", value: powerData.avgPower, unit:"W", color:C.bofaBlue },
                      { label:"Max Power", value: powerData.maxPower, unit:"W", color:C.red },
                      { label:"Min Power", value: powerData.minPower, unit:"W", color:C.green },
                    ].map((p,i) => (
                      <div key={i} style={{ background:C.white, border:`1px solid ${p.color}40`, borderTop:`4px solid ${p.color}`, borderRadius:8, padding:"14px 16px", boxShadow:"0 2px 8px rgba(1,33,105,0.05)" }}>
                        <p style={{ color:C.midGray, fontSize:12, letterSpacing:"0.1em", textTransform:"uppercase", margin:"0 0 8px", fontWeight:600 }}>{p.label}</p>
                        <p style={{ color:p.color, fontSize:29, fontWeight:800, margin:"0 0 2px", lineHeight:1 }}>
                          {p.value}<span style={{ fontSize:13, fontWeight:400, color:C.midGray, marginLeft:2 }}>{p.unit}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                  {/* Power over time */}
                  <div style={{ marginBottom:24 }}>
                    <p style={{ color:C.navy, fontSize:15, fontWeight:600, margin:"0 0 8px" }}>Power Over Time</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={powerData.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize:12 }} axisLine={{ stroke:C.border }} tickLine={false} />
                        <YAxis tick={{ fontSize:12 }} axisLine={false} tickLine={false} unit=" W" />
                        <Tooltip contentStyle={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:6, fontSize:13 }} />
                        <Line type="monotone" dataKey="power" stroke={C.bofaBlue} strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Both scatter charts always visible */}
                  <div style={{ borderTop:`1px solid ${C.light}`, paddingTop:20 }}>
                    <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap:20 }}>
                      <div>
                        <p style={{ color:C.navy, fontSize:15, fontWeight:600, margin:"0 0 8px" }}>Power vs Heart Rate</p>
                        {powerData.powerRegHR && (
                          <p style={{ fontSize:13, color:C.midGray, marginBottom:4 }}>R² {(powerData.powerRegHR.r2*100).toFixed(0)}%</p>
                        )}
                        <ResponsiveContainer width="100%" height={180}>
                          <ScatterChart margin={{ top:5, right:5, bottom:20, left:0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={C.light} />
                            <XAxis type="number" dataKey="x" name="HR" domain={['auto','auto']} tick={{ fontSize:11 }} unit=" bpm" />
                            <YAxis type="number" dataKey="y" name="Power" domain={['auto','auto']} tick={{ fontSize:11 }} unit=" W" />
                            <Tooltip content={<PowerScatterTip />} />
                            <Scatter data={powerData.powerVsHR.map(d => ({ ...d, xType: 'hr' }))} fill={C.bofaBlue} opacity={0.7} r={3} />
                            {powerData.powerRegHR && (() => {
                              const xs = powerData.powerVsHR.map(d=>d.x);
                              const xMin = Math.min(...xs), xMax = Math.max(...xs);
                              return <Scatter data={[{x:xMin,y:powerData.powerRegHR.slope*xMin+powerData.powerRegHR.intercept},{x:xMax,y:powerData.powerRegHR.slope*xMax+powerData.powerRegHR.intercept}]}
                                fill="none" line={{ stroke:C.red, strokeWidth:1.5, strokeDasharray:"5 3" }} shape={()=>null} legendType="none" />;
                            })()}
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                      <div>
                        <p style={{ color:C.navy, fontSize:15, fontWeight:600, margin:"0 0 8px" }}>Power vs Pace</p>
                        {powerData.powerRegPace && (
                          <p style={{ fontSize:13, color:C.midGray, marginBottom:4 }}>R² {(powerData.powerRegPace.r2*100).toFixed(0)}%</p>
                        )}
                        <ResponsiveContainer width="100%" height={180}>
                          <ScatterChart margin={{ top:5, right:5, bottom:20, left:0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={C.light} />
                            <XAxis type="number" dataKey="x" name="Pace" domain={['auto','auto']} tick={{ fontSize:11 }} tickFormatter={v=>`${Math.floor(v/60)}:${String(v%60).padStart(2,"0")}`} />
                            <YAxis type="number" dataKey="y" name="Power" domain={['auto','auto']} tick={{ fontSize:11 }} unit=" W" />
                            <Tooltip content={<PowerScatterTip />} />
                            <Scatter data={powerData.powerVsPace.map(d => ({ ...d, xType: 'pace' }))} fill={C.navy} opacity={0.7} r={3} />
                            {powerData.powerRegPace && (() => {
                              const xs = powerData.powerVsPace.map(d=>d.x);
                              const xMin = Math.min(...xs), xMax = Math.max(...xs);
                              return <Scatter data={[{x:xMin,y:powerData.powerRegPace.slope*xMin+powerData.powerRegPace.intercept},{x:xMax,y:powerData.powerRegPace.slope*xMax+powerData.powerRegPace.intercept}]}
                                fill="none" line={{ stroke:C.red, strokeWidth:1.5, strokeDasharray:"5 3" }} shape={()=>null} legendType="none" />;
                            })()}
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

          </div>
        )}

        {tab==="report" && (
          <div>
            <div style={{ 
              background:`linear-gradient(105deg,${C.navy} 0%,${C.navyMid} 100%)`, 
              borderRadius:12, 
              padding:"24px 28px", 
              marginBottom:32, 
              borderLeft:`4px solid ${C.red}`,
              boxShadow:"0 8px 24px rgba(1,33,105,0.15)",
              position:"relative",
              overflow:"hidden"
            }}>
              <div style={{ position:"absolute", top:0, right:0, width:"30%", height:"100%", background:"linear-gradient(90deg, transparent, rgba(227,24,55,0.1))" }} />
              
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16, position:"relative", zIndex:1 }}>
                <div>
                  <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, letterSpacing:"0.13em", textTransform:"uppercase", margin:"0 0 8px", fontWeight:600 }}>
                    {weekInProgress ? "Current Week" : "Upcoming Week Target"}
                  </p>
                  <p style={{ color:C.white, fontSize:37, fontWeight:800, margin:0, letterSpacing:"-0.03em", lineHeight:1 }}>
                    {weekInProgress
                      ? <>{thisWeekMi} <span style={{ fontSize:19, fontWeight:400, opacity:0.6 }}>miles</span></>
                      : <>28–32 <span style={{ fontSize:19, fontWeight:400, opacity:0.6 }}>miles</span></>}
                  </p>
                  {weekInProgress && (
                    <p style={{ color:"rgba(255,255,255,0.6)", fontSize:15, margin:"6px 0 0" }}>
                      {thisWeekRuns.length} runs · {mToFt(thisWeekRuns.reduce((s,a)=>s+a.elev,0)).toLocaleString()} ft elevation
                    </p>
                  )}
                </div>
                <div style={{ textAlign:"right" }}>
                  {weekInProgress && prevCompletedMiles ? (
                    <>
                      <p style={{ color:"rgba(255,255,255,0.6)", fontSize:14, margin:"0 0 6px" }}>Previous week</p>
                      <p style={{ color:C.white, fontSize:25, fontWeight:700, margin:0 }}>{prevCompletedMiles} mi</p>
                      {projectedMi!==thisWeekMi && (
                        <p style={{ color:C.red, fontSize:15, fontWeight:500, margin:"4px 0 0" }}>Projected: ~{projectedMi} mi</p>
                      )}
                    </>
                  ) : !weekInProgress && prevCompletedMiles ? (
                    <>
                      <p style={{ color:"rgba(255,255,255,0.6)", fontSize:14, margin:"0 0 6px" }}>Last week</p>
                      <p style={{ color:C.white, fontSize:25, fontWeight:700, margin:0 }}>{thisWeekMi} mi</p>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <CoachReport
              summary={trainingSummary}
            />
          </div>
        )}

        {tab==="rawstats" && (() => {
          const COL_DEFS = [
            { key:"date",          label:"Date",       fmt: r => r.date,                                             align:"left"  },
            { key:"dist",          label:"Miles",      fmt: r => kmToMi(r.dist).toFixed(2),                         align:"right", num:true },
            { key:"pace",          label:"Pace",       fmt: r => r.pace ?? "—",                                     align:"right" },
            { key:"movingTimeSec", label:"Time",       fmt: r => r.movingTimeSec ? `${Math.floor(r.movingTimeSec/3600)?Math.floor(r.movingTimeSec/3600)+"h ":""}${Math.floor((r.movingTimeSec%3600)/60)}m ${Math.round(r.movingTimeSec%60)}s` : "—", align:"right" },
            { key:"avgHR",         label:"Avg HR",     fmt: r => r.avgHR ? `${Math.round(r.avgHR)} bpm` : "—",      align:"right", num:true },
            { key:"avgCadence",    label:"Cadence",    fmt: r => r.avgCadence ? `${Math.round(r.avgCadence)} spm` : "—", align:"right", num:true },
            { key:"timeOfDay",     label:"Time of Day",fmt: r => r.timeOfDay ?? "—",                                align:"left"  },
          ];

          // Sort + filter
          const filtered = [...runs].filter(r => {
            if (!runFilter) return true;
            const q = runFilter.toLowerCase();
            return r.date.includes(q) || (r.timeOfDay||"").includes(q) || (r.type||"").toLowerCase().includes(q);
          });
          const sorted = filtered.sort((a, b) => {
            const col = COL_DEFS.find(c => c.key === runSort.key);
            let av, bv;
            if (runSort.key === "date") { av = a.date; bv = b.date; }
            else if (runSort.key === "dist") { av = a.dist; bv = b.dist; }
            else if (runSort.key === "pace") { av = a.paceSec ?? 9999; bv = b.paceSec ?? 9999; }
            else if (runSort.key === "movingTimeSec") { av = a.movingTimeSec ?? 0; bv = b.movingTimeSec ?? 0; }
            else if (runSort.key === "avgHR") { av = a.avgHR ?? 0; bv = b.avgHR ?? 0; }
            else if (runSort.key === "maxHR") { av = a.maxHR ?? 0; bv = b.maxHR ?? 0; }
            else if (runSort.key === "elev") { av = a.elev ?? 0; bv = b.elev ?? 0; }
            else if (runSort.key === "avgCadence") { av = a.avgCadence ?? 0; bv = b.avgCadence ?? 0; }
            else if (runSort.key === "avgPower") { av = a.avgPower ?? 0; bv = b.avgPower ?? 0; }
            else if (runSort.key === "calories") { av = a.calories ?? 0; bv = b.calories ?? 0; }
            else { av = 0; bv = 0; }
            return runSort.dir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
          });

          const toggleSort = (key) => setRunSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });

          // Drill-in modal
          if (selectedRun) {
            const r = selectedRun;
            const fields = [
              { label:"Date",               value: r.date },
              { label:"Type",               value: r.indoor ? "Indoor Run" : "Outdoor Run" },
              { label:"Time of Day",        value: r.timeOfDay ?? "—" },
              { label:"Distance",           value: `${kmToMi(r.dist).toFixed(2)} mi (${r.dist.toFixed(2)} km)` },
              { label:"Duration",           value: r.movingTimeSec ? `${Math.floor(r.movingTimeSec/3600)?Math.floor(r.movingTimeSec/3600)+"h ":""}${Math.floor((r.movingTimeSec%3600)/60)}m ${Math.round(r.movingTimeSec%60)}s` : "—" },
              { label:"Pace",               value: r.pace ?? "—", unit:"/mi" },
              { label:"Avg Heart Rate",     value: r.avgHR ? `${Math.round(r.avgHR)} bpm` : "—", color: hrColor(r.avgHR) },
              { label:"Max Heart Rate",     value: r.maxHR ? `${Math.round(r.maxHR)} bpm` : "—", color: hrColor(r.maxHR) },
              { label:"Elevation Gain",     value: `${mToFt(r.elev).toLocaleString()} ft (${r.elev.toFixed(0)} m)` },
              { label:"Avg Cadence",        value: r.avgCadence ? `${Math.round(r.avgCadence)} spm` : "—" },
              { label:"Avg Power",          value: r.avgPower ? `${r.avgPower} W` : "—" },
              { label:"Avg Ground Contact", value: r.avgGroundContactTime ? `${r.avgGroundContactTime} ms` : "—" },
              { label:"Avg Vert Oscillation",value: r.avgVerticalOscillation ? `${r.avgVerticalOscillation} m` : "—" },
              { label:"Avg Stride Length",  value: r.avgStrideLength ? `${r.avgStrideLength} m` : "—" },
              { label:"Calories",           value: r.calories ? `${r.calories.toLocaleString()} kcal` : "—" },
              { label:"Temperature",        value: r.temperature != null ? `${r.temperature}°F` : "—" },
              { label:"Humidity",           value: r.humidity != null ? `${r.humidity}%` : "—" },
            ];
            return (
              <div>
                {/* Back button */}
                <button onClick={() => setSelectedRun(null)} style={{
                  display:"inline-flex", alignItems:"center", gap:6,
                  background:"none", border:`1px solid ${C.border}`, borderRadius:6,
                  padding:"7px 14px", fontSize:13, fontWeight:600, color:C.navy,
                  cursor:"pointer", fontFamily:F, marginBottom:20,
                }}>← Back to all runs</button>

                {/* Run header */}
                <div style={{ background:`linear-gradient(105deg,${C.navy},${C.navyMid})`, borderRadius:12, padding:"22px 28px", marginBottom:20, borderLeft:`4px solid ${C.red}` }}>
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:4 }}>
                    <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", margin:0 }}>Run Detail</p>
                    {r.stravaId && (
                      <a href={`https://www.strava.com/activities/${r.stravaId}`} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.6)", background:"rgba(255,255,255,0.1)", borderRadius:4, padding:"3px 9px", textDecoration:"none", border:"1px solid rgba(255,255,255,0.2)", whiteSpace:"nowrap", flexShrink:0 }}>
                        View on Strava ↗
                      </a>
                    )}
                  </div>
                  <p style={{ color:C.white, fontSize:28, fontWeight:900, margin:"0 0 4px", letterSpacing:"-0.02em" }}>{r.date}</p>
                  {r.stravaName && <p style={{ color:"rgba(255,255,255,0.5)", fontSize:14, fontStyle:"italic", margin:"0 0 8px" }}>{r.stravaName}</p>}
                  <div style={{ display:"flex", flexWrap:"wrap", gap:16 }}>
                    <span style={{ color:"rgba(255,255,255,0.8)", fontSize:16, fontWeight:700 }}>{kmToMi(r.dist).toFixed(2)} mi</span>
                    <span style={{ color:"rgba(255,255,255,0.6)", fontSize:15 }}>{r.pace}/mi</span>
                    {r.avgHR && <span style={{ color:"rgba(255,255,255,0.6)", fontSize:15 }}>{Math.round(r.avgHR)} bpm avg</span>}
                    {r.avgPower && <span style={{ color:"rgba(255,255,255,0.5)", fontSize:14 }}>{r.avgPower} W avg</span>}
                  </div>
                </div>

                {/* All fields grid */}
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                  <div style={{ display:"grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap: "0 32px" }}>
                    {fields.map((f, i) => (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.light}` }}>
                        <span style={{ color:C.midGray, fontSize:13 }}>{f.label}</span>
                        <span style={{ color:f.color || C.darkGray, fontSize:14, fontWeight:600 }}>{f.value}{f.unit ? <span style={{ color:C.midGray, fontWeight:400, marginLeft:2 }}>{f.unit}</span> : null}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Mile splits — Strava boundaries fused with Apple Health metrics */}
                {r.splits && r.splits.length > 0 && (() => {
                  const hasPace  = r.splits.some(s => s.paceSec);
                  const hasPower = r.splits.some(s => s.avgPower);
                  const hasGCT   = r.splits.some(s => s.avgGCT);
                  const hasVO    = r.splits.some(s => s.avgVO);
                  const hasHR    = r.splits.some(s => s.avgHR);
                  const fullMilesWithPace = r.splits.filter(s => s.distMiles != null && s.distMiles >= 0.85 && s.paceSec);
                  const fastest = fullMilesWithPace.length ? fullMilesWithPace.reduce((a,b) => a.paceSec < b.paceSec ? a : b) : null;
                  const slowest = fullMilesWithPace.length ? fullMilesWithPace.reduce((a,b) => a.paceSec > b.paceSec ? a : b) : null;
                  // Build chart data
                  const splitChartData = fullMilesWithPace.map(s => ({
                    mile: `mi ${s.mile}`,
                    paceSec: s.paceSec ? Math.round(s.paceSec) : null,
                    avgHR: s.avgHR ? Math.round(s.avgHR) : null,
                    avgPower: s.avgPower ? Math.round(s.avgPower) : null,
                  }));
                  const showSplitChart = splitChartData.length >= 2 && (hasPace || hasHR);
                  return (
                    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:card, boxShadow:"0 2px 12px rgba(1,33,105,0.06)", marginTop:16 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
                        <p style={{ color:C.navy, fontSize:16, fontWeight:700, margin:0 }}>Mile Splits ({r.splits.length})</p>
                        {r.stravaId && <span style={{ fontSize:11, color:C.midGray, background:C.light, padding:"2px 8px", borderRadius:10 }}>via Strava</span>}
                      </div>

                      {/* Split visualization chart */}
                      {showSplitChart && (
                        <div style={{ marginBottom:18 }}>
                          <p style={{ color:C.midGray, fontSize:11, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", margin:"0 0 8px" }}>
                            Pace progression{hasHR ? " & heart rate" : ""}
                          </p>
                          <ResponsiveContainer width="100%" height={150}>
                            <ComposedChart data={splitChartData} margin={{ top:4, right:hasPace&&hasHR?36:8, bottom:4, left:4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={C.light} vertical={false} />
                              <XAxis dataKey="mile" tick={{ fontSize:11, fill:C.midGray }} axisLine={{ stroke:C.border }} tickLine={false} />
                              {hasPace && (
                                <YAxis
                                  yAxisId="pace"
                                  orientation="left"
                                  tick={{ fontSize:10, fill:C.navy }}
                                  tickFormatter={v => `${Math.floor(v/60)}:${String(v%60).padStart(2,"0")}`}
                                  domain={['auto','auto']}
                                  reversed
                                  axisLine={false} tickLine={false} width={36}
                                />
                              )}
                              {hasHR && (
                                <YAxis
                                  yAxisId="hr"
                                  orientation="right"
                                  tick={{ fontSize:10, fill:C.red }}
                                  domain={['auto','auto']}
                                  axisLine={false} tickLine={false} width={30}
                                />
                              )}
                              <Tooltip
                                contentStyle={{ fontSize:12, fontFamily:F, border:`1px solid ${C.border}` }}
                                formatter={(v, name) => {
                                  if (name === "paceSec") return [`${Math.floor(v/60)}:${String(v%60).padStart(2,"00")}/mi`, "Pace"];
                                  if (name === "avgHR") return [`${v} bpm`, "HR"];
                                  if (name === "avgPower") return [`${v} W`, "Power"];
                                  return [v, name];
                                }}
                              />
                              {hasPace && (
                                <Line yAxisId="pace" type="monotone" dataKey="paceSec" stroke={C.navy} strokeWidth={2.5} dot={{ fill:C.navy, r:3 }} activeDot={{ r:5 }} connectNulls />
                              )}
                              {hasHR && (
                                <Line yAxisId="hr" type="monotone" dataKey="avgHR" stroke={C.red} strokeWidth={2} dot={{ fill:C.red, r:2 }} strokeDasharray="4 2" connectNulls />
                              )}
                            </ComposedChart>
                          </ResponsiveContainer>
                          <div style={{ display:"flex", gap:16, marginTop:4 }}>
                            {hasPace && <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:C.midGray }}><span style={{ width:14, height:2, background:C.navy, display:"inline-block" }} />Pace (left axis)</span>}
                            {hasHR && <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:C.midGray }}><span style={{ width:14, height:2, background:C.red, display:"inline-block", borderTop:"2px dashed "+C.red, borderBottom:"none" }} />HR (right axis)</span>}
                          </div>
                        </div>
                      )}
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:F, fontSize:13 }}>
                          <thead>
                            <tr style={{ background:C.offWhite, borderBottom:`2px solid ${C.border}` }}>
                              {[
                                { h:"Mile",    left:true  },
                                { h:"Pace",    left:false },
                                { h:"Time",    left:false },
                                { h:"HR avg/max", left:false },
                                hasPower && { h:"Power", left:false },
                                hasGCT   && { h:"GCT",   left:false },
                                hasVO    && { h:"Vert Osc", left:false },
                              ].filter(Boolean).map(col => (
                                <th key={col.h} style={{ textAlign:col.left?"left":"right", padding:"7px 10px", color:C.midGray, fontWeight:600, fontSize:11, letterSpacing:"0.06em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{col.h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.splits.map((s, i) => {
                              const timeLabel = s.movingTimeSec
                                ? `${Math.floor(s.movingTimeSec/60)}:${String(Math.round(s.movingTimeSec%60)).padStart(2,"0")}`
                                : "—";
                              const isPartial = s.distMiles != null && s.distMiles < 0.85;
                              const isFastest = fastest && s === fastest;
                              const isSlowest = slowest && fullMilesWithPace.length > 2 && s === slowest;
                              return (
                                <tr key={i} style={{ borderBottom:`1px solid ${C.light}`, background:i%2===0?C.white:C.offWhite }}>
                                  <td style={{ padding:"8px 10px", fontWeight:700, whiteSpace:"nowrap" }}>
                                    {s.mile ?? i+1}
                                    {isPartial && <span style={{ marginLeft:5, fontSize:10, color:C.midGray, fontWeight:400 }}>({s.distMiles?.toFixed(2)} mi)</span>}
                                    {isFastest && <span style={{ marginLeft:5, fontSize:10, color:C.green, fontWeight:700 }}>▲</span>}
                                    {isSlowest && <span style={{ marginLeft:5, fontSize:10, color:C.amber, fontWeight:700 }}>▼</span>}
                                  </td>
                                  <td style={{ textAlign:"right", padding:"8px 10px", fontFamily:"monospace", fontWeight:700, color: hasPace ? (isFastest?C.green:isSlowest?C.amber:C.navy) : C.midGray }}>
                                    {s.paceSec ? paceSecToLabel(Math.round(s.paceSec)) : "—"}
                                  </td>
                                  <td style={{ textAlign:"right", padding:"8px 10px", color:C.midGray }}>{timeLabel}</td>
                                  <td style={{ textAlign:"right", padding:"8px 10px" }}>
                                    {s.avgHR ? (
                                      <span>
                                        <span style={{ fontWeight:700, color:hrColor(s.avgHR) }}>{Math.round(s.avgHR)}</span>
                                        {s.maxHR && <span style={{ color:C.midGray, fontSize:11 }}> / {Math.round(s.maxHR)}</span>}
                                      </span>
                                    ) : "—"}
                                  </td>
                                  {hasPower && <td style={{ textAlign:"right", padding:"8px 10px", color:C.midGray }}>{s.avgPower ? `${Math.round(s.avgPower)}W` : "—"}</td>}
                                  {hasGCT   && <td style={{ textAlign:"right", padding:"8px 10px", color:C.midGray }}>{s.avgGCT ? `${Math.round(s.avgGCT)}ms` : "—"}</td>}
                                  {hasVO    && <td style={{ textAlign:"right", padding:"8px 10px", color:C.midGray }}>{s.avgVO ? `${s.avgVO.toFixed(1)}cm` : "—"}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {fastest && slowest && fullMilesWithPace.length >= 3 && (
                        <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginTop:12, paddingTop:10, borderTop:`1px solid ${C.light}` }}>
                          <span style={{ fontSize:12, color:C.midGray }}>
                            <span style={{ fontWeight:700, color:C.green }}>Fastest: </span>
                            Mile {fastest.mile} · {paceSecToLabel(Math.round(fastest.paceSec))}/mi
                          </span>
                          <span style={{ fontSize:12, color:C.midGray }}>
                            <span style={{ fontWeight:700, color:C.amber }}>Slowest: </span>
                            Mile {slowest.mile} · {paceSecToLabel(Math.round(slowest.paceSec))}/mi
                          </span>
                          {(() => {
                            const spread = slowest.paceSec - fastest.paceSec;
                            const fadeSec = fullMilesWithPace[fullMilesWithPace.length-1].paceSec - fullMilesWithPace[0].paceSec;
                            const paces = fullMilesWithPace.map(s => s.paceSec);
                            const meanPace = paces.reduce((a,b)=>a+b,0)/paces.length;
                            const sigma = +Math.sqrt(paces.reduce((a,b)=>a+Math.pow(b-meanPace,2),0)/paces.length).toFixed(1);
                            return (
                              <>
                                <span style={{ fontSize:12, color:spread > 90 ? C.amber : C.midGray }}>
                                  <span style={{ fontWeight:700 }}>Spread: </span>
                                  {paceSecToLabel(Math.round(spread))}/mi
                                  {spread > 90 && <span style={{ color:C.amber }}> · high variability</span>}
                                </span>
                                <span style={{ fontSize:12, color: fadeSec <= 20 ? C.green : fadeSec <= 60 ? C.amber : C.red }}>
                                  <span style={{ fontWeight:700 }}>Fade: </span>
                                  {fadeSec > 0 ? `+${Math.round(fadeSec)}s/mi` : `${Math.round(fadeSec)}s/mi (neg split ✓)`}
                                </span>
                                <span style={{ fontSize:12, color: sigma < 20 ? C.green : sigma < 40 ? C.amber : C.red }}>
                                  <span style={{ fontWeight:700 }}>σ: </span>±{sigma}s/mi
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          }

          // Main table view
          return (
            <div>
              {/* Summary strip */}
              <div style={{ display:"grid", gridTemplateColumns: isMob ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:12, marginBottom:20 }}>
                {[
                  { label:"Total Runs",   value:runs.length,             unit:"",    color:C.navy },
                  { label:"Total Miles",  value:totalMi,                 unit:" mi", color:C.red },
                  { label:"Avg Distance", value:runs.length ? +( kmToMi(runs.reduce((s,r)=>s+r.dist,0))/runs.length).toFixed(1) : "—", unit:" mi", color:C.navy },
                  { label:"Avg Pace",     value:avgPaceFmt30,            unit:"/mi", color:C.bofaBlue },
                ].map(s => (
                  <div key={s.label} style={{ background:C.white, border:`1px solid ${C.border}`, borderTop:`3px solid ${s.color}`, borderRadius:8, padding:"12px 16px" }}>
                    <p style={{ color:C.midGray, fontSize:11, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", margin:"0 0 4px" }}>{s.label}</p>
                    <p style={{ color:s.color, fontSize:22, fontWeight:800, margin:0, lineHeight:1 }}>{s.value}<span style={{ fontSize:12, fontWeight:400, color:C.midGray }}>{s.unit}</span></p>
                  </div>
                ))}
              </div>

              {/* Search + count */}
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
                <input
                  type="text"
                  placeholder="Filter by date, type, time of day…"
                  value={runFilter}
                  onChange={e => setRunFilter(e.target.value)}
                  style={{ flex:1, minWidth:180, padding:"8px 12px", border:`1px solid ${C.border}`, borderRadius:6, fontSize:13, fontFamily:F, outline:"none", color:C.darkGray }}
                />
                <span style={{ color:C.midGray, fontSize:13, flexShrink:0 }}>{sorted.length} run{sorted.length!==1?"s":""}</span>
                {runFilter && <button onClick={()=>setRunFilter("")} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, padding:"6px 10px", fontSize:12, cursor:"pointer", color:C.midGray, fontFamily:F }}>Clear</button>}
              </div>

              {/* Table */}
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden", boxShadow:"0 2px 12px rgba(1,33,105,0.06)" }}>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:F, fontSize:13 }}>
                    <thead>
                      <tr style={{ background:C.navy }}>
                        {COL_DEFS.map(col => (
                          <th key={col.key}
                            onClick={() => toggleSort(col.key)}
                            style={{
                              textAlign: col.align, padding:"10px 12px",
                              color:"rgba(255,255,255,0.85)", fontWeight:700, fontSize:11,
                              letterSpacing:"0.07em", textTransform:"uppercase",
                              cursor:"pointer", userSelect:"none", whiteSpace:"nowrap",
                            }}>
                            {col.label}
                            {runSort.key===col.key ? (runSort.dir==="asc"?" ↑":" ↓") : <span style={{opacity:0.3}}> ↕</span>}
                          </th>
                        ))}
                        <th style={{ padding:"10px 12px", color:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:600, textTransform:"uppercase", whiteSpace:"nowrap" }}>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r, i) => {
                        const mi = kmToMi(r.dist).toFixed(2);
                        const isLong = kmToMi(r.dist) >= 8;
                        return (
                          <tr key={r.id || r.date+i}
                            style={{ borderBottom:`1px solid ${C.light}`, background:i%2===0?C.white:C.offWhite, transition:"background 0.1s" }}
                            onMouseEnter={e=>e.currentTarget.style.background="#eef2ff"}
                            onMouseLeave={e=>e.currentTarget.style.background=i%2===0?C.white:C.offWhite}
                          >
                            <td style={{ padding:"14px 16px", fontWeight:700, whiteSpace:"nowrap", fontSize:15 }}>
                              {r.date}
                              {isLong && <span style={{ marginLeft:6, fontSize:11, fontWeight:700, color:C.red, background:C.red+"15", borderRadius:3, padding:"2px 5px" }}>LONG</span>}
                              {r.indoor && <span style={{ marginLeft:4, fontSize:11, color:C.bofaBlue, background:C.bofaBlue+"15", borderRadius:3, padding:"2px 5px" }}>🏠</span>}
                            </td>
                            <td style={{ textAlign:"right", padding:"14px 16px", fontWeight:800, fontSize:16, color:kmToMi(r.dist)>=10?C.red:kmToMi(r.dist)>=8?C.navy:C.darkGray }}>{mi}</td>
                            <td style={{ textAlign:"right", padding:"14px 16px", fontFamily:"monospace", fontSize:15, fontWeight:600 }}>{r.pace ?? "—"}</td>
                            <td style={{ textAlign:"right", padding:"14px 16px", color:C.midGray, fontSize:14 }}>
                              {r.movingTimeSec ? `${Math.floor(r.movingTimeSec/3600)?Math.floor(r.movingTimeSec/3600)+"h ":""}${Math.floor((r.movingTimeSec%3600)/60)}m` : "—"}
                            </td>
                            <td style={{ textAlign:"right", padding:"14px 16px", fontWeight:700, fontSize:15, color:hrColor(r.avgHR) }}>{r.avgHR ? Math.round(r.avgHR) : "—"}</td>
                            <td style={{ textAlign:"right", padding:"14px 16px", color:C.midGray, fontSize:14 }}>{r.avgCadence ? Math.round(r.avgCadence) : "—"}</td>
                            <td style={{ padding:"14px 16px", color:C.midGray, fontSize:13, whiteSpace:"nowrap" }}>{r.timeOfDay ?? "—"}</td>
                            <td style={{ padding:"14px 16px" }}>
                              <button onClick={() => setSelectedRun(r)} style={{
                                background:C.navy, color:C.white, border:"none", borderRadius:6,
                                padding:"7px 14px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F,
                              }}>View</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {sorted.length === 0 && (
                  <p style={{ color:C.midGray, fontSize:14, textAlign:"center", padding:"32px 0" }}>No runs match your filter.</p>
                )}
              </div>
            </div>
          );
        })()}

      </div>

      <div style={{ maxWidth:980, margin:"0 auto", padding:`0 ${px} 32px` }}>
        <div style={{ paddingTop:22, borderTop:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <img src={BOA_HORIZONTAL} alt="Bank of America" style={{ height:24, objectFit:"contain", opacity:0.6 }} onError={e=>e.currentTarget.style.display="none"} />
            <img src={CHI_LOGO_SVG}   alt="Chicago Marathon" style={{ height:22, objectFit:"contain", opacity:0.5 }} onError={e=>e.currentTarget.style.display="none"} />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            {lastUpdated && (
              <p style={{ color:C.midGray, fontSize:14, margin:0 }}>
                Last updated: {new Date(lastUpdated).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"})}
              </p>
            )}
            <p style={{ color:C.midGray, fontSize:13, margin:0 }}>© 2026 Bank of America Corporation · October 11, 2026</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoIcon({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position:"relative", display:"inline-flex", alignItems:"center" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width:16, height:16, borderRadius:"50%", border:`1px solid ${C.border}`,
          background: open ? C.navy : C.light, color: open ? C.white : C.midGray,
          fontSize:11, fontWeight:700, cursor:"pointer", display:"inline-flex",
          alignItems:"center", justifyContent:"center", lineHeight:1,
          padding:0, flexShrink:0, transition:"all 0.15s", fontFamily:F,
        }}
        title="Info"
      >i</button>
      {open && (
        <div style={{
          position:"absolute", top:20, left:0, zIndex:100, width:260,
          background:C.white, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.navy}`,
          borderRadius:6, padding:"10px 12px", boxShadow:"0 4px 12px rgba(1,33,105,0.1)",
          fontFamily:F, fontSize:13, lineHeight:1.6, color:C.darkGray,
        }}>
          {text}
          <button onClick={() => setOpen(false)} style={{ marginTop:6, fontSize:11, color:C.midGray, background:"none", border:"none", cursor:"pointer", padding:0, fontFamily:F }}>Close ×</button>
        </div>
      )}
    </span>
  );
}

function SecTitle({ title, color, toggleOptions, toggleValue, onToggle }) {
  const isMob = useIsMobile();
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:20, paddingBottom:10, borderBottom:`2px solid ${color}` }}>
      <h2 style={{ color, fontSize: isMob ? 19 : 23, fontWeight:800, margin:0, letterSpacing:"-0.02em" }}>{title}</h2>
      {toggleOptions && (
        <div style={{ display:"flex", gap:0, border:`1px solid ${C.border}`, borderRadius:6, overflow:"hidden", flexShrink:0 }}>
          {toggleOptions.map((v,i) => (
            <button key={v.id} onClick={() => onToggle(v.id)} style={{
              padding: isMob ? "5px 10px" : "5px 14px", fontSize: isMob ? 11 : 12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap",
              background: toggleValue===v.id ? color : C.white,
              color: toggleValue===v.id ? C.white : C.midGray,
              border:"none",
              borderLeft: i>0 ? `1px solid ${C.border}` : "none",
              fontFamily: F,
            }}>{v.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ label, color }) {
  return (
    <span style={{ fontSize:11, fontWeight:600, color, background:`${color}18`, border:`1px solid ${color}40`, borderRadius:3, padding:"2px 6px" }}>{label}</span>
  );
}

function Row({ label, value, bold, color }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2 }}>
      <span style={{ color:C.midGray, fontSize:13 }}>{label}</span>
      <span style={{ color:color||C.darkGray, fontSize:14, fontWeight:bold?700:400 }}>{value}</span>
    </div>
  );
}