// Import Mapbox and D3 as ESM modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Public (pk.) token: Mapbox tokens are meant to ship in client code
const MAPBOX_TOKEN =
  'pk.eyJ1IjoidzdxaW4iLCJhIjoiY213ZzB6aW1yMDdsdjJ5cTRycGY1bGVubSJ9.fIAkULRNMEJR9PcVQnURNg';

const DATA_URL = 'https://dsc106.com/labs/lab07/data';
const STATIONS_URL = `${DATA_URL}/bluebikes-stations.json`;
const TRIPS_URL = `${DATA_URL}/bluebikes-traffic-2024-03.csv`;
const BOSTON_LANES_URL =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';
const CAMBRIDGE_LANES_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';

const MINUTES_PER_DAY = 1440;
const WINDOW_MINUTES = 60;
const RADIUS_ALL = [0, 25];
const RADIUS_FILTERED = [3, 50];

// Step 2.3: one style object shared by both bike lane layers
const BIKE_LANE_PAINT = {
  'line-color': '#32D400',
  'line-width': 3,
  'line-opacity': 0.5,
};

mapboxgl.accessToken = MAPBOX_TOKEN;

// Step 1.3
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Step 5.4: trips pre-sorted into one bucket per minute of the day
const departuresByMinute = Array.from({ length: MINUTES_PER_DAY }, () => []);
const arrivalsByMinute = Array.from({ length: MINUTES_PER_DAY }, () => []);

// Step 6.1: three colors read more clearly than a continuous scale
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Step 3.3
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Step 5.2
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.4: only read the ~120 buckets around the selected minute
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const minMinute = (minute - WINDOW_MINUTES + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const maxMinute = (minute + WINDOW_MINUTES) % MINUTES_PER_DAY;

  // The window wraps past midnight
  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  }
  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

// Steps 4.2 + 5.3: returns new station objects instead of mutating the input
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;
    const stationArrivals = arrivals.get(id) ?? 0;
    const stationDepartures = departures.get(id) ?? 0;
    return {
      ...station,
      arrivals: stationArrivals,
      departures: stationDepartures,
      totalTraffic: stationArrivals + stationDepartures,
    };
  });
}

function departureRatio(station) {
  // A station with no trips in the window counts as balanced
  if (station.totalTraffic === 0) return 0.5;
  return stationFlow(station.departures / station.totalTraffic);
}

function tooltipText(d) {
  return `${d.name}\n${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
}

// Steps 4.1 + 5.4: parse dates and fill the minute buckets as rows load
async function loadTrips() {
  return d3.csv(TRIPS_URL, (row) => {
    const trip = {
      ...row,
      started_at: new Date(row.started_at),
      ended_at: new Date(row.ended_at),
    };
    departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
    arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);
    return trip;
  });
}

// Step 2
function addBikeLanes() {
  map.addSource('boston_route', { type: 'geojson', data: BOSTON_LANES_URL });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: BIKE_LANE_PAINT,
  });

  map.addSource('cambridge_route', { type: 'geojson', data: CAMBRIDGE_LANES_URL });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: BIKE_LANE_PAINT,
  });
}

// Steps 3.3, 4.3, 4.4, 6.1
function drawStations(stations, radiusScale) {
  const svg = d3.select('#map').select('svg');
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', departureRatio)
    .each(function (d) {
      d3.select(this).append('title').text(tooltipText(d));
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  return circles;
}

// Step 5: slider drives the time filter
function setUpTimeFilter(stations, circles, radiusScale) {
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);
    radiusScale.range(timeFilter === -1 ? RADIUS_ALL : RADIUS_FILTERED);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', departureRatio)
      .select('title')
      .text(tooltipText);
  }

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
}

function showError(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  document.querySelector('.description').after(p);
}

map.on('load', async () => {
  addBikeLanes();

  try {
    const [jsonData] = await Promise.all([d3.json(STATIONS_URL), loadTrips()]);
    const stations = computeStationTraffic(jsonData.data.stations);

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range(RADIUS_ALL);

    const circles = drawStations(stations, radiusScale);
    setUpTimeFilter(stations, circles, radiusScale);
  } catch (error) {
    console.error('Error loading Bluebikes data:', error);
    showError('Could not load the Bluebikes station or trip data.');
  }
});

map.on('error', (event) => {
  console.error('Mapbox error:', event.error);
});
