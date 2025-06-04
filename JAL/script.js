//import maplibregl from 'maplibre-gl';

const map = new maplibregl.Map({
  container: 'map',
  style: 'style.json',
  center: [139.7671, 35.6812],
  zoom: 4
});

let selectedNodes = [];
let selectedAirport = [];
let airportData = [];
let hoveredPopup = null;

map.on('load', async () => {
  airportData = await loadAirportCSV("airports2.csv");

  map.addSource('airports', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: airportData.map(airport => ({
        type: 'Feature',
        id: airport.id,
        geometry: {
          type: 'Point',
          coordinates: [parseFloat(airport.x), parseFloat(airport.y)]
        },
        properties: {
          id: airport.id,
          name: airport.name
        }
      }))
    }
  });

  map.addLayer({
    id: 'airport-points',
    type: 'circle',
    source: 'airports',
    paint: {
      'circle-radius': 5,
      'circle-color': [
        'case',
        ["boolean", ["feature-state", "connected"], false],
        'red',
        'black'
      ]
    }
  });

  map.on('click', 'airport-points', async (e) => {
    const feature = e.features[0];
    const clickedAirport = airportData.find(d => d.id === feature.properties.id);
  
    // 同じ空港を再度クリックしたらリセット
    if (
      selectedNodes.length === 1 && selectedNodes[0].id === clickedAirport.id ||
      selectedNodes.length === 2 && selectedNodes[1].id === clickedAirport.id
    ) {
      selectedNodes = [];
      showInfoPanel([]);
      updateStarMarkers();
      return;
    }
  
    // 最大2つまで選択、3つ目はリセットして1つ目にする
    if (selectedNodes.length >= 2) {
      selectedNodes = [clickedAirport];
    } else {
      selectedNodes.push(clickedAirport);
    }
  
    if (selectedNodes.length === 1) {
      await fetchConnectionsFromAPI(clickedAirport);
      drawConnections();
      updateConnectedAirportStates();
    }
  
    // 情報パネルを更新
    showInfoPanel(selectedNodes);
  
    // マーカーの色やアイコンを更新（例：選択時はオレンジ星印に）
    updateStarMarkers();
  });


  function updateConnectedAirportStates() {
    airportData.forEach(ap => {
      map.setFeatureState({ source: 'airports', id: ap.id }, { connected: false });
    });

    const from = selectedNodes[0];
    from.connections.forEach(destId => {
      //console.log(`Connecting ${from.id} to ${destId}`);
      map.setFeatureState({ source: 'airports', id: destId }, { connected: true });
    });
  }

  function updateStarMarkers() {
    const features = selectedNodes.map(airport => ({
      type: 'Feature',
      id: airport.id,
      geometry: {
        type: 'Point',
        coordinates: [parseFloat(airport.x), parseFloat(airport.y)]
      },
      properties: {
        name: airport.name
      }
    }));

    const starData = {
      type: 'FeatureCollection',
      features
    };

    if (map.getSource('selected-stars')) {
      map.getSource('selected-stars').setData(starData);
    } else {
      map.addSource('selected-stars', {
        type: 'geojson',
        data: starData
      });

      map.loadImage('star.png', (error, image) => {
        if (error) throw error;
        if (!map.hasImage('airport-star')) {
          map.addImage('airport-star', image);
        }

        map.addLayer({
          id: 'star-layer',
          type: 'symbol',
          source: 'selected-stars',
          layout: {
            'icon-image': 'airport-star',
            'icon-size': 0.09,
            'icon-allow-overlap': true
          }
        });
      });
    }
  }

  map.on('mouseenter', 'airport-points', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const coordinates = e.features[0].geometry.coordinates.slice();
    const name = e.features[0].properties.name;

    if (hoveredPopup) hoveredPopup.remove();
    hoveredPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
      .setLngLat(coordinates)
      .setHTML(`<strong>${name}</strong>`)
      .addTo(map);
  });

  map.on('mouseleave', 'airport-points', () => {
    map.getCanvas().style.cursor = '';
    if (hoveredPopup) hoveredPopup.remove();
  });
});

dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function showInfoPanel(selected) {
  const panel = document.getElementById('info-panel');
  if (!panel) return;

  const origin = selected[0];
  let html = "<table>";
  dispDateString = document.getElementById("date-input").value;
  dispDate = new Date(dispDateString);

  if (selected.length === 1) {
    html += "<thead><tr>";
    html += `<th colspan="2">出発地</th>`;
    html += "<th>→</th><th colspan='2'>目的地</th></tr></thead>";
    html += "<tbody>";

    scheduleList = [];

    origin.flightSchedules?.forEach(schedule => {
      const dayWeek = schedule["odpt:calendar"]?.replace("odpt.Calendar:", "");   
      // dayWeekは曜日を表す（ex Monday, Tuesday, ...）, dispDateの曜日と一致するかチェック
      if(dayWeek == dayOfWeek[dispDate.getDay()]) {

        (schedule["odpt:flightScheduleObject"] || []).forEach(obj => {
          const flightNumbers = obj["odpt:flightNumber"]?.join(", ") || "";
          const originTime = obj["odpt:originTime"];
          const destTime = obj["odpt:destinationTime"];
          const from = obj["odpt:isValidFrom"]?.split("T")[0];
          const to = obj["odpt:isValidTo"]?.split("T")[0];
          const destId = schedule["odpt:destinationAirport"]?.replace("odpt.Airport:", "");
          const destAp = airportData.find(a => a.id === destId).name;
          
          // dispDateがfromとtoの月に含まれているかチェック
          const fromDate = new Date(from);
          const toDate = new Date(to);
          if (dispDate >= fromDate && dispDate <= toDate) {
            scheduleList.push({
              flightNumbers,
              originTime,
              destTime,
              from,
              to,
              dayWeek,
              destId,
              destAp
            });
          }
        });
      }
    });

    if (scheduleList.length === 0) {
        html += `</tbody></table><p>この空港のフライト情報はありません。</p>`;
    } else {
        // ソートする
        scheduleList.sort((a, b) => {
          const dateA = new Date(`${dispDateString}T${a.originTime}`);
          const dateB = new Date(`${dispDateString}T${b.originTime}`);
          return dateA - dateB;
        });

        scheduleList.forEach(schedule => {
            html += `<tr><td>${origin.name} (${origin.id})</td><td>${schedule.originTime}</td><td>${schedule.flightNumbers}</td>
            <td>${schedule.destTime}</td><td>${schedule.destAp} (${schedule.destId})</tr>`;
        });
        html += "</tbody></table>";
    }
  } else if (selected.length === 2) {
    const destination = selected[1];

    html += "<thead><tr>";
    html += `<th>${origin.name} (${origin.id})</th>`;
    html += "<th>→</th>";
    html += `<th>${destination.name} (${destination.id})</th>`;
    html += "</tr></thead>";


    // origin から destination への便だけを抽出
    const flights = origin.flightSchedules?.filter(sch =>
      sch["odpt:destinationAirport"]?.endsWith(destination.id)
    ) || [];

    if (flights.length === 0) {
      html += `</table><p>このルートのフライト情報はありません。</p>`;
    } else {
      html += "<tbody>";
      flights.forEach(schedule => {
        const dayWeek = schedule["odpt:calendar"]?.replace("odpt.Calendar:", "");   
        // dayWeekは曜日を表す（ex Monday, Tuesday, ...）, dispDateの曜日と一致するかチェック
        if(dayWeek == dayOfWeek[dispDate.getDay()]) {
          (schedule["odpt:flightScheduleObject"] || []).forEach(obj => {
            const flightNumbers = obj["odpt:flightNumber"]?.join(", ") || "";
            const originTime = obj["odpt:originTime"];
            const destTime = obj["odpt:destinationTime"];
            const from = obj["odpt:isValidFrom"]?.split("T")[0];
            const to = obj["odpt:isValidTo"]?.split("T")[0];
            
            // dispDateがfromとtoの月に含まれているかチェック
            const fromDate = new Date(from);
            const toDate = new Date(to);
            if (dispDate => fromDate || dispDate <= toDate) {
                //html += `<tr><td>${flightNumbers}</td><td>${originTime} → ${destTime}</td>
                //    <td>運行期間: ${from} ～ ${to}, ${dayWeek}</td></tr>`;
                html += `<tr><td>${originTime}</td><td>${flightNumbers}</td>
                <td>${destTime}</td></tr>`;
            }
          });
        }
      });
      html += "</tbody></table>";
    }
  }

  panel.innerHTML = html;
}

async function loadAirportCSV(path) {
  const res = await fetch(path);
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1);

  return lines.map(line => {
    const [name, name2, IATA, ICAO, lat, long] = line.split(",");
    return {
      id: IATA,
      name: name2,
      x: long,
      y: lat,
      connections: []
    };
  });
}

function drawConnections() {
  if (selectedNodes.length < 1) return;

  const from = selectedNodes[0];
  const features = (from.connections || []).map(destId => {
    const to = airportData.find(d => d.id === destId);
    if (!to) return null;
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [parseFloat(from.x), parseFloat(from.y)],
          [parseFloat(to.x), parseFloat(to.y)]
        ]
      }
    };
  }).filter(Boolean);

  if (map.getSource('connections')) {
    map.getSource('connections').setData({
      type: 'FeatureCollection',
      features
    });
  } else {
    map.addSource('connections', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features
      }
    });

    map.addLayer({
      id: 'connection-lines',
      type: 'line',
      source: 'connections',
      paint: {
        'line-color': 'red',
        'line-width': 2
      }
    });
  }
}

async function fetchConnectionsFromAPI(node) {
  const token = "xr9gtdr4zu06mchaxd8qrrw56a44p5enj0ycc0pmu7h5qyhbyx7o6phuhbkk2jji";
  const url = `https://api.odpt.org/api/v4/odpt:FlightSchedule?odpt:operator=odpt.Operator:JAL&odpt:originAirport=odpt.Airport:${node.id}&acl:consumerKey=${token}`;

  try {
    const res = await fetch(url);
    const json = await res.json();

    const destinations = new Set();
    const flights = [];

    json.forEach(entry => {
      const dest = entry["odpt:destinationAirport"]?.replace("odpt.Airport:", "");
      if (dest) {
        destinations.add(dest);
        flights.push({ dest });
      }
    });

    node.connections = [...destinations];
    node.flights = flights;
    node.flightSchedules = json;
  } catch (err) {
    console.error("API取得失敗:", err);
  }
}
